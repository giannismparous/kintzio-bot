"""Guards against two classes of bug that only appear outside the dev machine."""
from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_email_validator_extra_is_declared():
    """`EmailStr` needs pydantic[email]; a bare `pydantic` pin boots then crashes.

    This was a real failure on a clean venv: the dev environment had
    email-validator transitively, so it imported fine here and raised
    ModuleNotFoundError on the user's first `manage.py serve`. Static import
    scanning cannot catch it — EmailStr pulls the package at model-build time, not
    via an import statement — so the requirement is asserted directly.
    """
    req = (ROOT / "requirements.txt").read_text()
    assert "pydantic[email]" in req, (
        "requirements.txt must pin pydantic[email]; routers/leads.py uses EmailStr"
    )


def test_tests_do_not_read_the_developers_dotenv():
    """A local .env must not decide what the suite tests.

    With INTERNAL_USER set in a real .env, the fail-closed admin tests saw
    configured credentials and got 401 where they assert 503 — testing the wrong
    state entirely. conftest sets KINTZIOS_SKIP_DOTENV; this asserts it took.
    """
    import os

    from app import config

    assert os.environ.get("KINTZIOS_SKIP_DOTENV") == "1"
    assert not config.INTERNAL_USER, (
        f"INTERNAL_USER leaked into the test env ({config.INTERNAL_USER!r}) — "
        "admin auth tests would assert against the wrong state"
    )


def test_brand_colours_are_his_own():
    """The palette is taken from kkintzios.com, not invented.

    An earlier build shipped an invented gold (#c8a45c). Regression guard: the
    gold must not reappear, and his two real colours must be the ones in use.
    """
    from app.config import BRAND_NAVY, BRAND_ORANGE

    assert BRAND_ORANGE == "#ff7d00"
    assert BRAND_NAVY == "#070f45"

    for f in ["src/app/templates/chat.html", "src/app/templates/admin.html",
              "src/app/templates/privacy.html", "src/app/static/kintzios-widget.js"]:
        text = (ROOT / f).read_text()
        assert "c8a45c" not in text.lower(), f"invented gold is back in {f}"


def test_avatar_assets_exist_and_use_his_letterform():
    """The avatar is his own logo's K glyph, not a redrawn one."""
    logo_k = "M69.19 16.65"          # first path command of kintzios-logo.svg
    static = ROOT / "src/app/static"
    for name in ["kitsi-avatar.svg", "kitsi-avatar-plain.svg", "favicon.svg"]:
        p = static / name
        assert p.exists(), f"missing {name}"
        assert logo_k in p.read_text(), f"{name} is not built from his logo glyph"
