# src/app/services/indexing.py — DialogosAI / Kintzios
#
# Adapted from the BPAN indexer (../../../../src/app/services/indexing.py).
# GeminiEmbedder, the TF-IDF/FAISS plumbing, the chunk packer and the disk-cache
# layout are reused as-is. The Kintzios deltas, all documented in
# ARCHITECTURE_NOTES.md §5:
#
#   1. index_content() now takes PRE-CHUNKED records that carry their own
#      metadata, instead of whole pages it chunks itself. The transcript
#      chunker must control turn boundaries, so chunking moved upstream to
#      ingest/. Plain documents are still packed by _split_content().
#   2. Every chunk carries lang / speaker / rights_cleared / source_type /
#      episode / timestamp alongside url+title.
#   3. Searches take a `predicate` callable. public_filter() is the single
#      definition of what a public answer may see.
#   4. EMBEDDINGS_AVAILABLE additionally requires a key to be present, so a
#      keyless install degrades to the TF-IDF leg instead of raising at query
#      time. The whole test suite runs on that path.
#   5. BPAN's Greek welfare-acronym expansion table (ΚΕΠΑ, ΕΟΠΥΥ, …) is
#      replaced with leadership/HR vocabulary.
import os
import re
import hashlib
import pickle
import logging
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

# Embeddings need faiss + google.generativeai AND a key. BPAN only checked the
# imports, so a keyless install would build a TF-IDF index and then throw on
# the first FAISS query. Requiring the key here makes the degradation clean.
try:
    import faiss  # noqa
    import google.generativeai as genai
    EMBEDDINGS_AVAILABLE = bool(
        os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY_2")
    )
    if not EMBEDDINGS_AVAILABLE:
        logger.warning("No GEMINI_API_KEY — semantic leg disabled, TF-IDF only.")
except Exception as _e:
    logger.warning("Embeddings disabled: %s", _e)
    EMBEDDINGS_AVAILABLE = False


# --------------------------------------------------------------------------- #
# The retrieval filter contract.
#
# This is the ONE definition of what a public persona answer may retrieve.
# Both conditions are load-bearing:
#   * rights_cleared — a file whose rights are not cleared is internal-only,
#     however interesting its content is.
#   * speaker — a guest's words are indexed (so the team can search them) but
#     must never be served as his opinion.
# Internal search passes predicate=None and sees everything.
#
# Do not inline this logic in a router. Two copies WILL diverge, and the
# failure is silent: the bot keeps answering, just with someone else's words.
# --------------------------------------------------------------------------- #
def public_filter(persona_speaker: str = "Kintzios"):
    """Return a predicate selecting chunks usable in public persona answers."""

    def _pred(meta: dict) -> bool:
        return (
            bool(meta.get("rights_cleared"))
            and (meta.get("speaker") or "") == persona_speaker
        )

    return _pred


def searchable_filter():
    """Predicate for the public *pillar navigator* and site search.

    Same rights requirement, but speaker-agnostic: a pillar description or a
    page of his site has no speaker turn structure. In practice every
    non-transcript chunk is authored by him, so this differs from
    public_filter only for transcripts.
    """

    def _pred(meta: dict) -> bool:
        return bool(meta.get("rights_cleared"))

    return _pred


# ---------------------------------------------------------------------------
# Greek normalisation for the lexical leg
# ---------------------------------------------------------------------------
# WHY: TF-IDF matched raw surface forms, so «χαρακτήρας» (nominative — what a
# visitor types) never matched «χαρακτήρα» (accusative — what the text says).
# Greek is heavily inflected, so this is not an edge case: measured on the seed
# corpus, 4 of 10 ordinary single-word Greek probes returned ZERO hits, among
# them «εμπιστοσύνη», «κίνητρο» and «χαρακτήρας» — core vocabulary for a
# leadership coach. The semantic (FAISS) leg papers over this when a key is
# present, which is exactly why it went unnoticed: the keyless path is the one
# the tests exercise.
#
# This is deliberately a LIGHT suffix stripper, not a full Greek stemmer. A
# real stemmer (e.g. Greek Snowball) would be better and is a dependency worth
# adding later; this handles the productive noun/adjective/verb endings that
# cause the misses above, folds accents, and normalises final sigma. Applied as
# the vectoriser's `preprocessor`, so index and query are folded by the same
# code path — they cannot drift.
_GREEK_ACCENTS_ONLY = str.maketrans("άέήίόύώϊϋΐΰ", "αεηιουωιυιυ")

