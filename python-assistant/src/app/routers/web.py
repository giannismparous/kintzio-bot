"""HTML page routes. Re-skinned from BPAN's `routers/web.py`.

Kept: the chat page, the privacy page, the widget demo. Dropped: the story
builder, the file browser and the PDF download routes, which have no analogue.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy.orm import Session as OrmSession

from app.config import (
    LEAD_RETENTION_DAYS,
    ORG_EMAIL,
    ORG_NAME,
    ORG_WEBSITE,
    SCHEDULER_URL,
)
from app.db import get_db
from app.security import require_internal_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["web"])
_TEMPLATES = Path(__file__).resolve().parents[1] / "templates"


def _templates(request: Request):
    from app.main import templates
    return templates


@router.get("/", response_class=HTMLResponse)
async def chat_page(request: Request):
    """The bilingual chat page."""
    from app.main import templates
    return templates.TemplateResponse(
        request,
        "chat.html",
        {
            "org_name": ORG_NAME,
            "org_website": ORG_WEBSITE,
            "org_email": ORG_EMAIL,
            "scheduler_url": SCHEDULER_URL,
        },
    )


@router.get("/widget-demo", response_class=HTMLResponse)
async def widget_demo(request: Request):
    """A bare page embedding the widget, to show the WordPress drop-in."""
    from app.main import templates
    return templates.TemplateResponse(
        request, "widget_demo.html", {"org_name": ORG_NAME}
    )


@router.get("/privacy-policy", response_class=HTMLResponse)
async def privacy(request: Request):
    """Assistant-specific privacy notice.

    Deliberately its own page rather than a link to his existing policy. His
    current notice covers form-based contact only, states that comments are
    "retained indefinitely", and says nothing about AI processing, conversation
    logging or a retention clock. Linking it while running an AI assistant that
    stores leads would misrepresent what happens — so this page documents the
    actual processing, and the ARCHITECTURE_NOTES flag his site notice as
    needing an update before launch.
    """
    from app.main import templates
    return templates.TemplateResponse(
        request,
        "privacy.html",
        {
            "org_name": ORG_NAME,
            "org_email": ORG_EMAIL,
            "retention_days": LEAD_RETENTION_DAYS,
        },
    )


@router.get("/admin", response_class=HTMLResponse)
async def admin_page(
    request: Request,
    db: OrmSession = Depends(get_db),
    user: str = Depends(require_internal_user),
):
    """Leads + unanswered questions + internal search, behind fail-closed auth."""
    from app.main import templates
    return templates.TemplateResponse(
        request, "admin.html", {"org_name": ORG_NAME, "user": user}
    )


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots():
    """Keep the assistant's own endpoints out of search results.

    The corpus content is already public on his site and should stay indexed
    there; a crawler indexing generated answers would create duplicate,
    unattributed copies of his material under a different URL.
    """
    return "User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /widget-demo\n"
