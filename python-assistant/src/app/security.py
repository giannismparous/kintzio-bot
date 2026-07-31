"""HTTP Basic auth for the admin (leads) and internal (transcript search) routes.

DELIBERATE DIVERGENCE FROM THE REFERENCE APPS.

BPAN's `security.py` returns "anonymous" and lets the request through when
INTERNAL_USER / INTERNAL_PASSWORD are unset — auth is opt-in, which keeps local
dev frictionless for a dashboard of anonymised triage counts.

That default is wrong here. These routes expose lead PII (name, email, phone,
organisation) and the full transcript index including non-rights-cleared
material. A forgotten env var must not silently publish either. So Kintzios
FAILS CLOSED: no credentials configured → 503, not open access.

The dev escape hatch is explicit and loud: ALLOW_INSECURE_ADMIN=1. It is logged
as a warning on every startup and on every request it permits.
"""
from __future__ import annotations

import logging
import secrets
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import ALLOW_INSECURE_ADMIN, INTERNAL_PASSWORD, INTERNAL_USER

logger = logging.getLogger(__name__)

_basic = HTTPBasic(auto_error=False)

_UNAUTH = {"WWW-Authenticate": 'Basic realm="kintzios-internal"'}


def auth_is_configured() -> bool:
    return bool(INTERNAL_USER and INTERNAL_PASSWORD)


def require_internal_user(
    credentials: Optional[HTTPBasicCredentials] = Depends(_basic),
) -> str:
    if not auth_is_configured():
        if ALLOW_INSECURE_ADMIN:
            logger.warning(
                "ALLOW_INSECURE_ADMIN=1 — serving a protected route with NO "
                "authentication. Never use this in production."
            )
            return "insecure-dev"
        # Fail closed. 503 rather than 401: the problem is server config, and a
        # 401 would invite credential guessing against an endpoint that has no
        # valid credentials at all.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Admin routes are disabled: INTERNAL_USER and INTERNAL_PASSWORD "
                "are not set. See .env.example."
            ),
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers=_UNAUTH,
        )

    user_ok = secrets.compare_digest(credentials.username, INTERNAL_USER)
    pw_ok = secrets.compare_digest(credentials.password, INTERNAL_PASSWORD)
    if not (user_ok and pw_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers=_UNAUTH,
        )
    return credentials.username