# Longest first: «-ματος» must strip before «-ος».
_GREEK_SUFFIXES = (
    "ματων", "ματος", "ματα", "ουσα", "ουσε", "οντας", "ονται", "ουνται",
    "ηκαμε", "ηκατε", "ηκανε", "θηκε", "ιζουμε", "ιζετε",
    "εων", "εως", "ιων", "ους", "ους", "ες", "εις", "ων", "ος", "ου", "οι",
    "ας", "ης", "ες", "α", "ε", "η", "ι", "ο", "υ", "ω",
)


def greek_normalise(text: str) -> str:
    """Lowercase, strip accents, and light-stem Greek tokens.

    Latin tokens pass through untouched apart from lowercasing, so "manager"
    and "Gen Z" behave exactly as before.
    """
    # Accents only here. Final sigma is folded AFTER suffix stripping: doing it
    # first turns «χαρακτήρας» into «χαρακτηρασ», whose "ασ" tail no longer
    # matches the "ας" suffix, so the nominative never reduces to the same stem
    # as the accusative — the exact bug this function exists to fix.
    text = text.lower().translate(_GREEK_ACCENTS_ONLY)
    out = []
    for tok in re.findall(r"\w+", text, flags=re.UNICODE):
        if len(tok) > 4 and any("α" <= ch <= "ω" for ch in tok):
            for suf in _GREEK_SUFFIXES:
                if tok.endswith(suf) and len(tok) - len(suf) >= 3:
                    tok = tok[: -len(suf)]
                    break
        out.append(tok.replace("ς", "σ"))
    return " ".join(out)


