"""Rebuild the index from corpus/.

    python -m ingest              # build (TF-IDF always; FAISS if a key is set)
    python -m ingest --stats      # report what is indexed, build nothing

Mirrors the dev workflow of the other two apps, which rebuild on startup via
startup.py. Having it as a CLI too means the corpus can be re-indexed without
bouncing the server, and the test suite can call the same code path.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Make src/ importable when run as `python -m ingest` from the app root.
_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))
sys.path.insert(0, str(_ROOT))

from app.config import CORPUS_DIR, EMBEDDINGS_DIR, configure_logging  # noqa: E402
from app.services.indexing import HybridContentIndexer  # noqa: E402
from ingest.documents import load_corpus  # noqa: E402

logger = logging.getLogger("ingest")


def build(stats_only: bool = False) -> dict:
    configure_logging()
    indexer = HybridContentIndexer(embeddings_dir=EMBEDDINGS_DIR)

    if stats_only:
        indexer.load_existing_indices()
        return indexer.stats()

    records = load_corpus(CORPUS_DIR)
    if not records:
        logger.error("No records found under %s — nothing indexed.", CORPUS_DIR)
        return {"chunks": 0}
    indexer.index_content(records)
    return indexer.stats()


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m ingest")
    ap.add_argument("--stats", action="store_true", help="report the existing index only")
    args = ap.parse_args()

    st = build(stats_only=args.stats)
    print(json.dumps(st, ensure_ascii=False, indent=2))

    # A corpus with zero persona-eligible chunks means the public bot can never
    # answer anything. Surface that as a non-zero exit rather than a silent win.
    if not args.stats and st.get("persona_eligible", 0) == 0:
        print("\nWARNING: 0 persona-eligible chunks — check speaker/rights_cleared flags.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
