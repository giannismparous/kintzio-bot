"""The rights/attribution gate, asserted in BOTH directions.

A one-directional test ("public can't see it") passes trivially if retrieval is
simply broken. So each case also asserts the internal route CAN reach the same
content — proving the material is indexed and that the filter, not an empty
index, is what excludes it publicly.
"""
from __future__ import annotations

from app.config import PERSONA_SPEAKER
from app.services.indexing import public_filter, searchable_filter

# From corpus/transcripts/ep002_internal_only_el.md (rights_cleared: false).
UNCLEARED_QUERY = "προάγουν τον καλύτερο τεχνικό σε manager"


def test_uncleared_content_is_indexed_at_all(indexer):
    """Precondition: without this, every other assertion here is vacuous."""
    stats = indexer.stats()
    assert stats["internal_only"] > 0, stats
    assert stats["persona_eligible"] > 0, stats


def test_internal_search_reaches_uncleared_content(indexer):
    hits = indexer.hybrid_search(UNCLEARED_QUERY, top_k=10, predicate=None)
    assert any(h.get("episode") == "002" for h in hits), [h.get("episode") for h in hits]


def test_public_filter_excludes_uncleared_content(indexer):
    hits = indexer.hybrid_search(
        UNCLEARED_QUERY, top_k=10, predicate=public_filter(PERSONA_SPEAKER)
    )
    assert not any(h.get("episode") == "002" for h in hits)
    assert all(h["rights_cleared"] for h in hits)


def test_public_filter_excludes_other_speakers(indexer):
    """Guest turns are indexed for search but never usable as his opinion."""
    all_hits = indexer.hybrid_search("turnover πρώτο χρόνο", top_k=25, predicate=None)
    speakers = {h.get("speaker") for h in all_hits}
    assert speakers - {PERSONA_SPEAKER}, "fixture has no non-Kintzios turns indexed"

    pub = indexer.hybrid_search(
        "turnover πρώτο χρόνο", top_k=25, predicate=public_filter(PERSONA_SPEAKER)
    )
    assert {h.get("speaker") for h in pub} == {PERSONA_SPEAKER}


def test_missing_rights_flag_defaults_to_not_cleared(tmp_path):
    """A file with no rights_cleared must fail CLOSED, not open."""
    from ingest.documents import load_document

    f = tmp_path / "no_flag.md"
    f.write_text('---\ntitle: "X"\nlang: el\nspeaker: Kintzios\n---\n\n' + "κείμενο " * 30)
    recs = load_document(f)
    assert recs and recs[0]["rights_cleared"] is False


def test_string_false_is_not_truthy(tmp_path):
    """`rights_cleared: "false"` must parse as a bool, not a truthy string.

    This is the frontmatter bug class that would silently publish everything.
    """
    from ingest.documents import load_document, parse_frontmatter

    meta, _ = parse_frontmatter('---\nrights_cleared: "false"\n---\nbody\n')
    assert meta["rights_cleared"] is False

    f = tmp_path / "quoted.md"
    f.write_text('---\ntitle: "X"\nlang: el\nspeaker: Kintzios\nrights_cleared: "false"\n---\n\n' + "κείμενο " * 30)
    assert load_document(f)[0]["rights_cleared"] is False


def test_public_ask_never_returns_uncleared_source(client):
    """End-to-end: the route, not just the predicate."""
    r = client.post("/api/ask", json={"question": UNCLEARED_QUERY})
    assert r.status_code == 200
    for s in r.json()["sources"]:
        assert s.get("episode") != "002", s


def test_quoted_identifier_stays_a_string():
    """`episode: "002"` must not become the number 2.

    Regression: adding quote-stripping for `rights_cleared: "false"` let quoted
    values fall through to numeric coercion, so episode "002" indexed as 2 and
    every episode lookup and citation broke. Quoting is the author's signal that
    the value is text.
    """
    from ingest.documents import parse_frontmatter

    meta, _ = parse_frontmatter('---\nepisode: "002"\nrights_cleared: "false"\n---\nbody\n')
    assert meta["episode"] == "002"
    assert meta["rights_cleared"] is False
