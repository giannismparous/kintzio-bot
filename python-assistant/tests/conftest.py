"""Shared fixtures.

Neither reference app has tests, so there is no house pattern to follow here.
Two decisions worth stating:

  * Every test runs KEYLESS — no GEMINI_API_KEY. That is not a limitation being
    worked around; it is the point. Ingestion, chunking, the rights filter,
    guardrails, quote grounding, lead capture and erasure are all deterministic
    and must be verifiable without a network call or a bill. Generation itself is
    the only thing a key would add, and a test that asserts on LLM prose is a
    test that fails on model updates.
  * The app DB is redirected to a tmp file via DB_URL before `app.main` is
    imported, so a test run can never touch the dev database.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
for p in (str(ROOT), str(ROOT / "src")):
    if p not in sys.path:
        sys.path.insert(0, p)

os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GEMINI_API_KEY_2", None)

# The developer's own .env must not reach the tests.
#
# `config.py` calls load_dotenv() at import, so once a real .env exists — as it
# will on any machine actually running this app — its values become the test
# environment. That is how the four fail-closed assertions started returning 401
# instead of 503: a local .env set INTERNAL_USER/INTERNAL_PASSWORD, so admin auth
# was legitimately CONFIGURED and 401 was the correct answer. The test was not
# wrong about the app; it was wrong to assume an empty environment.
#
# Rather than weaken the assertion to "401 or 503" — which would no longer
# distinguish "unconfigured" from "wrong password", the exact difference the
# fail-closed design turns on — the unconfigured state is established explicitly.
# Tests that need credentials use the admin_client fixture's dependency override.
os.environ["KINTZIOS_SKIP_DOTENV"] = "1"
for _k in ("INTERNAL_USER", "INTERNAL_PASSWORD", "ALLOW_INSECURE_ADMIN"):
    os.environ.pop(_k, None)

# ---------------------------------------------------------------------------
# DB_URL must be set HERE, at conftest import — not in a fixture.
#
# `app/db.py` creates the engine at module import time. A fixture that sets
# DB_URL runs AFTER pytest has imported the test modules, and those modules
# import `app.*` at their own top level — so by the time the fixture ran, the
# engine was already bound to the DEFAULT path and the fixture's value was
# ignored. This was not theoretical: it wrote 6 fixture leads and 93 sessions
# into src/kintzios.db before being caught. A test suite that mutates the
# developer's database is a bug in the suite, not an inconvenience.
#
# tempfile, not tmp_path_factory, because only a module-level assignment is early
# enough and fixtures are not available at import time.
# ---------------------------------------------------------------------------
_TEST_DB = Path(tempfile.mkdtemp(prefix="kintzios-tests-")) / "test.db"
os.environ["DB_URL"] = f"sqlite:///{_TEST_DB}"


def pytest_sessionfinish(session, exitstatus):
    """Prove the isolation held, and say so loudly if it didn't."""
    from app.db import DATABASE_URL

    assert str(_TEST_DB) in DATABASE_URL, (
        f"TEST ISOLATION FAILED: the app is bound to {DATABASE_URL}, not the "
        f"temp DB. Tests may have written to a real database."
    )
    shutil.rmtree(_TEST_DB.parent, ignore_errors=True)


@pytest.fixture(scope="session")
def tmp_db():
    return _TEST_DB


@pytest.fixture(scope="session")
def client(tmp_db):
    """A TestClient with the real startup sequence (index build included)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_client(client):
    """An authenticated client, via FastAPI's dependency_overrides.

    An earlier version set `security.INTERNAL_USER/PASSWORD` as a session-scoped
    fixture. That leaked: once any admin test ran, the credentials stayed set for
    the rest of the session, and the four fail-closed assertions passed in
    isolation while failing in a full run — the worst possible failure mode for a
    security test, since the version that "passes" is the one testing nothing.

    Overriding the dependency is both properly scoped (torn down per test) and
    narrower: it grants an authenticated identity without ever making the app
    believe credentials are configured, so `client` stays genuinely unauthorised.
    """
    from app.security import require_internal_user

    client.app.dependency_overrides[require_internal_user] = lambda: "tester"
    yield client
    client.app.dependency_overrides.pop(require_internal_user, None)


@pytest.fixture(scope="session")
def indexer(client):
    """The live index built at startup."""
    return client.app.state.indexer
