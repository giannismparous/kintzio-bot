"""Team-only internal search over the FULL index, and the unanswered-questions log.

Adapted from BPAN's `routers/internal.py` (an authenticated dashboard behind
`require_internal_user`). The auth dependency is the same name but a different
contract: it now fails closed (see security.py).

This route is the deliberate mirror image of the public one:

| | public `/api/ask` | internal `/api/internal/search` |
|---|---|---|
| rights filter | `rights_cleared == True` required | none |
| speaker filter | `speaker == Kintzios` required | none |
| auth | none | HTTP Basic, fail-closed |
| returns | generated answer + citations | raw chunks + speaker + timestamp |

It returns chunk text verbatim and does not call the LLM. That is the point:
"which episode did I talk about promoting someone into management too early?" is
a lookup, and a generated paraphrase would be strictly worse than the quote plus
the timestamp.

Because it sees non-rights-cleared material and other speakers' turns, the auth
gate is the only thing separating it from a rights breach. `tests/test_rights.py`
asserts both directions: the internal route can reach the non-cleared fixture and
the public route cannot.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.models import Lead, UnansweredQuestion
from app.security import require_internal_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal", tags=["internal"])


@router.get("/search")
async def search(
    request: Request,
    q: str = Query(min_length=2, max_length=500),
    lang: str | None = None,
    speaker: str | None = None,
    source_type: str | None = None,
    include_uncleared: bool = True,
    top_k: int = 20,
    user: str = Depends(require_internal_user),
):
    """Hybrid search over everything indexed.

    `include_uncleared=False` narrows to publishable material — useful when the
    team is looking for a quote they can actually use in a post, as opposed to
    finding where something was said.
    """
    indexer = getattr(request.app.state, "indexer", None)
    if indexer is None:
        return {"query": q, "count": 0, "results": [], "detail": "index not built"}

    def _pred(meta: dict) -> bool:
        if not include_uncleared and not meta.get("rights_cleared"):
            return False
        if lang and meta.get("lang") != lang:
            return False
        if speaker and (meta.get("speaker") or "") != speaker:
            return False
        if source_type and meta.get("source_type") != source_type:
            return False
        return True

    hits = indexer.hybrid_search(q, top_k=min(top_k, 50), predicate=_pred, lang=lang)
    return {
        "query": q,
        "count": len(hits),
        "results": [
            {
                "content": h.get("content", ""),
                "title": h.get("title", ""),
                "speaker": h.get("speaker", ""),
                "episode": h.get("episode", ""),
                "timestamp": h.get("timestamp", ""),
                "lang": h.get("lang", ""),
                "source_type": h.get("source_type", ""),
                "rights_cleared": bool(h.get("rights_cleared")),
                "url": h.get("url", ""),
                "score": round(h.get("score", 0.0), 3),
                "method": h.get("method", ""),
            }
            for h in hits
        ],
    }


@router.get("/unanswered")
async def unanswered(
    db: OrmSession = Depends(get_db),
    limit: int = 200,
    user: str = Depends(require_internal_user),
):
    """Questions the corpus could not answer, most frequent first.

    This is the content-pipeline view. He built *Reboot Your Career* out of
    "thousands of your messages," so the argument for it is already made — this
    is that signal collected continuously instead of by hand. Grouping is on the
    normalised question text, which is crude but honest; the useful output is the
    ranked list of themes, not exact counts.
    """
    rows = (
        db.query(
            func.lower(UnansweredQuestion.question).label("q"),
            UnansweredQuestion.lang,
            func.count().label("n"),
            func.max(UnansweredQuestion.created_at).label("last_seen"),
        )
        .group_by(func.lower(UnansweredQuestion.question), UnansweredQuestion.lang)
        .order_by(func.count().desc())
        .limit(min(limit, 1000))
        .all()
    )
    return {
        "count": len(rows),
        "questions": [
            {
                "question": r.q,
                "lang": r.lang,
                "times_asked": r.n,
                "last_seen": r.last_seen.isoformat() if r.last_seen else None,
            }
            for r in rows
        ],
    }


@router.get("/stats")
async def stats(
    request: Request,
    db: OrmSession = Depends(get_db),
    user: str = Depends(require_internal_user),
):
    """Index + funnel counts on one page."""
    indexer = getattr(request.app.state, "indexer", None)
    lead_rows = (
        db.query(Lead.flow, func.count().label("n")).group_by(Lead.flow).all()
    )
    return {
        "index": indexer.stats() if indexer is not None else {},
        "leads_by_flow": {r.flow: r.n for r in lead_rows},
        "leads_total": sum(r.n for r in lead_rows),
        "unanswered_total": db.query(func.count(UnansweredQuestion.id)).scalar() or 0,
    }