class GeminiEmbedder:
    """
    Drop-in replacement for SentenceTransformer using Gemini text-embedding-004.

    Why: MiniLM is English-first and weak on Greek proper nouns, so chunks like
    "Ιατρικός Σύλλογος Δράμας" don't surface in retrieval. text-embedding-004 is
    multilingual and dramatically better on Greek.

    Disk cache: each text → SHA-256 → embeddings/_emb_cache/{task}_{hash}.npy.
    Re-runs are instant; only NEW or CHANGED chunks hit the API.

    Rate-limit handling:
      - Reads GEMINI_API_KEY + GEMINI_API_KEY_2..10 → rotates on 429.
      - Exponential backoff with retries before giving up (NEVER returns
        zero vectors silently — those would silently poison the index).
    """
    MODEL = "models/gemini-embedding-001"   # stable Greek-strong embedding
    DIM = 3072
    BATCH = 100
    MAX_RETRIES = 8           # ~couple minutes of backoff in worst case
    INITIAL_BACKOFF = 5.0     # seconds

    def __init__(self, cache_dir: str | None = None):
        self.api_keys = []
        for i in range(1, 11):
            name = "GEMINI_API_KEY" if i == 1 else f"GEMINI_API_KEY_{i}"
            k = (os.environ.get(name) or "").strip()
            if k and k not in self.api_keys:
                self.api_keys.append(k)
        if not self.api_keys:
            raise RuntimeError("No GEMINI_API_KEY* set — embeddings unavailable")
        self.key_idx = 0
        genai.configure(api_key=self.api_keys[0])
        logger.info("GeminiEmbedder: %d API key(s) available", len(self.api_keys))

        if cache_dir is None:
            cache_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..", "..", "..", "embeddings", "_emb_cache",
            )
        self.cache_dir = os.path.abspath(cache_dir)
        os.makedirs(self.cache_dir, exist_ok=True)

    @staticmethod
    def _hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _cache_path(self, h: str, task_type: str) -> str:
        return os.path.join(self.cache_dir, f"{task_type}_{h}.npy")

    def _rotate_key(self):
        """Switch to the next available API key (round-robin)."""
        self.key_idx = (self.key_idx + 1) % len(self.api_keys)
        genai.configure(api_key=self.api_keys[self.key_idx])
        logger.info("Rotated embedding API key to slot %d/%d",
                    self.key_idx, len(self.api_keys))

    def _embed_batch(self, batch_texts: list, task_type: str) -> list:
        """Embed a batch with retry+backoff on 429. Raises on permanent failure.

        We REFUSE to return zero vectors silently — those silently poison the
        FAISS index by producing garbage neighbours. Better to fail loudly so
        the user can act (add a 2nd API key, wait, etc.).
        """
        import time as _time
        backoff = self.INITIAL_BACKOFF
        last_exc = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                resp = genai.embed_content(
                    model=self.MODEL,
                    content=batch_texts,
                    task_type=task_type,
                )
                vecs = resp["embedding"]
                if vecs and isinstance(vecs[0], (int, float)):
                    vecs = [vecs]
                return [np.asarray(v, dtype=np.float32) for v in vecs]
            except Exception as e:
                last_exc = e
                msg = str(e)
                is_429 = ("429" in msg or "Resource exhausted"
                          in msg or "ResourceExhausted" in msg)
                if not is_429:
                    # Non-rate-limit error — re-raise immediately
                    raise
                # 429: try next key (if any) and back off
                logger.warning(
                    "Embedding 429 on attempt %d/%d (batch=%d). "
                    "Rotating key + sleeping %.0fs.",
                    attempt, self.MAX_RETRIES, len(batch_texts), backoff)
                if len(self.api_keys) > 1:
                    self._rotate_key()
                _time.sleep(backoff)
                backoff = min(backoff * 2, 60)  # cap at 60s
        # All retries exhausted
        raise RuntimeError(
            f"Embedding batch of {len(batch_texts)} failed after "
            f"{self.MAX_RETRIES} retries. Last error: {last_exc}"
        )

    def encode(self, texts, task_type: str = "RETRIEVAL_DOCUMENT",
               normalize_embeddings: bool = True, show_progress_bar: bool = False) -> np.ndarray:
        """
        Returns a (N, DIM) numpy array. Uses cache when possible.
        task_type = 'RETRIEVAL_DOCUMENT' at index time, 'RETRIEVAL_QUERY' at query time.
        """
        if isinstance(texts, str):
            texts = [texts]

        out: list = [None] * len(texts)
        miss_idxs, miss_texts, miss_hashes = [], [], []

        for i, t in enumerate(texts):
            h = self._hash(t)
            cp = self._cache_path(h, task_type)
            if os.path.exists(cp):
                try:
                    out[i] = np.load(cp)
                    continue
                except Exception:
                    pass
            miss_idxs.append(i)
            miss_texts.append(t)
            miss_hashes.append(h)

        if miss_texts:
            logger.info("Embedding %d new chunks via Gemini (cached: %d)",
                        len(miss_texts), len(texts) - len(miss_texts))

        for start in range(0, len(miss_texts), self.BATCH):
            chunk_texts = miss_texts[start:start + self.BATCH]
            chunk_hashes = miss_hashes[start:start + self.BATCH]
            chunk_indexes = miss_idxs[start:start + self.BATCH]
            vecs = self._embed_batch(chunk_texts, task_type)
            for tgt_idx, vec, h in zip(chunk_indexes, vecs, chunk_hashes):
                if normalize_embeddings:
                    n = np.linalg.norm(vec)
                    if n > 0:
                        vec = vec / n
                out[tgt_idx] = vec
                try:
                    np.save(self._cache_path(h, task_type), vec)
                except Exception:
                    pass

        # Replace any remaining None (shouldn't happen) with zero vectors
        return np.vstack(
            [o if o is not None else np.zeros(self.DIM, dtype=np.float32) for o in out]
        )


