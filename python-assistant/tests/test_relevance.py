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
