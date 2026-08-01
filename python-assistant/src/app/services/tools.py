"""Tools the model may call, and the dispatch that runs them.

WHY THIS EXISTS
---------------
Before this module the router decided everything with `if` statements: price
question here, pillar question there, lead capture behind a form. That is the
same mistake as the scope keyword list — a human enumerating cases the model
should be judging. A visitor asking "do you run workshops for tech teams and
what would you cover?" is asking TWO questions, and a single retrieval pass
answered half of one.

So the model gets tools and picks. What it does NOT get is anything that is a
safety or legal invariant:

  * distress   — runs before the loop, deterministically. It has to work when
                 the model is down, and a missed distress signal is the worst
                 failure this app can produce.
  * price      — runs before the loop. An invented number becomes an anchor he
                 has to argue down later.
  * rights     — NOT a tool parameter. `search_corpus` applies the public
                 filter internally and the model has no argument that can widen
                 it. Spyros Andrianos's material staying out of public answers
                 is a contract term, not a judgement call.

The model chooses WHICH tool and WITH WHAT QUERY. It never chooses whether the
rights filter applies.
"""
from __future__ import annotations

import logging

from app.config import PERSONA_SPEAKER
from app.services.indexing import public_filter

logger = logging.getLogger(__name__)

# Retrieval budget per tool call. Tuned against TOP_K in the router: large
# enough that a second tool call sees new material, small enough that three
# calls do not blow the context window.
TOOL_TOP_K = 6
MAX_PILLARS = 4


# --------------------------------------------------------------------------
# Declarations. Kept as plain dicts rather than SDK objects so this module
# imports with no `google.generativeai` present — the offline test suite and
# the keyless install both depend on that.
# --------------------------------------------------------------------------
TOOL_SCHEMAS = [
    {
        "name": "search_corpus",
        "description": (
            "Search Konstantinos Kintzios's published material (site pages, "
            "podcast transcripts, articles) for passages relevant to a topic. "
            "Use this for any question about his views, methods or experience. "
            "You may call it more than once with different phrasings if the "
            "first result set is thin."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search phrase, in the user's language.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "match_pillars",
        "description": (
            "Given a business or people problem in the user's own words, return "
            "the keynote/workshop themes ('pillars') Konstantinos covers that "
            "address it. Use when someone describes a problem rather than asking "
            "a question, or when they ask what he could speak about."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "problem": {
                    "type": "string",
                    "description": "The problem, in the user's own words.",
                },
            },
            "required": ["problem"],
        },
    },
    {
        "name": "start_lead_flow",
        "description": (
            "Begin qualifying an enquiry when the user shows real intent to "
            "book or work with Konstantinos. Returns the questions to ask. Do "
            "NOT call this for general curiosity — only when they signal they "
            "want to engage him."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["speaking", "workshop", "mentoring", "podcast"],
                    "description": (
                        "speaking = keynote; workshop = in-company workshop or "
                        "consulting; mentoring = one-to-one; podcast = wants to "
                        "be a guest on «Θα Σας Ειδοποιήσουμε»."
                    ),
                },
            },
            "required": ["kind"],
        },
    },
]


# --------------------------------------------------------------------------
# Implementations
# --------------------------------------------------------------------------
def _search_corpus(indexer, query: str, lang: str) -> dict:
    """Retrieval under the public filter. The predicate is NOT negotiable."""
    if indexer is None:
        return {"passages": [], "note": "index unavailable"}
    docs = indexer.hybrid_search(
        query,
        top_k=TOOL_TOP_K,
        predicate=public_filter(PERSONA_SPEAKER),   # rights gate, always on
        lang=lang,
    )
    return {
        "passages": [
            {
                "n": i,
                "title": d.get("title") or "",
                "text": (d.get("content") or "")[:900],
                "source_type": d.get("source_type") or "",
            }
            for i, d in enumerate(docs, 1)
        ]
    }, docs


def _match_pillars(indexer, problem: str, lang: str) -> dict:
    if indexer is None:
        return {"pillars": []}, []

    def _pillars_only(meta: dict) -> bool:
        return (
            public_filter(PERSONA_SPEAKER)(meta)
            and meta.get("source_type") == "pillar"
            and meta.get("lang") == lang
        )

    docs = indexer.hybrid_search(problem, top_k=12, predicate=_pillars_only, lang=lang)
    seen, out = set(), []
    for d in docs:
        slug = d.get("pillar_slug")
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append({
            "slug": slug,
            "title": d.get("title") or slug,
            "summary": (d.get("content") or "")[:280],
        })
        if len(out) >= MAX_PILLARS:
            break
    return {"pillars": out}, docs


def _start_lead_flow(kind: str, lang: str) -> dict:
    from app.routers.leads import CONSENT_TEXT_EL, CONSENT_TEXT_EN, FLOWS
    flow = FLOWS.get(kind)
    if not flow:
        return {"error": f"unknown flow {kind!r}"}, []
    return {
        "flow": kind,
        "label": flow["label_el"] if lang == "el" else flow["label_en"],
        "questions": [q["el"] if lang == "el" else q["en"] for q in flow["questions"]],
        "consent_required": True,
        "consent_text": CONSENT_TEXT_EL if lang == "el" else CONSENT_TEXT_EN,
        "instruction": (
            "Ask these ONE AT A TIME, conversationally, in his register. Do not "
            "dump them as a list and do not ask for name/email until the end."
        ),
    }, []


def dispatch(name: str, args: dict, *, indexer, lang: str) -> tuple[dict, list]:
    """Run a tool. Returns (payload_for_model, docs_for_citation).

    `docs` are threaded back out so the router can cite and quote-verify against
    exactly the passages the model actually saw. A tool that retrieves nothing
    returns an empty list, and the citation layer then has nothing to attach —
    which is correct: an answer with no retrieved support gets no sources.
    """
    try:
        if name == "search_corpus":
            return _search_corpus(indexer, str(args.get("query", ""))[:400], lang)
        if name == "match_pillars":
            return _match_pillars(indexer, str(args.get("problem", ""))[:400], lang)
        if name == "start_lead_flow":
            return _start_lead_flow(str(args.get("kind", "")), lang)
    except Exception:                                    # pragma: no cover
        logger.exception("Tool %s failed", name)
        return {"error": "tool failed"}, []
    return {"error": f"unknown tool {name!r}"}, []