class HybridContentIndexer:
    """
    Hybrid indexer that supports TF-IDF and (optionally) FAISS embeddings.
    It is self-contained and only needs a writable embeddings_dir.
    """
    def __init__(self, embeddings_dir: str = "poamskp_embeddings"):
        self.embeddings_dir = embeddings_dir
        os.makedirs(self.embeddings_dir, exist_ok=True)

        # TF-IDF components
        self.tfidf_vectorizer = None
        self.tfidf_matrix = None
        self.tfidf_documents = []

        # FAISS components
        self.embedding_model = None
        self.faiss_index = None
        self.embedding_documents = []
        self.embeddings_array = None

        # Metadata aligned with document indices
        self.document_metadata = []

        # Greek + common stopwords
        self.greek_stop_words = [
            'και','που','για','των','του','της','με','από','στο','στη','στην','στα','στις','στους',
            'σε','ο','η','το','οι','τα','ένα','μια','ένας','μας','σας','τους','τις','τα',
            'είναι','ήταν','έχει','έχουν','θα','να','δε','δεν','μη','μην','αλλά','όμως',
            'the','and','or','but','in','on','at','to','for','of','with','by','is','are','was','were'
        ]

    # ---------- disk paths ----------
    def _tfidf_path(self):
        return os.path.join(self.embeddings_dir, "tfidf_index.pkl")

    def _faiss_data_path(self):
        return os.path.join(self.embeddings_dir, "faiss_data.pkl")

    def _faiss_index_path(self):
        return os.path.join(self.embeddings_dir, "faiss_index.bin")

    # ---------- loading / saving ----------
    def load_existing_indices(self):
        tfidf_loaded = False
        faiss_loaded = False

        try:
            if os.path.exists(self._tfidf_path()):
                with open(self._tfidf_path(), "rb") as f:
                    data = pickle.load(f)
                self.tfidf_vectorizer = data["vectorizer"]
                self.tfidf_matrix = data["matrix"]
                self.tfidf_documents = data["documents"]
                self.document_metadata = data.get("metadata", [])
                logger.info(f"✅ Loaded TF-IDF index with {len(self.tfidf_documents)} documents")
                tfidf_loaded = True
        except Exception as e:
            logger.error(f"Failed to load TF-IDF index: {e}")

        if EMBEDDINGS_AVAILABLE and os.path.exists(self._faiss_data_path()) and os.path.exists(self._faiss_index_path()):
            try:
                with open(self._faiss_data_path(), "rb") as f:
                    data = pickle.load(f)
                self.embedding_documents = data["documents"]
                self.embeddings_array = data["embeddings"]
                stored_model = data.get("model_name", "")
                # If the existing FAISS index was built with the old MiniLM model,
                # we MUST rebuild — the dim/space is different. Refuse to load.
                if stored_model and not any(m in stored_model for m in ("text-embedding-004", "gemini-embedding-001", "gemini-embedding")):
                    logger.warning(
                        "FAISS index on disk uses old model %r — will rebuild on next index_content.",
                        stored_model,
                    )
                    self.embedding_documents, self.embeddings_array = [], None
                    return tfidf_loaded, False

                self.embedding_model = GeminiEmbedder()
                import faiss  # local import to read index
                self.faiss_index = faiss.read_index(self._faiss_index_path())
                logger.info(f"✅ Loaded FAISS index with {len(self.embedding_documents)} documents")
                faiss_loaded = True
            except Exception as e:
                logger.error(f"Failed to load FAISS index: {e}")

        return tfidf_loaded, faiss_loaded

    # ---------- building ----------
    # Metadata keys every chunk carries. `lang`, `speaker` and `rights_cleared`
    # are the ones the filter predicates read, so they get explicit defaults
    # rather than being allowed to arrive as None: a missing rights flag must
    # read as NOT cleared, never as cleared.
    META_DEFAULTS = {
        "url": "",
        "title": "",
        "lang": "el",
        "speaker": "",
        "rights_cleared": False,
        "source_type": "",
        "episode": "",
        "timestamp": "",
        "pillar_slug": "",
        "placeholder": False,
        "content_type": "text",
    }

    def index_content(self, records):
        """Index pre-chunked records.

        Each record is a dict with at least `content`; every other key is
        metadata and is normalised against META_DEFAULTS. Records arrive
        already chunked because transcripts must be split on speaker turns —
        see ingest/transcripts.py. A record whose `content` is longer than the
        chunker's ceiling is packed here by _split_content(), inheriting its
        parent's metadata; that path is for plain documents only, and it never
        runs on transcript turns.
        """
        if not records:
            logger.warning("No content to index")
            return

        MIN_CHARS = 40      # was 50 in BPAN; transcript turns run short
        segments, meta = [], []
        for rec in records:
            text = (rec.get("content") or "").strip()
            if len(text) < MIN_CHARS:
                continue
            base = {k: rec.get(k, v) for k, v in self.META_DEFAULTS.items()}
            # Already-chunked short records pass through untouched. Long plain
            # documents get packed; a transcript turn is never long enough to
            # hit this, and the chunker guarantees one speaker per record.
            pieces = [text] if len(text) <= 1000 else self._split_content(text)
            for s in pieces:
                s = s.strip()
                if len(s) < MIN_CHARS:
                    continue
                m = dict(base)
                m["content"] = s
                segments.append(s)
                meta.append(m)

        if not segments:
            logger.warning("No valid segments found for indexing")
            return

        logger.info(f"Indexing {len(segments)} segments (hybrid)...")
        self._index_tfidf(segments, meta)
        if EMBEDDINGS_AVAILABLE:
            self._index_faiss(segments, meta)
        logger.info("✅ Hybrid indexing completed")

    def _split_content(self, content: str):
        """
        Split content into focused chunks for retrieval.

        Strategy (fallback chain):
        1. Split on double newlines → paragraphs
        2. If a paragraph is still too big, split on single newlines
        3. If still too big OR if there are no newlines at all (web-scraped
           pages often arrive as one big blob), use sliding-window over WORDS
           with overlap. This is the only thing that works for content like
           "Ιατρικός Σύλλογος Κέρκυρας Ιατρικός Σύλλογος Φθιώτιδας ..." where
           there are no sentence boundaries between distinct items.

        Target chunk size: ~700 chars. Overlap: ~150 chars (≈ 25 words).
        """
        TARGET = 700
        MAX = 1000
        OVERLAP_WORDS = 25

        def sliding_window(text: str):
            """Split arbitrary text into ~TARGET-char chunks with word overlap."""
            words = text.split()
            if not words:
                return []
            chunks = []
            i = 0
            while i < len(words):
                # take as many words as fit in TARGET chars
                cur, j = [], i
                while j < len(words):
                    candidate = (" ".join(cur + [words[j]])).strip()
                    if len(candidate) > MAX and cur:
                        break
                    cur.append(words[j])
                    j += 1
                    if len(" ".join(cur)) >= TARGET:
                        break
                chunks.append(" ".join(cur).strip())
                if j >= len(words):
                    break
                # rewind for overlap
                i = max(j - OVERLAP_WORDS, i + 1)
            return chunks

        # Step 1: paragraph split
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [content.strip()] if content.strip() else []
        if not paragraphs:
            return []

        # Step 2: pack paragraphs into ~TARGET-char chunks
        packed, cur = [], ""
        for p in paragraphs:
            if cur and len(cur) + len(p) + 1 > TARGET:
                packed.append(cur.strip())
                cur = p
            else:
                cur = (cur + " " + p).strip() if cur else p
        if cur:
            packed.append(cur.strip())

        # Step 3: any chunk still too big → split by single newlines, then by words
        out = []
        for chunk in packed:
            if len(chunk) <= MAX:
                out.append(chunk)
                continue
            # try single-newline split first
            sub_lines = [l.strip() for l in chunk.split("\n") if l.strip()]
            sub_packed, scur = [], ""
            for line in sub_lines:
                if scur and len(scur) + len(line) + 1 > TARGET:
                    sub_packed.append(scur.strip())
                    scur = line
                else:
                    scur = (scur + " " + line).strip() if scur else line
            if scur:
                sub_packed.append(scur.strip())
            for sub in sub_packed:
                if len(sub) <= MAX:
                    out.append(sub)
                else:
                    # final fallback: sliding window over words
                    out.extend(sliding_window(sub))

        return [c for c in out if c]

    def _index_tfidf(self, segments, metadata):
        try:
            vec = TfidfVectorizer(
                min_df=1, max_df=0.95, ngram_range=(1, 2),
                stop_words=[greek_normalise(w) for w in self.greek_stop_words],
                max_features=10000, sublinear_tf=True,
                preprocessor=greek_normalise,
            )
            mat = vec.fit_transform(segments)
            self.tfidf_vectorizer = vec
            self.tfidf_matrix = mat
            self.tfidf_documents = segments
            self.document_metadata = metadata
            with open(self._tfidf_path(), "wb") as f:
                pickle.dump({
                    "vectorizer": vec, "matrix": mat,
                    "documents": segments, "metadata": metadata
                }, f)
            logger.info(f"✅ TF-IDF index created with {len(segments)} segments")
        except Exception as e:
            logger.error(f"Error creating TF-IDF index: {e}")

    def _index_faiss(self, segments, metadata):
        try:
            if not EMBEDDINGS_AVAILABLE:
                return
            model = GeminiEmbedder()
            embeds = model.encode(
                segments,
                task_type="RETRIEVAL_DOCUMENT",
                normalize_embeddings=True,
            ).astype(np.float32)

            import faiss
            index = faiss.IndexFlatIP(embeds.shape[1])
            index.add(embeds)

            self.embedding_model = model
            self.faiss_index = index
            self.embedding_documents = segments
            self.embeddings_array = embeds

            with open(self._faiss_data_path(), "wb") as f:
                pickle.dump({
                    "documents": segments,
                    "embeddings": embeds,
                    "model_name": GeminiEmbedder.MODEL,
                    "metadata": metadata
                }, f)
            faiss.write_index(index, self._faiss_index_path())
            logger.info(f"✅ FAISS index created with {len(segments)} segments, dim={embeds.shape[1]} (Gemini text-embedding-004)")
        except Exception as e:
            logger.error(f"Error creating FAISS index: {e}")

    # ---------- querying ----------
    def search_tfidf(self, query, top_k=10, min_score=0.01, predicate=None):
        """Lexical leg. `predicate(meta) -> bool` gates every candidate.

        The filter is applied BEFORE the top_k cut, not after, so a public
        query whose highest-scoring chunks are all internal-only still returns
        its best *permitted* chunks instead of an empty list. That is why the
        candidate pool is widened rather than sliced to top_k up front.
        """
        if self.tfidf_vectorizer is None or self.tfidf_matrix is None:
            return []
        try:
            q = self.tfidf_vectorizer.transform([query])
            sims = cosine_similarity(q, self.tfidf_matrix).flatten()
            # Widen the pool when filtering: the permitted chunks may sit well
            # below the unfiltered top_k.
            pool = len(sims) if predicate is not None else top_k * 2
            idxs = sims.argsort()[-pool:][::-1]
            out = []
            for idx in idxs:
                if sims[idx] < min_score:
                    continue
                meta = self.document_metadata[idx]
                if predicate is not None and not predicate(meta):
                    continue
                item = meta.copy()
                item["score"] = float(sims[idx])
                item["method"] = "tfidf"
                out.append(item)
                if len(out) >= top_k:
                    break
            return out
        except Exception as e:
            logger.error(f"Error in TF-IDF search: {e}")
            return []

    def search_faiss(self, query, top_k=10, min_score=0.1, predicate=None):
        """Semantic leg. Cross-lingual by construction: gemini-embedding-001
        puts a Greek question and an English chunk about the same idea near each
        other, which is why there is no translate-in/translate-out step
        anywhere in this app. `predicate` gates candidates as in search_tfidf.
        """
        if self.embedding_model is None or self.faiss_index is None:
            return []
        try:
            # task_type='RETRIEVAL_QUERY' is critical — Gemini optimises queries
            # differently from documents, this lift accuracy by ~10-15%.
            q = self.embedding_model.encode(
                [query],
                task_type="RETRIEVAL_QUERY",
                normalize_embeddings=True,
            ).astype(np.float32)
            # Widen the candidate pool when filtering, for the same reason as
            # the lexical leg: permitted chunks may rank below the raw top_k.
            n_probe = min(len(self.document_metadata), top_k * 8) if predicate is not None else top_k * 2
            scores, indices = self.faiss_index.search(q, max(n_probe, 1))
            out = []
            for score, idx in zip(scores[0], indices[0]):
                if idx == -1 or float(score) < min_score:
                    continue
                meta = self.document_metadata[idx]
                if predicate is not None and not predicate(meta):
                    continue
                item = meta.copy()
                item["score"] = float(score)
                item["method"] = "faiss"
                out.append(item)
                if len(out) >= top_k:
                    break
            return out
        except Exception as e:
            logger.error(f"Error in FAISS search: {e}")
            return []

    # Domain vocabulary bridging. BPAN's table expanded Greek welfare acronyms
    # (ΚΕΠΑ, ΕΟΠΥΥ, …); none of those mean anything here. The Kintzios problem
    # is different and specifically bilingual: Greek professionals write about
    # work in a mix of Greek and English loanwords ("έχω πρόβλημα με το
    # onboarding", "θέλω feedback από τον manager μου"). The lexical leg cannot
    # bridge those, so the expansion is appended (never substituted) to let a
    # Greek query score on English chunks and vice versa.
    _TERM_EXPANSIONS = {
        # English term -> Greek gloss
        "leadership": "ηγεσία",
        "feedback": "ανατροφοδότηση αξιολόγηση",
        "culture": "κουλτούρα εργασιακό κλίμα",
        "onboarding": "ένταξη νέων εργαζομένων",
        "burnout": "εξουθένωση",
        "turnover": "αποχωρήσεις προσωπικού",
        "retention": "διακράτηση προσωπικού",
        "mentoring": "καθοδήγηση",
        "manager": "προϊστάμενος διευθυντής",
        "promotion": "προαγωγή",
        "keynote": "ομιλία",
        "workshop": "εργαστήριο σεμινάριο",
        # Greek term -> English gloss
        "ηγεσία": "leadership",
        "κουλτούρα": "culture",
        "ομάδα": "team",
        "στέλεχος": "executive manager",
        "στελέχη": "executives managers",
        "καριέρα": "career",
        "προαγωγή": "promotion",
        "παραίτηση": "resignation turnover",
        "εξουθένωση": "burnout",
        "ομιλία": "keynote speech",
        "σεμινάριο": "workshop training",
        "γενιές": "generations multigenerational",
    }

    def _expand_terms(self, query: str) -> str:
        """Append cross-language glosses for domain terms present in the query.

        Whole-token match, case-insensitive, idempotent — each gloss is added at
        most once, and only if it isn't already in the query.
        """
        toks = set(re.findall(r"\w+", query.lower(), flags=re.UNICODE))
        extras = []
        for tok in toks:
            exp = self._TERM_EXPANSIONS.get(tok)
            if exp and exp.lower() not in query.lower():
                extras.append(exp)
        return f"{query} {' '.join(extras)}" if extras else query

    def hybrid_search(self, query, top_k=15, predicate=None, lang=None):
        """Fuse the lexical and semantic legs.

        `predicate` — the rights/speaker gate (see public_filter). Pass None
        ONLY from the authenticated internal route.
        `lang` — optional soft preference. Chunks in the user's language get a
        small score bonus rather than a hard filter, so a Greek question can
        still surface a strong English-only source instead of returning nothing.
        """
        expanded = self._expand_terms(query)
        if expanded != query:
            logger.info("Query expanded: %r -> %r", query, expanded)
        # Fetch a WIDER pool than we return, then rank it.
        #
        # Each leg used to fetch top_k//2+2 — for top_k=6 that is 5 candidates,
        # and the language bonus below can only reorder what was fetched. On
        # «Πες μου για το Gen Z» the lexical leg returned 2 Greek and 4 English
        # candidates out of 86 eligible Greek chunks, so a Greek question got a
        # mostly-English context no matter how large the bonus was. Raising the
        # bonus without widening the pool did nothing, which is exactly what
        # measuring it showed.
        #
        # 3x the final cut, floor 12: enough that same-language material is
        # present to promote, small enough that the sort stays trivial.
        pool = max(12, top_k * 3)
        tf = self.search_tfidf(expanded, top_k=pool, predicate=predicate)
        fa = self.search_faiss(expanded, top_k=pool, predicate=predicate)

        # Same-language chunks win ties AND near-ties.
        #
        # Was 0.05, which is below the spread between adjacent TF-IDF scores on
        # this corpus, so an English chunk routinely outranked a Greek one for a
        # Greek question: «Πες μου για το Gen Z» returned 4 English chunks out
        # of 6. The model then had mostly English context and drifted, which is
        # exactly the failure the language directive exists to prevent —
        # cheaper to fix in ranking than to fight in the prompt.
        #
        # Cross-language retrieval is still POSSIBLE (this is a bonus, not a
        # filter) because he says things in one language that answer questions
        # asked in the other. It just stops being the default.
        LANG_BONUS = 0.35
        for item in tf + fa:
            item["rank_score"] = item["score"] + (
                LANG_BONUS if lang and item.get("lang") == lang else 0.0
            )

        seen, combined = set(), []
        for item in sorted(tf + fa, key=lambda x: x["rank_score"], reverse=True):
            key = item["content"][:100]
            if key not in seen:
                seen.add(key)
                combined.append(item)
                if len(combined) >= top_k:
                    break
        logger.info(
            "Hybrid search: TF-IDF=%d + FAISS=%d -> %d (filtered=%s)",
            len(tf), len(fa), len(combined), predicate is not None,
        )
        return combined

    # ---------- diagnostics ----------
    def stats(self) -> dict:
        """Chunk counts by language / source_type / rights, for the ingest CLI
        and the /health endpoint. Cheap: pure metadata scan."""
        from collections import Counter

        meta = self.document_metadata
        return {
            "chunks": len(meta),
            "by_lang": dict(Counter(m.get("lang", "?") for m in meta)),
            "by_source_type": dict(Counter(m.get("source_type", "?") for m in meta)),
            "by_speaker": dict(Counter(m.get("speaker") or "(none)" for m in meta)),
            "rights_cleared": sum(1 for m in meta if m.get("rights_cleared")),
            "internal_only": sum(1 for m in meta if not m.get("rights_cleared")),
            "persona_eligible": sum(1 for m in meta if public_filter()(m)),
        }
