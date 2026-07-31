# src/app/db.py — DialogosAI / Kintzios
# Copied from BPAN db.py; only the database filename differs. Kept the
# lightweight-migration helper pattern rather than pulling in Alembic.
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parents[1]
# DB_PATH lets the test suite point at a tmp file instead of the dev database.
DATABASE_URL = os.environ.get("DB_URL") or f"sqlite:///{BASE_DIR / 'kintzios.db'}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
)
Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a session and always closes it."""
    db = Session()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables. Idempotent; safe to call on every startup."""
    from app import models  # noqa: F401  (registers mappers before create_all)

    Base.metadata.create_all(bind=engine)
