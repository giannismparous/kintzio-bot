"""Routes: ask routing, pillar navigator, leads, GDPR, admin auth."""
from __future__ import annotations

import pytest

ROUTING = [
    ("Πώς διοικώ μια ομάδα με Gen Z;", "answered", "el"),
    ("How do I give feedback to a senior manager?", "answered", "en"),
    ("Ποιος είσαι;", "answered", "el"),
    ("What is the capital of Peru?", "off_topic", "en"),
    ("give me a recipe for moussaka", "off_topic", "en"),
    ("Πόσο κοστίζει μια ομιλία;", "price", "el"),
    ("How much is a keynote?", "price", "en"),
    ("I think I'm depressed about work", "distress", "en"),
    ("Σε ποιες μετοχές να επενδύσω;", "refuse", "el"),
]


@pytest.mark.parametrize("q,action,lang", ROUTING)
def test_ask_routing(client, q, action, lang):
    d = client.post("/api/ask", json={"question": q}).json()
    assert d["action"] == action, (q, d["action"])
    assert d["lang"] == lang


def test_refused_and_distress_carry_no_sources(client):
    for q in ("Σε ποιες μετοχές να επενδύσω;", "I can't go on like this"):
        d = client.post("/api/ask", json={"question": q}).json()
        assert d["sources"] == []


def test_answer_carries_citable_sources(client):
    d = client.post("/api/ask", json={"question": "Πώς διοικώ μια ομάδα με Gen Z;"}).json()
    assert d["sources"]
    for s in d["sources"]:
        assert set(s) >= {"n", "title", "lang", "source_type"}
        # Chunk text must not ship to the browser (see _public_sources).
        assert "content" not in s


def test_disclosure_appears_once_per_session(client):
    sid = "disclosure-test-session"
    a = client.post("/api/ask", json={"question": "Ποιος είσαι;", "session_id": sid}).json()
    b = client.post("/api/ask", json={"question": "Και τι κάνει;", "session_id": sid}).json()
    assert a["disclosed"] is True
    assert b["disclosed"] is False


def test_health_reports_index(client):
    d = client.get("/api/health").json()
    assert d["status"] == "ok"
    assert d["index"]["chunks"] > 0
    assert d["index"]["persona_eligible"] > 0
    assert d["semantic_leg"] is False       # keyless test run


# --------------------------------------------------------------------------- #
# Pillar navigator
# --------------------------------------------------------------------------- #
def test_pillar_match_returns_at_most_three_unique(client):
    d = client.post("/api/pillars/match",
                    json={"problem": "our under-30s and our managers can't talk"}).json()
    slugs = [p["slug"] for p in d["pillars"]]
    assert 0 < len(slugs) <= 3
    assert len(slugs) == len(set(slugs))
    assert d["next_step"]


def test_pillar_match_respects_language(client):
    for problem, lang in [("οι νέοι μας φεύγουν στον πρώτο χρόνο", "el"),
                          ("our graduates leave within a year", "en")]:
        d = client.post("/api/pillars/match", json={"problem": problem}).json()
        assert d["lang"] == lang


# --------------------------------------------------------------------------- #
# Leads + GDPR
# --------------------------------------------------------------------------- #
def test_four_flows_exposed_bilingually(client):
    for lang in ("el", "en"):
        d = client.get(f"/api/leads/flows?lang={lang}").json()
        ids = [f["id"] for f in d["flows"]]
        assert ids == ["speaking", "workshop", "mentoring", "podcast"]
        assert d["consent_text"] and d["privacy_url"]
        for f in d["flows"]:
            assert f["questions"] and all(q["text"] for q in f["questions"])


def test_capture_refuses_without_consent(client):
    r = client.post("/api/leads/capture", json={
        "flow": "speaking", "name": "No Consent", "email": "nc@example.com",
        "answers": {"organisation": "ACME"}, "consent": False,
    })
    assert r.status_code == 400


