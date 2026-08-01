"""Pins the retrieval-threshold calibration, and the finding behind it.

The point of this file is not to assert that the thresholds are "good". It is to
record the measurement they came from, so that a future change to the corpus or
the indexer cannot silently invalidate the reasoning in `routers/api.py` without
a test going red.
"""
from __future__ import annotations

import statistics as st

import pytest

from app.config import PERSONA_SPEAKER
from app.routers.api import MIN_RELEVANCE, STRONG_RELEVANCE
from app.services.indexing import public_filter

ON_TOPIC = [
    "Πώς διοικώ μια ομάδα με Gen Z;",
    "How do I give feedback to a senior manager?",
    "οι νέοι μας φεύγουν στον πρώτο χρόνο",
    "How do I ask for a promotion?",
    "τοξική κουλτούρα στην ομάδα μου",
    "what makes a good leader",
    "Ποιος είναι ο Κωνσταντίνος;",
    "personal branding and networking",
    "θέλω keynote για το συνέδριό μας",
    "executive mentoring for C-level",
]
OFF_TOPIC = [
    "What is the capital of Peru?",
    "give me a recipe for moussaka",
    "write me python code",
    "ποιος κέρδισε το Champions League",
    "what's the weather tomorrow",
    "translate this to French",
    "πόσο κάνει 2+2",
    "who won the Nobel prize in physics",
]


def _top(indexer, q: str) -> float:
    hits = indexer.hybrid_search(q, top_k=8, predicate=public_filter(PERSONA_SPEAKER))
    return max((h.get("score", 0.0) for h in hits), default=0.0)


def test_score_distributions_overlap():
    """The finding that justifies the design: score alone cannot separate topics.

    If this ever fails because the distributions have SEPARATED, that is good news
    and the off-topic gate could be simplified — but it must be a deliberate
    decision, not an unnoticed drift.
    """
    pytest.importorskip("sklearn")
    from app.config import EMBEDDINGS_DIR
    from app.services.indexing import HybridContentIndexer

    ix = HybridContentIndexer(embeddings_dir=EMBEDDINGS_DIR)
    ix.load_existing_indices()
    if not ix.document_metadata:
        pytest.skip("no index built")

    on = [_top(ix, q) for q in ON_TOPIC]
    off = [_top(ix, q) for q in OFF_TOPIC]

    assert max(off) > st.median(on), (
        "off-topic max no longer exceeds on-topic median — distributions may have "
        f"separated (off_max={max(off):.4f}, on_median={st.median(on):.4f}); "
        "revisit the off-topic gate in routers/api.py"
    )


def test_strong_relevance_cannot_override_the_vocabulary_gate():
    """STRONG_RELEVANCE must sit above the observed on-topic max.

    At 0.16 it let "who won the Nobel prize in physics" (0.1996) through as
    `answered`, because a high lexical score was read as evidence of relevance.
    """
    assert STRONG_RELEVANCE > 0.325, STRONG_RELEVANCE
    assert MIN_RELEVANCE < 0.06, MIN_RELEVANCE


@pytest.mark.parametrize("q", OFF_TOPIC)
def test_all_off_topic_probes_are_refused_or_deflected(client, q):
    """None of these may reach the persona. Arithmetic must not read as a price."""
    d = client.post("/api/ask", json={"question": q}).json()
    assert d["action"] == "off_topic", (q, d["action"])


@pytest.mark.parametrize("q", ON_TOPIC)
def test_all_on_topic_probes_are_answered(client, q):
    d = client.post("/api/ask", json={"question": q}).json()
    assert d["action"] == "answered", (q, d["action"])


# --- scope is the model's judgement, not a keyword list ---------------------
#
# Regression for a real bug: "how to lead?" was REFUSED while "how do I lead a
# team?" was answered, because the `_IN_SCOPE` pattern list happened not to fire
# on the shorter phrasing. The shortest, most central question in a leadership
# coach's domain was the one the bot got wrong, in his name.
#
# Scope now belongs to the model (persona.scope_instruction). These tests pin
# the two properties that must hold regardless of which model runs.

def test_scope_instruction_is_in_every_prompt():
    """The model cannot judge scope if it is never asked to."""
    from app.services.persona import build_prompt
    for lang, needle in (("en", "RELEVANCE JUDGEMENT"), ("el", "ΚΡΙΣΗ ΣΥΝΑΦΕΙΑΣ")):
        assert needle in build_prompt("q", [], lang)


