"""Public API: the persona endpoint and the pillar navigator.

Pipeline order is the whole design, so it is worth stating plainly. For each
question:

  1. detect language                     (persona.detect_lang)
  2. guardrails                          (guardrails.classify)
       distress  → crisis response, no model call, no retrieval
       refuse    → branded refusal, no model call, no retrieval
  3. retrieve with the PUBLIC filter     (indexing.public_filter)
       empty     → no-answer response, logged as an unanswered question
  4. build prompt: directive · persona · facts · sources · question · directive
  5. generate                            (llm_manager)
  6. verify quotes deterministically     (grounding.check_quotes)
       ungrounded → removed before the user sees them
  7. render citations                    (citations.apply_citations)

Steps 2 and 6 are non-negotiable and cannot be reordered: a guardrail after a
model call is a guardrail you pay for and might not get, and a quote check after
citation rendering would have to parse its own output.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as OrmSession

from app.config import DEFAULT_LANG, PERSONA_SPEAKER, scheduler_line
from app.db import get_db
from app.models import UnansweredQuestion, UserSession
from app.services import guardrails
from app.services.citations import apply_citations, format_history
from app.services.grounding import check_quotes, redact_ungrounded
from app.services.indexing import public_filter, searchable_filter
from app.services.persona import build_prompt, detect_lang

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["public"])

# Retrieval floor. Below this the corpus has nothing genuinely relevant and the
# honest answer is the no-answer response. Set from the observed TF-IDF score
# distribution on the seed corpus; the semantic leg scores higher, so this only
# ever binds on the lexical path.
# Retrieval thresholds. MEASURED, on the 158-chunk seed corpus, over 10 on-topic
# and 8 off-topic probes (see tests/test_relevance.py, which pins the finding):
#
#   on-topic   min 0.060  p25 0.097  median 0.152  max 0.325
#   off-topic  min 0.068  median 0.098  p75 0.134  max 0.200
#
# The distributions OVERLAP ALMOST COMPLETELY. Off-topic max (0.200, "who won the
# Nobel prize in physics") exceeds on-topic median. There is therefore no score
# cut that separates topic from non-topic on this corpus, and any single threshold
# claiming to is miscalibrated by construction.
#
# That is why the off-topic decision is NOT a score test — it needs the topical
# vocabulary signal, and the score only serves as a weak corroborator. An earlier
# STRONG_RELEVANCE of 0.16 let the Nobel question through as "answered" precisely
# because it read a score above threshold as evidence of relevance. Raised to
# 0.34, above the observed on-topic max, which makes the override deliberately
# near-inert: retrieval score can no longer overrule the vocabulary gate on its
# own. Re-measure both numbers when the real corpus lands (ARCHITECTURE_NOTES §11).
MIN_RELEVANCE = 0.045       # floor: below this there is nothing worth citing
STRONG_RELEVANCE = 0.34     # above the measured on-topic max; see note above
TOP_K = 8


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    session_id: str | None = None
    lang: str | None = None          # optional override; otherwise detected


class AskResponse(BaseModel):
    answer: str
    lang: str
    action: str                      # answered | refused | distress | no_answer
    sources: list[dict] = []
    disclosed: bool = False
    grounding: dict | None = None


def _get_indexer(request: Request):
    """The indexer built at startup and held on app.state (BPAN pattern)."""
    return getattr(request.app.state, "indexer", None)


def _disclose(session: UserSession, body: str, lang: str) -> tuple[str, bool]:
    """Prepend the EU AI Act Art. 50 notice to the first assistant message.

    Every response path must go through this — a refusal, a crisis response and a
    price deflection are all assistant messages, and Art. 50 attaches to the
    interaction, not to whether a model was invoked. Returns (body, disclosed_now)
    so the caller can report which message carried it.
    """
    if session.disclosed:
        return body, False
    session.disclosed = 1
    return guardrails.disclosure(lang) + body, True


def _touch_session(db: OrmSession, session_id: str | None, lang: str) -> UserSession:
    """Fetch-or-create the session row. `disclosed` drives the Art. 50 notice."""
    sid = session_id or str(uuid.uuid4())
    row = db.get(UserSession, sid)
    if row is None:
        row = UserSession(
            session_id=sid, created_at=datetime.utcnow(),
            conversation_data=[], consents={}, disclosed=0,
        )
        db.add(row)
    row.last_activity = datetime.utcnow()
    row.lang = lang
    return row


@router.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, request: Request, db: OrmSession = Depends(get_db)):
    """The persona endpoint. See the module docstring for the pipeline order."""
    question = payload.question.strip()
    lang = payload.lang if payload.lang in ("el", "en") else detect_lang(question)
    session = _touch_session(db, payload.session_id, lang)

    # --- 2. guardrails, before anything expensive or networked ---------------
    verdict = guardrails.classify(question)
    if verdict["action"] in ("distress", "refuse"):
        body = (
            guardrails.distress_response(lang)
            if verdict["action"] == "distress"
            else guardrails.refusal_response(verdict["class"], lang)
        )
        session.intent = verdict["class"]
        body, disclosed_now = _disclose(session, body, lang)
        db.commit()
        # Deliberately NOT logged to unanswered_questions: a refusal is the
        # system working, and a distress message is not content-pipeline input.
        return AskResponse(
            answer=body, lang=lang, action=verdict["action"], sources=[],
            disclosed=disclosed_now,
        )

    # --- 2b. price questions never reach the model ---------------------------
    # The corpus contains no prices, so retrieval would return adjacent service
    # copy and the model might synthesise a plausible-sounding range from it. A
    # number invented here becomes an anchor he has to argue down later, so the
    # deflection is deterministic and happens before generation.
    from app.routers.leads import is_price_question, price_deflection
    if is_price_question(question):
        session.intent = "price"
        body, disclosed_now = _disclose(session, price_deflection(lang), lang)
        db.commit()
        return AskResponse(
            answer=body, lang=lang, action="price",
            sources=[], disclosed=disclosed_now,
        )

    # --- 3. retrieval under the public filter --------------------------------
    indexer = _get_indexer(request)
    docs = []
    if indexer is not None:
        docs = indexer.hybrid_search(
            question, top_k=TOP_K, predicate=public_filter(PERSONA_SPEAKER), lang=lang
        )
        docs = [d for d in docs if d.get("score", 0) >= MIN_RELEVANCE]

    top_score = max((d.get("score", 0.0) for d in docs), default=0.0)

    # Off-topic gate. Retrieval score alone cannot decide this: on the seed
    # corpus an off-topic question ("capital of Peru") still scores ~0.10 against
    # a real one at ~0.19, because TF-IDF matches stopwords and shared function
    # words. So the decision needs BOTH signals — no topical vocabulary AND weak
    # retrieval. Either signal alone is insufficient:
    #   * strong retrieval without vocabulary = a rephrased on-topic question
    #   * vocabulary without retrieval = in scope but not covered → no_answer
    if not verdict.get("topical", True) and top_score < STRONG_RELEVANCE:
        session.intent = "off_topic"
        db.commit()
        logger.info("Off-topic: %r (top=%.3f)", question[:60], top_score)
        body, disclosed_now = _disclose(session, guardrails.off_topic_response(lang), lang)
        db.commit()
        return AskResponse(
            answer=body, lang=lang,
            action="off_topic", sources=[], disclosed=disclosed_now,
        )

    if not docs:
        db.add(UnansweredQuestion(question=question[:2000], lang=lang, top_score=0.0))
        session.intent = "no_answer"
        db.commit()
        logger.info("No retrieval for %r (%s)", question[:60], lang)
        body, disclosed_now = _disclose(session, guardrails.no_answer_response(lang), lang)
        db.commit()
        return AskResponse(
            answer=body, lang=lang,
            action="no_answer", sources=[], disclosed=disclosed_now,
        )

    # --- 4. prompt ----------------------------------------------------------
    history = format_history(session.conversation_data or [], lang)
    prompt = build_prompt(question, docs, lang, history)

    # --- 5. generate --------------------------------------------------------
    from app.startup import get_llm_manager
    mgr = get_llm_manager()
    if mgr is None:
        # Keyless install: retrieval and guardrails work, generation doesn't.
        # Say so plainly instead of pretending, and still show the sources —
        # they are the useful part and this is what the offline test suite sees.
        note = (
            "<p><i>Το μοντέλο δεν είναι διαθέσιμο (λείπει GEMINI_API_KEY). "
            "Παρακάτω οι σχετικές πηγές από το υλικό του.</i></p>"
            if lang == "el" else
            "<p><i>The model is unavailable (GEMINI_API_KEY not set). Below are "
            "the relevant sources from his material.</i></p>"
        )
        body = note + "".join(
            f"<p>{(d.get('content') or '')[:300]}… [{i}]</p>"
            for i, d in enumerate(docs[:3], 1)
        )
        body = apply_citations(body, docs, lang)
        # The Art. 50 disclosure is a legal obligation on the FIRST assistant
        # message, and it does not become optional because generation is
        # unavailable. An earlier version returned here before the disclosure
        # block below, so a keyless deployment served undisclosed AI output.
        body, disclosed_now = _disclose(session, body, lang)
        db.commit()
        return AskResponse(
            answer=body, lang=lang, action="answered",
            sources=_public_sources(docs), disclosed=disclosed_now,
        )

    raw = await mgr.generate_with_multi_fallback(prompt)
    answer = (raw or "").strip()
    if not answer:
        body, disclosed_now = _disclose(session, guardrails.no_answer_response(lang), lang)
        db.commit()
        return AskResponse(
            answer=body, lang=lang,
            action="no_answer", sources=[], disclosed=disclosed_now,
        )

    # --- 6. deterministic quote verification --------------------------------
    report = check_quotes(answer, docs)
    if not report["ok"]:
        answer = redact_ungrounded(answer, report, lang)

    # --- 7. citations + disclosure ------------------------------------------
    answer = apply_citations(answer, docs, lang)
    answer, disclosed_now = _disclose(session, answer, lang)

    hist = list(session.conversation_data or [])
    hist.append({"question": question, "answer": answer[:2000],
                 "ts": datetime.utcnow().isoformat()})
    session.conversation_data = hist[-10:]
    session.intent = "answered"
    db.commit()

    return AskResponse(
        answer=answer, lang=lang, action="answered",
        sources=_public_sources(docs), disclosed=disclosed_now,
        grounding={"checked": report["checked"], "grounded": report["grounded"],
                   "removed": len(report["ungrounded"])},
    )


def _public_sources(docs: list[dict]) -> list[dict]:
    """Trim retrieved chunks to what the client may see.

    The chunk text itself is not returned: the answer quotes what it needs, and
    shipping full corpus text to the browser would make the whole corpus
    scrapeable one question at a time.
    """
    return [
        {
            "n": i,
            "title": d.get("title", ""),
            "url": d.get("url", ""),
            "source_type": d.get("source_type", ""),
            "episode": d.get("episode", ""),
            "timestamp": d.get("timestamp", ""),
            "lang": d.get("lang", ""),
        }
        for i, d in enumerate(docs, 1)
    ]


# --------------------------------------------------------------------------- #
# Keynote-pillar navigator.
#
# Not in the original brief. It exists because his site promises ~50 thematic
# pillars and lists none of them, so a prospect who wants to know whether he
# covers their problem has to email and wait. This turns that into a lookup.
# --------------------------------------------------------------------------- #
class PillarRequest(BaseModel):
    problem: str = Field(min_length=3, max_length=1000)
    lang: str | None = None


@router.post("/pillars/match")
async def match_pillars(payload: PillarRequest, request: Request):
    """Match a free-text business problem to keynote pillars.

    Retrieval is restricted to `source_type == "pillar"` in the requested
    language, then grouped by `pillar_slug` so the GR and EN variants of one
    pillar never both appear. Returns at most three: a prospect choosing among
    three feels guided, among ten feels sold to.
    """
    lang = payload.lang if payload.lang in ("el", "en") else detect_lang(payload.problem)
    indexer = _get_indexer(request)
    if indexer is None:
        return {"lang": lang, "pillars": [], "next_step": scheduler_line(lang)}

    def _pillars_only(meta: dict) -> bool:
        return (
            searchable_filter()(meta)
            and meta.get("source_type") == "pillar"
            and meta.get("lang") == lang
        )

    hits = indexer.hybrid_search(
        payload.problem, top_k=12, predicate=_pillars_only, lang=lang
    )

    seen, out = set(), []
    for h in hits:
        slug = h.get("pillar_slug") or h.get("title")
        if slug in seen:
            continue
        seen.add(slug)
        out.append({
            "slug": slug,
            "title": h.get("title", ""),
            "summary": (h.get("content") or "")[:400],
            "url": h.get("url", ""),
            "score": round(h.get("score", 0.0), 3),
            "placeholder": bool(h.get("placeholder")),
        })
        if len(out) >= 3:
            break

    if not out:
        msg = (
            "Δεν βρήκα πυλώνα που να ταιριάζει ακριβώς. Ο Κωνσταντίνος φτιάχνει "
            "και νέο θεματικό πυλώνα όταν χρειάζεται."
            if lang == "el" else
            "I didn't find a pillar that matches exactly. Konstantinos builds a "
            "new thematic pillar when the need calls for it."
        )
        return {"lang": lang, "pillars": [], "message": msg,
                "next_step": scheduler_line(lang)}

    return {"lang": lang, "pillars": out, "next_step": scheduler_line(lang)}


@router.get("/health")
async def health(request: Request):
    """Liveness + what is actually indexed. Safe to expose: counts only."""
    indexer = _get_indexer(request)
    from app.services.indexing import EMBEDDINGS_AVAILABLE
    return {
        "status": "ok" if indexer is not None else "degraded",
        "semantic_leg": EMBEDDINGS_AVAILABLE,
        "index": indexer.stats() if indexer is not None else {},
    }
