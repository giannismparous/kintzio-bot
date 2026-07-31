# src/app/models.py — DialogosAI / Kintzios
#
# Adapted from BPAN models.py. UserSession keeps the same shape (consents as a
# JSON column, conversation_data, category) so crud.py carries over. Dropped:
# TriageRequest, WorkloadLog, ContentPage (patient-org tables with no analogue).
# Added: Lead — the table neither reference app has.
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Text, JSON, Integer, Boolean, Float

from app.db import Base


class UserSession(Base):
    """One browser session. Mirrors the BPAN table minus the clinical columns."""

    __tablename__ = "user_sessions"

    session_id = Column(String(255), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_activity = Column(DateTime, default=datetime.utcnow)
    consents = Column(JSON)                 # {"ai_disclosure": true, "ts": "..."}
    conversation_data = Column(JSON)        # [{question, answer, ts}, ...]
    lang = Column(String(8))                # last detected language
    intent = Column(String(64))             # last routed intent
    disclosed = Column(Integer, default=0)  # AI Act Art.50 first-message shown


class Lead(Base):
    """A captured enquiry.

    Nothing like this exists in BPAN or Chios — those apps capture consent
    booleans on a session, not a contact record. Consequences that shaped this
    table (see ARCHITECTURE_NOTES.md §6):

      * `consent_given` is NOT NULL-able-by-omission: the capture endpoint
        refuses to write a row without it, so a lead in this table always has
        an affirmative consent record with a timestamp and the policy version
        the user actually saw.
      * `expires_at` is written at insert time from LEAD_RETENTION_DAYS, so
        retention is a property of the row, not of a config value that might
        change later.
      * `fit_score` / `fit_notes` are derived from his published
        "DO NOT REACH OUT IF…" criteria and are ADMIN-ONLY — never returned on
        a public endpoint, never shown to the prospect.
      * No message transcript is stored. `summary` is a short qualification
        digest, which is what he actually needs in the inbox.
    """

    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, index=True)

    # flow: speaking | workshop | mentoring | podcast
    flow = Column(String(32), index=True)
    lang = Column(String(8))

    # contact
    name = Column(String(255))
    email = Column(String(255), index=True)
    phone = Column(String(64))
    organisation = Column(String(255))

    # qualification answers, per-flow (see routers/leads.py FLOWS)
    answers = Column(JSON)
    summary = Column(Text)

    # consent — GDPR Art. 7(1): we must be able to demonstrate it
    consent_given = Column(Boolean, default=False, nullable=False)
    consent_ts = Column(DateTime)
    consent_text = Column(Text)      # the exact wording the user agreed to

    # internal only
    fit_score = Column(Float)
    fit_notes = Column(JSON)
    status = Column(String(32), default="new", index=True)


class UnansweredQuestion(Base):
    """Every question the corpus could not answer.

    This is deliberately a first-class table rather than a log line. It is the
    content-pipeline asset: what his audience asks that he has not yet
    published on. Stores the question and language only — no session linkage,
    no contact details, so it carries no personal data and needs no retention
    clock.
    """

    __tablename__ = "unanswered_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    question = Column(Text)
    lang = Column(String(8))
    top_score = Column(Float)        # best retrieval score achieved, for triage