def test_scope_instruction_tells_the_model_to_lean_in():
    """A timid instruction reproduces the bug with extra steps."""
    from app.services.persona import scope_instruction
    assert "GENEROUS" in scope_instruction("en")
    assert "how to lead?" in scope_instruction("en")       # the exact bug case
    assert "ΓΕΝΝΑΙΟΔΩΡΟΣ" in scope_instruction("el")
    assert "ηγηθώ" in scope_instruction("el")      # line-wrapped in source


def test_keyword_gate_does_not_run_when_a_model_is_available(monkeypatch):
    """The keyword list is a keyless fallback. With a model it must not fire."""
    import app.startup as S
    from app.routers import api as api_mod
    assert "_keyless" in api_mod.__dict__ or True   # gate is inline; assert via behaviour

    class _Stub:
        async def generate_with_multi_fallback(self, prompt, **kw):
            return "<p>Leadership answer.</p>"

        async def generate_with_tools(self, prompt, schemas, dispatch, **kw):
            return "<p>Leadership answer.</p>", []

    monkeypatch.setattr(S, "get_llm_manager", lambda: _Stub())
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        r = c.post("/api/ask", json={"question": "how to lead?", "session_id": "sc1"})
        assert r.json()["action"] == "answered", "short on-topic question refused again"


def test_safety_gates_still_precede_the_model(monkeypatch):
    """Distress and price must NEVER become the model's judgement call."""
    import app.startup as S

    class _Loud:
        async def generate_with_multi_fallback(self, prompt, **kw):
            raise AssertionError("model was called for a distress/price question")

        async def generate_with_tools(self, prompt, schemas, dispatch, **kw):
            raise AssertionError("tool loop ran for a distress/price question")

    monkeypatch.setattr(S, "get_llm_manager", lambda: _Loud())
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        assert c.post("/api/ask", json={"question": "δεν αντέχω άλλο",
                                        "session_id": "sc2"}).json()["action"] == "distress"
        assert c.post("/api/ask", json={"question": "Πόσο κοστίζει μια ομιλία;",
                                        "session_id": "sc3"}).json()["action"] == "price"


# --- a Greek question must get Greek context --------------------------------
#
# Regression for a two-part bug. The same-language ranking bonus was 0.05,
# below the gap between adjacent TF-IDF scores, so it never changed the order.
# Raising it to 0.35 alone did NOTHING, because each leg only fetched
# top_k//2+2 candidates: on «Πες μου για το Gen Z» the lexical leg returned 2
# Greek and 4 English out of 86 eligible Greek chunks, and a bonus cannot
# promote a chunk that was never retrieved. The fix is both — a wider pool AND
# a bonus that can reorder it.
#
# This matters beyond tidiness: the retrieved passages ARE the model's context,
# so an English-heavy context on a Greek question drags the answer into English.

@pytest.mark.parametrize("query,lang", [
    ("Πες μου για το Gen Z", "el"),
    ("πώς χτίζω κουλτούρα;", "el"),
    ("τι κάνει έναν καλό ηγέτη;", "el"),
    ("Tell me about Gen Z", "en"),
    ("how do I build culture?", "en"),
])
def test_retrieval_prefers_the_question_s_language(indexer, query, lang):
    from app.config import PERSONA_SPEAKER
    from app.services.indexing import public_filter
    hits = indexer.hybrid_search(
        query, top_k=6, predicate=public_filter(PERSONA_SPEAKER), lang=lang)
    assert hits, f"no retrieval at all for {query!r}"
    same = [h for h in hits if h.get("lang") == lang]
    assert len(same) / len(hits) >= 0.8, (
        f"{query!r} returned {len(same)}/{len(hits)} in {lang} — "
        "context language drifts, and the answer follows it")


def test_language_bonus_is_a_preference_not_a_filter():
    """Cross-language retrieval must stay POSSIBLE.

    He says things in Greek that answer English questions. The bonus makes
    same-language the default; a hard filter would lose real material.
    """
    import inspect
    from app.services import indexing
    src = inspect.getsource(indexing.HybridContentIndexer.hybrid_search)
    assert "rank_score" in src and "LANG_BONUS" in src
    assert 'item.get("lang") == lang' in src, "bonus must be additive, not a filter"
