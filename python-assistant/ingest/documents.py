"""Load corpus markdown into indexable records.

Neither reference app has this: BPAN indexes a scraped-JSON blob
(`content/all_content.json`) produced by its crawler, and Chios does the same.
Kintzios's corpus is hand-curated markdown with a rights/attribution contract in
the frontmatter, so ingest reads files and carries the flags through.

Records returned here are chunked (plain documents by the indexer's paragraph
packer, transcripts by `transcripts.py`) and every one carries the metadata the
retrieval filter reads.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# --- frontmatter -----------------------------------------------------------
_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _coerce(v: str):
    """YAML-ish scalar coercion.

    We parse frontmatter by hand rather than importing yaml, because the flags
    that matter are booleans and a silent string-vs-bool mismatch is exactly the
    bug class we cannot afford: `rights_cleared: "false"` is truthy as a string.
    Anything not recognised as a bool/list/number stays a stripped string.
    """
    v = v.strip()
    if v.startswith(("[", "(")) and v.endswith(("]", ")")):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]

    # Quotes are stripped BEFORE the bool check, not after. The docstring above
    # names `rights_cleared: "false"` as the bug class this function exists to
    # prevent — and the original order failed on exactly that input, returning
    # the string "false" (truthy) because the quotes were never removed. Writing
    # a quoted boolean is normal YAML habit, so this is a likely input, not an
    # exotic one.
    #
    # But a quoted value must NEVER become a number: `episode: "002"` is an
    # identifier, and numeric coercion turns it into 2, breaking every lookup and
    # citation that formats it back. Quoting is the author's explicit signal that
    # the value is text, so bools are honoured (they are flags either way) and
    # number coercion is skipped.
    was_quoted = len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'"
    if was_quoted:
        v = v[1:-1].strip()
        low = v.lower()
        if low in ("true", "yes"):
            return True
        if low in ("false", "no"):
            return False
        return v

    low = v.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if low in ("null", "none", "~", ""):
        return None
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    return v.strip().strip("'\"")


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (metadata, body). No frontmatter → ({}, text)."""
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    meta: dict = {}
    for line in m.group(1).split("\n"):
        line = line.rstrip()
        if not line or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = _coerce(val)
    return meta, text[m.end():]


def strip_html_comments(body: str) -> str:
    """Drop the <!-- PLACEHOLDER … --> notes so they never reach retrieval."""
    return re.sub(r"<!--.*?-->", " ", body, flags=re.DOTALL)


# --- loading ---------------------------------------------------------------
def load_document(path: Path) -> list[dict]:
    """Load one non-transcript markdown file into a single record.

    The record is not chunked here — the indexer's paragraph packer handles
    plain prose, which keeps chunking policy for documents in one place.
    """
    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)
    body = strip_html_comments(body).strip()
    if not body:
        return []

    rights = meta.get("rights_cleared")
    if rights is None:
        # Fail safe, and loudly: an un-flagged file is internal-only. Silently
        # defaulting to cleared would leak content the moment someone forgets
        # the flag.
        logger.warning("%s has no rights_cleared flag — treating as NOT cleared", path.name)
        rights = False

    return [{
        "content": body,
        "url": meta.get("url", "") or "",
        "title": meta.get("title", "") or path.stem,
        "lang": meta.get("lang", "el"),
        "speaker": meta.get("speaker", "") or "",
        "rights_cleared": bool(rights),
        "source_type": meta.get("source_type", "") or "",
        "pillar_slug": meta.get("pillar_slug", "") or "",
        "placeholder": bool(meta.get("placeholder", False)),
        "tags": meta.get("tags", []),
        "formats": meta.get("formats", []),
    }]


def load_corpus(corpus_dir: str) -> list[dict]:
    """Walk the corpus and return every indexable record.

    Transcripts are routed to the speaker-turn chunker; everything else to
    load_document. Files under a directory named `transcripts` are transcripts
    regardless of their source_type, and a `source_type: transcript` file is a
    transcript regardless of where it sits — either signal is enough.
    """
    from ingest.transcripts import load_transcript

    root = Path(corpus_dir)
    records: list[dict] = []
    for path in sorted(root.rglob("*.md")):
        if path.name.upper() == "README.MD":
            continue
        try:
            head = path.read_text(encoding="utf-8")[:600]
            is_transcript = (
                "transcripts" in {p.name for p in path.parents}
                or re.search(r"^source_type:\s*transcript\s*$", head, re.M) is not None
            )
            records.extend(
                load_transcript(path) if is_transcript else load_document(path)
            )
        except Exception as e:
            logger.error("Failed to load %s: %s", path, e)
    logger.info("Loaded %d records from %s", len(records), corpus_dir)
    return records