def test_capture_stores_and_hides_fit_score(client):
    r = client.post("/api/leads/capture", json={
        "flow": "workshop", "name": "Maria T", "email": "maria@example.com",
        "phone": "+30 210 0000000", "organisation": "ACME",
        "answers": {"problem": "our team of 300 has high turnover",
                    "role": "HR director", "timeframe": "Q4 2026"},
        "consent": True,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] and d["lead_id"]
    assert "fit_score" not in d and "fit_notes" not in d
    assert d["retention_days"] > 0


def test_unknown_flow_rejected(client):
    r = client.post("/api/leads/capture", json={
        "flow": "not_a_flow", "name": "X Y", "email": "x@example.com", "consent": True})
    assert r.status_code == 400


def test_expiry_is_stamped_on_the_row(admin_client):
    admin_client.post("/api/leads/capture", json={
        "flow": "mentoring", "name": "Expiry Probe", "email": "exp@example.com",
        "answers": {"goal": "move into management"}, "consent": True})
    rows = admin_client.get("/api/leads/admin/list").json()["leads"]
    row = next(r for r in rows if r["email"] == "exp@example.com")
    assert row["expires_at"] > row["created_at"]
    assert row["consent_ts"]


def _lead_exists(email: str) -> bool:
    """Check the DB directly. The endpoint deliberately does not tell us."""
    from sqlalchemy import func

    from app.db import Session as DbSession
    from app.models import Lead

    db = DbSession()
    try:
        return db.query(Lead).filter(func.lower(Lead.email) == email.lower()).count() > 0
    finally:
        db.close()


def test_erasure_actually_deletes(client):
    """Verified against the DB, not against the response.

    These assertions used to read `deleted: n` from the response body. That field
    was removed because it is an address-existence oracle (see the endpoint
    docstring), so erasure is now confirmed the only honest way: by looking.
    """
    client.post("/api/leads/capture", json={
        "flow": "speaking", "name": "Erase Me", "email": "erase@example.com",
        "answers": {"organisation": "ACME"}, "consent": True})
    assert _lead_exists("erase@example.com")

    r = client.request("DELETE", "/api/leads/erase", json={"email": "erase@example.com"})
    assert r.status_code == 200 and r.json()["ok"]
    assert not _lead_exists("erase@example.com")


def test_erasure_is_idempotent(client):
    for _ in range(2):
        r = client.request("DELETE", "/api/leads/erase",
                           json={"email": "erase@example.com"})
        assert r.status_code == 200 and r.json()["ok"]


def test_erasure_is_case_insensitive(client):
    client.post("/api/leads/capture", json={
        "flow": "speaking", "name": "Case Test", "email": "MiXeD@Example.com",
        "answers": {"organisation": "ACME"}, "consent": True})
    client.request("DELETE", "/api/leads/erase", json={"email": "mixed@example.com"})
    assert not _lead_exists("mixed@example.com")


def test_erasure_response_is_not_an_address_oracle(client):
    """The response for a present address must be byte-identical to one for an
    absent address. Otherwise anyone can enumerate his client list."""
    client.post("/api/leads/capture", json={
        "flow": "speaking", "name": "Present", "email": "present@example.com",
        "answers": {"organisation": "ACME"}, "consent": True})

    hit = client.request("DELETE", "/api/leads/erase",
                         json={"email": "present@example.com"})
    miss = client.request("DELETE", "/api/leads/erase",
                          json={"email": "never-seen@example.com"})

    assert hit.status_code == miss.status_code
    assert hit.json() == miss.json(), "erasure response leaks whether the address existed"
    assert "deleted" not in hit.json()


# --------------------------------------------------------------------------- #
# Fail-closed auth — the property BPAN gets wrong (it returns "anonymous").
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("path", [
    "/api/leads/admin/list",
    "/api/internal/search?q=manager",
    "/api/internal/unanswered",
    "/api/internal/stats",
])
def test_admin_routes_fail_closed_without_credentials(client, path):
    assert client.get(path).status_code == 503


@pytest.mark.parametrize("path", [
    "/api/leads/admin/list",
    "/api/internal/search?q=manager",
    "/api/internal/unanswered",
])
def test_admin_routes_open_with_credentials(admin_client, path):
    assert admin_client.get(path).status_code == 200


def test_internal_search_can_see_uncleared(admin_client):
    d = admin_client.get(
        "/api/internal/search?q=" + "προάγουν τον καλύτερο τεχνικό").json()
    assert d["count"] > 0
    assert any(not r["rights_cleared"] for r in d["results"])


def test_internal_search_can_exclude_uncleared(admin_client):
    d = admin_client.get(
        "/api/internal/search?include_uncleared=false&q=προάγουν τον καλύτερο τεχνικό").json()
    assert all(r["rights_cleared"] for r in d["results"])


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("path", ["/", "/privacy-policy", "/widget-demo", "/robots.txt"])
def test_public_pages_render(client, path):
    assert client.get(path).status_code == 200


def test_privacy_page_states_retention_and_erasure(client):
    body = client.get("/privacy-policy").text
    assert "erase" in body
    assert "2016/679" in body and "4624/2019" in body
    assert "2024/1689" in body          # AI Act cited


def test_robots_blocks_api(client):
    assert "Disallow: /api/" in client.get("/robots.txt").text
