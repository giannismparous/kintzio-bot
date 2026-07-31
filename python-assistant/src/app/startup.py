"""Startup: build the index, init the DB, prepare the LLM manager.

Adapted from BPAN's startup.py. Two changes worth noting:

  * BPAN logs "✅ Universal LLM Manager initialized (Gemini+OpenRouter)". There
    is no OpenRouter fallback anywhere in that codebase — the string is stale and
    was one of the things the original build brief took at face value. The log
    line here states what actually happens.
  * The LLM manager is created lazily and may legitimately be None. A keyless
    install must still boot, index, retrieve, apply guardrails and capture leads;
    only generation is unavailable. The test suite runs in exactly that state.
"""
from __future__ import annotations

import logging
import os

from app.config import CORPUS_DIR, EMBEDDINGS_DIR, GEMINI_API_KEY, configure_logging
from app.db import init_db

logger = logging.getLogger(__name__)

_llm_manager = None
_llm_tried = False


def get_llm_manager():
    """Return the shared LLM manager, or None when no key is configured.

    Callers must handle None — see routers/api.py, which returns retrieved
    sources with an explicit notice rather than a fabricated answer.
    """
    global _llm_manager, _llm_tried
    if _llm_tried:
        return _llm_manager
    _llm_tried = True
    if not GEMINI_API_KEY:
        logger.warning("No GEMINI_API_KEY — generation disabled (retrieval still works).")
        return None
    try:
        from app.services.llm_manager import UniversalLLMManager
        _llm_manager = UniversalLLMManager()
        logger.info("LLM manager ready (Gemini, key rotation + model fallback).")
    except Exception as e:
        logger.error("LLM manager unavailable: %s", e)
        _llm_manager = None
    return _llm_manager


def build_index(force: bool = False):
    """Load or build the hybrid index over corpus/.

    Loads from disk when a prior index exists, unless FORCE_REINDEX=1 or
    `force`. The corpus is small (hundreds of chunks), so a rebuild costs well
    under a second on the lexical leg — but the semantic leg costs API calls, so
    the cached path stays the default.
    """
    from app.services.indexing import HybridContentIndexer
    from ingest.documents import load_corpus

    indexer = HybridContentIndexer(embeddings_dir=EMBEDDINGS_DIR)
    force = force or os.environ.get("FORCE_REINDEX") == "1"

    if not force:
        try:
            indexer.load_existing_indices()
            if indexer.document_metadata:
                logger.info("Loaded existing index: %s", indexer.stats())
                return indexer
        except Exception as e:
            logger.warning("Could not load existing index (%s) — rebuilding.", e)

    records = load_corpus(CORPUS_DIR)
    if not records:
        logger.error("Corpus at %s is empty — the assistant cannot answer.", CORPUS_DIR)
        return indexer
    indexer.index_content(records)
    stats = indexer.stats()
    logger.info("Index built: %s", stats)
    if stats.get("persona_eligible", 0) == 0:
        logger.error(
            "0 persona-eligible chunks. Check speaker/rights_cleared frontmatter — "
            "the public assistant will refuse every question."
        )
    return indexer


def startup(app) -> None:
    """Called from main.py's lifespan handler."""
    configure_logging()
    init_db()
    app.state.indexer = build_index()
    get_llm_manager()

    from app.security import auth_is_configured
    from app.config import ALLOW_INSECURE_ADMIN
    if not auth_is_configured():
        if ALLOW_INSECURE_ADMIN:
            logger.warning(
                "ALLOW_INSECURE_ADMIN=1 and no credentials set: /admin and "
                "/internal are UNPROTECTED. Do not run this in production."
            )
        else:
            logger.warning(
                "INTERNAL_USER/INTERNAL_PASSWORD unset — /admin and /internal "
                "will return 503 (fail closed). Set them in .env to enable."
            )
