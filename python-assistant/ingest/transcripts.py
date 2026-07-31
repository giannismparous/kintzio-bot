"""Speaker-turn-aware transcript chunker.

THE HIGHEST-RISK MODULE IN THIS APP. Everything else fails loudly; this one
fails silently.

The product guarantee is "the bot never presents someone else's words as
Kintzios's opinion." That guarantee is enforced downstream by a metadata filter
(`indexing.public_filter`) which trusts one thing: that a chunk's `speaker`
field describes *all* the text in that chunk. If a chunk ever spans a turn
boundary — his answer plus the guest's next sentence — the filter still passes
it (speaker is his), the LLM quotes it, the citation looks correct, and the
guest's opinion is now attributed to him. Nothing errors. Nobody notices.

So the invariant here is absolute: **one chunk, one speaker.** Turns are split
first; only then are *consecutive turns by the same speaker* packed together.
A long single turn is split within itself, never merged across the boundary.
The invariant is covered by `tests/test_chunker.py::test_no_chunk_spans_two_speakers`
and `::test_dialogue_colon_is_not_a_turn_header` — if that file is absent, this
module is running without its safety net and the invariant is unverified.

Why not reuse BPAN's `_split_content()`? It packs on paragraph boundaries with a
sliding-window fallback and has no concept of a speaker, so it would happily
merge across turns. It is still used for plain documents, where no such
structure exists.

Transcript format (the contract in corpus/README.md):

    [00:31] Kintzios: Θα σου πω κάτι που δεν αρέσει σε κανέναν manager…

    [01:20] Guest: Στην εταιρεία μας βλέπουμε μεγάλο turnover.

Timestamp is optional; the speaker label and the colon are not.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# A turn header is `[mm:ss] Speaker:` or, only for a speaker named in the file's
# `speakers:` frontmatter, a bare `Speaker:`.
#
# The bare form CANNOT be matched by a permissive label pattern. An earlier
# version used `^[\w .'_-]{1,40}?\s*:` for it, and that pattern matches ordinary
# dialogue containing a colon: "Το θέμα είναι: δεν ρωτάμε" parsed as speaker
# "Το θέμα είναι". That is the exact silent-attribution failure this module
# exists to prevent — it invents a speaker, `chunk_turns` then trusts the
# invented label absolutely, and no error is raised anywhere.
#
# So the bare form is resolved against the declared cast instead of guessed from
# shape. A transcript declares who is in it; anything else at column 0 is
# dialogue continuation, not a header.
_TS_TURN_RE = re.compile(
    r"^\[(?P<ts>\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?P<speaker>[^:\[\]]{1,40}?)\s*:\s*(?P<text>.*)$",
    re.UNICODE,
)


def _bare_turn(line: str, cast: set[str]) -> tuple[str, str] | None:
    """Match `Speaker: text` only when Speaker is in the declared cast."""
    if not cast or ":" not in line:
        return None
    label, _, rest = line.partition(":")
    label = label.strip()
    if label in cast:
        return label, rest.strip()
    # Case-insensitive second chance, so "KINTZIOS:" matches a cast of
    # ["Kintzios"] — but still only against declared names.
    low = {c.lower(): c for c in cast}
    if label.lower() in low:
        return low[label.lower()], rest.strip()
    return None

# Chunk sizing. Smaller than the document target (700) because a spoken turn is
# a tighter semantic unit and over-long chunks dilute retrieval.
TARGET = 600
MAX = 900
MIN_CHARS = 40


def _iter_turns(body: str, cast: set[str] | None = None):
    """Yield (timestamp, speaker, text) in order.

    `cast` is the file's declared `speakers:` list; it is what makes the bare
    `Speaker:` form safe (see `_bare_turn`). Without it, only timestamped headers
    are recognised — a stricter and still correct reading.

    Continuation lines (a wrapped turn with no header) attach to the current
    turn. Text before the first header is skipped: guessing a speaker for it is
    precisely the mistake this module exists to prevent.
    """
    cast = cast or set()
    cur_ts: str = ""
    cur_sp: str | None = None
    buf: list[str] = []

    def flush():
        if cur_sp is not None:
            text = " ".join(buf).strip()
            if text:
                return (cur_ts, cur_sp, text)
        return None

    for raw in body.split("\n"):
        line = raw.strip()
        if not line:
            continue

        ts, sp, txt = "", None, ""
        m = _TS_TURN_RE.match(line)
        if m:
            ts, sp, txt = m.group("ts") or "", m.group("speaker").strip(), (m.group("text") or "").strip()
        else:
            bare = _bare_turn(line, cast)
            if bare:
                sp, txt = bare

        if sp is not None:
            done = flush()
            if done:
                yield done
            cur_ts, cur_sp, buf = ts, sp, [txt]
        else:
            if cur_sp is None:
                continue  # preamble before the first turn — skip, never guess
            buf.append(line)

    done = flush()
    if done:
        yield done


def _split_long_turn(text: str) -> list[str]:
    """Split one over-long turn on sentence boundaries.

    Operates strictly inside a single turn, so it cannot cross a speaker
    boundary. Greek uses ';' as a question mark and '·' as a semicolon, so both
    are sentence terminators here.
    """
    parts = re.split(r"(?<=[.!?;·])\s+", text)
    out, cur = [], ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if cur and len(cur) + len(p) + 1 > TARGET:
            out.append(cur.strip())
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur.strip())

    # A single sentence longer than MAX (rambling monologue, no punctuation):
    # fall back to a word window. Still within one turn.
    final = []
    for chunk in out:
        if len(chunk) <= MAX:
            final.append(chunk)
            continue
        words, cur_w = chunk.split(), []
        for w in words:
            if cur_w and len(" ".join(cur_w + [w])) > TARGET:
                final.append(" ".join(cur_w))
                cur_w = [w]
            else:
                cur_w.append(w)
        if cur_w:
            final.append(" ".join(cur_w))
    return [c for c in final if c]


def chunk_turns(turns: list[tuple[str, str, str]]) -> list[dict]:
    """Pack turns into chunks. One chunk never spans two speakers.

    Consecutive turns by the SAME speaker are merged up to TARGET chars — a
    host's three-line follow-up shouldn't become three chunks. The moment the
    speaker changes, the buffer is flushed unconditionally.
    """
    chunks: list[dict] = []
    cur_sp = None
    cur_ts = ""
    cur_text: list[str] = []

    def flush():
        nonlocal cur_sp, cur_ts, cur_text
        if cur_sp is None:
            return
        joined = " ".join(cur_text).strip()
        if joined:
            for piece in ([joined] if len(joined) <= MAX else _split_long_turn(joined)):
                if len(piece) >= MIN_CHARS:
                    chunks.append({"speaker": cur_sp, "timestamp": cur_ts, "content": piece})
        cur_sp, cur_ts, cur_text = None, "", []

    for ts, sp, text in turns:
        if sp != cur_sp:
            flush()                       # speaker changed → hard boundary
            cur_sp, cur_ts = sp, ts
            cur_text = [text]
            continue
        if len(" ".join(cur_text)) + len(text) + 1 > TARGET:
            flush()
            cur_sp, cur_ts = sp, ts       # same speaker, new chunk
            cur_text = [text]
        else:
            cur_text.append(text)
    flush()
    return chunks


def load_transcript(path: Path) -> list[dict]:
    """Load one transcript file into per-turn indexable records."""
    from ingest.documents import parse_frontmatter, strip_html_comments

    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)
    body = strip_html_comments(body)

    rights = meta.get("rights_cleared")
    if rights is None:
        logger.warning(
            "%s has no rights_cleared flag — treating as NOT cleared", path.name
        )
        rights = False

    declared = meta.get("speakers") or []
    if isinstance(declared, str):
        declared = [declared]
    cast = {str(s).strip() for s in declared if str(s).strip()}

    turns = list(_iter_turns(body, cast))
    if not turns:
        logger.warning("%s parsed to zero turns — check the [mm:ss] Speaker: format", path.name)
        return []

    # A speaker parsed out of the body but absent from `speakers:` frontmatter is
    # either a typo in the transcript or a cast list that was never updated. Both
    # are attribution risks, so it is surfaced rather than absorbed. Not fatal:
    # the chunk keeps its parsed speaker, and since the public filter requires an
    # exact match on PERSONA_SPEAKER, an unrecognised name fails closed anyway.
    if cast:
        unknown = {sp for _, sp, _ in turns if sp not in cast}
        if unknown:
            logger.warning(
                "%s: speaker(s) %s not in declared speakers: %s — check the "
                "frontmatter cast list.",
                path.name, sorted(unknown), sorted(cast),
            )

    episode = str(meta.get("episode", "") or "")
    title = meta.get("title", "") or path.stem
    records = []
    for ch in chunk_turns(turns):
        records.append({
            "content": ch["content"],
            "url": meta.get("url", "") or "",
            "title": f"{title} [{ch['timestamp']}]" if ch["timestamp"] else title,
            "lang": meta.get("lang", "el"),
            "speaker": ch["speaker"],
            "rights_cleared": bool(rights),
            "source_type": "transcript",
            "episode": episode,
            "timestamp": ch["timestamp"],
            "placeholder": bool(meta.get("placeholder", False)),
        })
    logger.info(
        "%s → %d turns → %d chunks (%s)",
        path.name, len(turns), len(records),
        "cleared" if rights else "INTERNAL ONLY",
    )
    return records
