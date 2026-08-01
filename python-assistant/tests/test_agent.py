"""The agentic layer: tool dispatch, the loop, and what it may NOT decide."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import tools


# --- the tool surface -------------------------------------------------------
def test_three_tools_declared():
    assert {s["name"] for s in tools.TOOL_SCHEMAS} == {
        "search_corpus", "match_pillars", "start_lead_flow"}


def test_no_tool_can_widen_the_rights_filter():
    """The model must have NO argument that reaches uncleared material.

    Spyros Andrianos's contributions staying out of public answers is a
    contract term. If a tool ever grows a `include_internal` or `speaker`
    parameter, this test is the thing that should stop it.
    """
    banned = {"rights", "rights_cleared", "internal", "include_internal",
              "speaker", "predicate", "filter", "all"}
    for s in tools.TOOL_SCHEMAS:
        params = set(s["parameters"]["properties"])
        assert not (params & banned), f"{s['name']} exposes {params & banned}"


def test_search_corpus_never_returns_uncleared_chunks(client):
    ix = client.app.state.indexer
    payload, docs = tools._search_corpus(ix, "διοίκηση ομάδας", "el")
    assert all(d.get("rights_cleared") is True for d in docs)
    assert all(d.get("speaker") == "Kintzios" for d in docs)


def test_dispatch_unknown_tool_is_an_error_not_a_crash(client):
    payload, docs = tools.dispatch("rm_rf", {}, indexer=client.app.state.indexer, lang="el")
    assert "error" in payload and docs == []


# --- the loop ---------------------------------------------------------------
class _ToolStub:
    """A model that calls two tools then answers."""
    def __init__(self): self.calls = []

    async def generate_with_tools(self, prompt, schemas, dispatch, **kw):
        p, _ = dispatch("match_pillars", {"problem": "retention"})
        s, _ = dispatch("search_corpus", {"query": "retention"})
        self.calls = ["match_pillars", "search_corpus"]
        return "<p>Answer.</p>", [
            {"tool": "match_pillars", "args": {}, "n_results": len(p.get("pillars", []))},
            {"tool": "search_corpus", "args": {}, "n_results": len(s.get("passages", []))},
        ]

    async def generate_with_multi_fallback(self, prompt, **kw):
        return "<p>single shot</p>"


def test_two_tools_in_one_turn_and_trace_is_returned(client, monkeypatch):
    """The multi-part question that a single retrieval pass answered badly."""
    import app.startup as S
    stub = _ToolStub()
    monkeypatch.setattr(S, "get_llm_manager", lambda: stub)
    r = client.post("/api/ask", json={
        "question": "Κάνετε workshops για τεχνικές ομάδες και τι θα καλύπτατε;",
        "session_id": "ag-two"})
    d = r.json()
    assert d["action"] == "answered"
    assert [t["tool"] for t in d["trace"]] == ["match_pillars", "search_corpus"]


def test_falls_back_to_single_shot_when_the_loop_returns_nothing(client, monkeypatch):
    """A dead tool loop must not fail the request."""
    import app.startup as S

    class _Empty:
        async def generate_with_tools(self, *a, **k): return "", []
        async def generate_with_multi_fallback(self, *a, **k): return "<p>fallback ran</p>"

    monkeypatch.setattr(S, "get_llm_manager", lambda: _Empty())
    d = client.post("/api/ask", json={"question": "πώς χτίζω ομάδα;",
                                      "session_id": "ag-fb"}).json()
    assert d["action"] == "answered"
    assert "fallback ran" in d["answer"]


# --- what the model may NOT decide -----------------------------------------
class _Loud:
    async def generate_with_tools(self, *a, **k):
        raise AssertionError("tool loop ran for a safety-gated question")
    async def generate_with_multi_fallback(self, *a, **k):
        raise AssertionError("model ran for a safety-gated question")


@pytest.mark.parametrize("question,expected", [
    ("δεν αντέχω άλλο", "distress"),
    ("Πόσο κοστίζει μια ομιλία;", "price"),
])
def test_safety_gates_run_before_the_agent(client, monkeypatch, question, expected):
    """Distress and price must never reach the model, agentic or not."""
    import app.startup as S
    monkeypatch.setattr(S, "get_llm_manager", lambda: _Loud())
    d = client.post("/api/ask", json={"question": question,
                                      "session_id": f"safe-{expected}"}).json()
    assert d["action"] == expected


def test_agent_can_be_switched_off(client, monkeypatch):
    """AGENT_ENABLED=0 is a rollback switch, not a feature removal."""
    import app.routers.api as api_mod
    import app.startup as S

    class _NoTools:
        async def generate_with_multi_fallback(self, *a, **k): return "<p>single</p>"
        async def generate_with_tools(self, *a, **k):
            raise AssertionError("tool loop ran while AGENT_ENABLED=0")

    monkeypatch.setattr(api_mod, "AGENT_ENABLED", False)
    monkeypatch.setattr(S, "get_llm_manager", lambda: _NoTools())
    d = client.post("/api/ask", json={"question": "πώς χτίζω ομάδα;",
                                      "session_id": "ag-off"}).json()
    assert d["action"] == "answered" and d["trace"] == []
