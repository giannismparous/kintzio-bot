"""FastAPI application entrypoint — DialogosAI / Kintzios.

Rewritten rather than adapted. BPAN's main.py is ~350 lines because it also
carries PDF generation, OCR, TTS/voice, file upload and the story builder, none
of which exist here. What is kept is the shape: lifespan startup that builds the
index, CORS from config, Jinja2 templates, static mount, router includes.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import CORS_ORIGINS, ORG_NAME, PRIVACY_URL
from app.startup import startup as run_startup

logger = logging.getLogger(__name__)

_HERE = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(_HERE / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup(app)
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title=f"DialogosAI — {ORG_NAME}",
    description=(
        "Bilingual (GR/EN) RAG-grounded assistant: persona Q&A with citations, "
        "keynote-pillar navigator, lead qualification, internal transcript search."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

_static = _HERE / "static"
if _static.exists():
    app.mount("/static", StaticFiles(directory=str(_static)), name="static")

from app.routers import api, internal, leads, web  # noqa: E402

app.include_router(api.router)
app.include_router(leads.router)
app.include_router(internal.router)
app.include_router(web.router)


@app.exception_handler(500)
async def _500(request: Request, exc: Exception):
    """Never leak a traceback to a public visitor on his domain."""
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again."},
    )
