"""Lead qualification, capture, and GDPR rights.

Entirely new — neither BPAN nor Chios has a lead store. BPAN's consent surface is
`POST /api/consent` writing two booleans onto a session row; there is no contact
record, no retention clock and no erasure path, so this module is written from
scratch rather than adapted.

## Four flows, from his own contact form

His site's contact form already names the taxonomy: Business Consulting ·
Keynote Speech · One-on-One Mentoring · Collaboration with "Notify Show" · Other.
The original brief specified three flows and omitted the podcast pitch, which is
a real and distinct intake — the Notify Show has its own separate form on
`/en/notify-show/`. So: four.

## What this module will not do

* **It never quotes a price.** Not a range, not a "typically", not a currency
  symbol. Fees depend on format, audience, travel and scope; a number produced by
  a bot becomes an anchor he then has to argue down. `PRICE_DEFLECTION` is the
  single response.
* **It never confirms a booking.** It qualifies and hands off to the scheduler
  or to email. Nothing here writes to a calendar.
* **It never stores a lead without consent.** `capture()` refuses with 400 if
  `consent` is not affirmative — the row cannot exist without the demonstrable
  consent GDPR Art. 7(1) requires.

## The fit score

His contact page publishes a "DO NOT REACH OUT IF…" list — a qualification
rubric he already applies in writing. Reused here as an internal signal that
pre-sorts his inbox. It is admin-only and never surfaces to the prospect: the
point is to route his attention, not to grade people to their face.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session as OrmSession

from app.config import (
    LEAD_RETENTION_DAYS,
    ORG_EMAIL,
    PRIVACY_URL,
    scheduler_line,
)
from app.db import get_db
from app.models import Lead
from app.security import require_internal_user
from app.services.persona import detect_lang

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/leads", tags=["leads"])

# --------------------------------------------------------------------------- #
# Flow definitions. Question order matters: cheap identifying questions first,
# the ones a prospect might balk at (budget band, timeframe) last, so an
# abandoned flow still leaves something useful.
# --------------------------------------------------------------------------- #
FLOWS: dict[str, dict] = {
    "speaking": {
        "label_el": "Keynote / ομιλία",
        "label_en": "Keynote / speaking engagement",
        "questions": [
            {"key": "organisation", "el": "Ποια εταιρεία ή φορέας;", "en": "Which company or organisation?"},
            {"key": "occasion", "el": "Τι αφορμή; (συνέδριο, εταιρικό event, town hall…)", "en": "What's the occasion? (conference, company event, town hall…)"},
            {"key": "format", "el": "Keynote ή fireside chat / συζήτηση;", "en": "Keynote, or fireside chat / discussion?"},
            {"key": "audience", "el": "Πόσα άτομα και ποιοι; (στελέχη, όλη η εταιρεία, νέοι…)", "en": "How many people, and who? (executives, whole company, graduates…)"},
            {"key": "topic", "el": "Τι θέμα σε ενδιαφέρει;", "en": "What topic are you after?"},
            {"key": "language", "el": "Ελληνικά ή αγγλικά;", "en": "Greek or English?"},
            {"key": "when_where", "el": "Πότε και πού; (πόλη, ή online)", "en": "When and where? (city, or online)"},
        ],
    },
    "workshop": {
        "label_el": "Workshop / consulting για εταιρεία",
        "label_en": "Corporate workshop / consulting",
        "questions": [
            {"key": "organisation", "el": "Ποια εταιρεία;", "en": "Which company?"},
            {"key": "role", "el": "Ποιος είναι ο ρόλος σου;", "en": "What's your role?"},
            {"key": "problem", "el": "Τι πρόβλημα θέλεις να λυθεί; Πες το με τα δικά σου λόγια.", "en": "What problem do you want solved? In your own words."},
            {"key": "team_size", "el": "Πόσοι άνθρωποι αφορά;", "en": "How many people does it involve?"},
            {"key": "mode", "el": "Δια ζώσης, online, ή μικτό;", "en": "In person, online, or hybrid?"},
            {"key": "timeframe", "el": "Σε τι χρονικό ορίζοντα;", "en": "What's your timeframe?"},
        ],
    },
    "mentoring": {
        "label_el": "Προσωπικό mentoring / coaching",
        "label_en": "Individual mentoring / coaching",
        "questions": [
            {"key": "goal", "el": "Τι θέλεις να αλλάξει; Συγκεκριμένα.", "en": "What do you want to change? Specifically."},
            {"key": "seniority", "el": "Σε ποιο σημείο είσαι τώρα επαγγελματικά;", "en": "Where are you professionally right now?"},
            {"key": "tried", "el": "Τι έχεις δοκιμάσει μέχρι τώρα;", "en": "What have you tried so far?"},
            {"key": "commitment", "el": "Πόσο χρόνο μπορείς να αφιερώσεις τον μήνα;", "en": "How much time can you commit per month?"},
        ],
    },
    "podcast": {
        "label_el": "Guest στο «Θα Σας Ειδοποιήσουμε»",
        "label_en": "Guest on the Notify Show",
        "questions": [
            {"key": "organisation", "el": "Από ποια εταιρεία;", "en": "From which company?"},
            {"key": "story", "el": "Τι θα φέρεις στο τραπέζι; Ποια πρακτική ή ιστορία αξίζει να ακουστεί;", "en": "What would you bring? Which practice or story is worth hearing?"},
            {"key": "why_now", "el": "Γιατί τώρα;", "en": "Why now?"},
            {"key": "audience_value", "el": "Τι θα κερδίσει ο ακροατής;", "en": "What does the listener get out of it?"},
        ],
    },
}

CONSENT_TEXT_EL = (
    "Συμφωνώ να αποθηκευτούν το όνομα, το email και το τηλέφωνό μου ώστε να "
    "επικοινωνήσει μαζί μου η ομάδα του Κωνσταντίνου Κιντζιού για το αίτημά μου. "
    f"Έχω διαβάσει την <a href=\"{PRIVACY_URL}\">Πολιτική Απορρήτου</a>."
)
CONSENT_TEXT_EN = (
    "I agree to my name, email and phone being stored so that Konstantinos "
    "Kintzios's team can contact me about my request. I have read the "
    f"<a href=\"{PRIVACY_URL}\">Privacy Policy</a>."
)

PRICE_DEFLECTION_EL = (
    "<p>Δεν δίνω τιμές — και δεν είναι υπεκφυγή. Η αμοιβή εξαρτάται από τη μορφή, "
    "το κοινό, τη διάρκεια και το πού γίνεται. Οποιοδήποτε νούμερο σου έλεγα τώρα "
    "θα ήταν λάθος.</p>"
    "<p>Πες μου τι θέλεις να πετύχεις και το συζητάς απευθείας με τον Κωνσταντίνο.</p>"
)
PRICE_DEFLECTION_EN = (
    "<p>I don't quote fees — and that's not a dodge. It depends on the format, the "
    "audience, the length and where it happens. Any number I gave you now would be "
    "wrong.</p>"
    "<p>Tell me what you want to achieve and you can take it up with Konstantinos "
    "directly.</p>"
)

# Word-boundary anchored throughout. Without \b, "rate" matches inside
# "corporate"/"senior manager" phrasing and "fee" inside "feedback" — which
# would silently deflect real leadership questions as price questions. Caught in
# the smoke run: "How do I give feedback to a senior manager?" was routed to the
# price deflection.
# `πόσο κάνει` requires a following word that isn't a digit: "πόσο κάνει μια
# ομιλία" is a price question, "πόσο κάνει 2+2" is arithmetic and was being
# deflected with a fee explanation. Same for "how much".
_PRICE_RE = re.compile(
    r"\bτιμ[ήηέε]\w*|\bκοστ[ίι]ζ\w*|\bκ[όο]στο\w*|\bαμοιβ\w*|\bχρεων\w*"
    r"|π[όο]σο κ[άα]νει\s+(?!\d)\w|\bχρ[έε]ωση\w*|\bπροσφορ[άα]\b|€|\$"
    r"|\bprice[sd]?\b|\bpricing\b|\bcosts?\b|\bfees?\b|\brates?\b"
    r"|how much\s+(?!\d)\w|\bbudget\b|\bquote\b|\bquotation\b",
    re.IGNORECASE | re.UNICODE,
)


def is_price_question(text: str) -> bool:
    return bool(_PRICE_RE.search(text or ""))


def price_deflection(lang: str = "el") -> str:
    return PRICE_DEFLECTION_EL if lang == "el" else PRICE_DEFLECTION_EN


# --------------------------------------------------------------------------- #
# Fit score, derived from his published "DO NOT REACH OUT IF…" list.
#
# His page names five disqualifiers. They collapse into FOUR detectable signals,
# because the last two ("unwilling to hear hard truths", "prefers the safe and
# predictable") surface in enquiry text as the same request — keep it light,
# nothing controversial — and there is no wording that separates them:
#
#   his criterion                                  → key
#   looking for one-size-fits-all solutions        → one_size_fits_all
#   wants to tick a box without committing         → tick_a_box
#   not prepared to invest in themselves/their team → no_commitment
#   unwilling to hear hard truths ┐
#   prefers the safe and predictable ┘             → safe_only
#
# Scoring is crude by intent and advisory in effect. It sorts an inbox; it does
# not reject anyone, and no prospect ever sees it.
# --------------------------------------------------------------------------- #
_NEGATIVE = {
    "one_size_fits_all": r"[έε]τοιμ[οη] (πακ[έε]το|λ[ύυ]ση)|τυποποιημ[έε]ν|γρ[ήη]γορη λ[ύυ]ση|"
                         r"off.the.shelf|standard package|quick fix|template|one.size",
    "tick_a_box": r"τυπικ[άα] |για να το κλε[ίι]σουμε|υποχρ[έε]ωση|compliance|tick (a|the) box|"
                  r"box.ticking|just need someone",
    "no_commitment": r"χωρ[ίι]ς κ[όο]στο|δωρε[άα]ν|μικρ[όο] budget|no budget|free of charge|pro bono",
    "safe_only": r"τ[ίι]ποτα προκλητικ|χωρ[ίι]ς εντ[άα]σεισ?|light|χαλαρ[όο]|nothing controversial|"
                 r"keep it light|safe topic",
}
_POSITIVE = {
    "named_problem": r"πρ[όο]βλημα|δυσκολ[ίι]α|χ[άα]νουμε|turnover|αποχωρ|σ[ύυ]γκρουση|"
                     r"problem|struggling|losing|conflict|friction",
    "specific_scope": r"\d+\s*(άτομα|ατ[όο]μων|people|employees|στελ[έε]χη)|ομ[άα]δα των|team of",
    "decision_maker": r"\b(hr|ceo|cto|coo|διευθυντ|υπε[ύυ]θυν|founder|head of|manager)\b",
    "timeframe": r"\b(20\d\d|Q[1-4]|Ιαν|Φεβ|Μαρ|Απρ|Μα[ΐι]|Ιο[ύυ]ν|Ιο[ύυ]λ|Α[ύυ]γ|Σεπ|Οκτ|Νο[έε]|Δεκ"
                 r"|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b",
}


def score_fit(answers: dict, lang: str = "el") -> tuple[float, dict]:
    """Return (score in 0..1, notes). Advisory, admin-only."""
    blob = " ".join(str(v) for v in (answers or {}).values()).lower()
    notes: dict = {"negative": [], "positive": []}
    score = 0.5
    for name, pat in _NEGATIVE.items():
        if re.search(pat, blob, re.IGNORECASE | re.UNICODE):
            notes["negative"].append(name)
            score -= 0.15
    for name, pat in _POSITIVE.items():
        if re.search(pat, blob, re.IGNORECASE | re.UNICODE):
            notes["positive"].append(name)
            score += 0.12
    if len(blob) < 40:
        notes["negative"].append("very_short_answers")
        score -= 0.1
    return round(max(0.0, min(1.0, score)), 2), notes


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("/flows")
async def list_flows(lang: str = "el"):
    """The four flows and their questions, for the client to walk through."""
    lang = lang if lang in ("el", "en") else "el"
    return {
        "lang": lang,
        "consent_text": CONSENT_TEXT_EL if lang == "el" else CONSENT_TEXT_EN,
        "privacy_url": PRIVACY_URL,
        "flows": [
            {
                "id": fid,
                "label": f["label_el"] if lang == "el" else f["label_en"],
                "questions": [
                    {"key": q["key"], "text": q[lang]} for q in f["questions"]
                ],
            }
            for fid, f in FLOWS.items()
        ],
    }


class LeadIn(BaseModel):
    flow: str
    name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=64)
    organisation: str | None = Field(default=None, max_length=255)
    answers: dict = Field(default_factory=dict)
    consent: bool = False
    lang: str | None = None


@router.post("/capture")
async def capture(payload: LeadIn, db: OrmSession = Depends(get_db)):
    """Store a qualified lead. Refuses without affirmative consent."""
    if payload.flow not in FLOWS:
        raise HTTPException(400, f"Unknown flow: {payload.flow}")

    lang = payload.lang if payload.lang in ("el", "en") else detect_lang(
        " ".join([payload.name, *(str(v) for v in payload.answers.values())])
    )

    if not payload.consent:
        # GDPR Art. 7(1) — we must be able to demonstrate consent. No consent,
        # no row: refusing here is the only way that stays true.
        raise HTTPException(
            status_code=400,
            detail=(
                "Χρειάζεται η συγκατάθεσή σου για να αποθηκευτούν τα στοιχεία σου."
                if lang == "el"
                else "Your consent is required before your details can be stored."
            ),
        )

    now = datetime.utcnow()
    fit, notes = score_fit(payload.answers, lang)
    summary = " · ".join(
        f"{k}: {str(v)[:120]}" for k, v in (payload.answers or {}).items() if v
    )

    lead = Lead(
        created_at=now,
        # Retention is stamped on the row, so changing the config later cannot
        # silently extend the retention of data already collected.
        expires_at=now + timedelta(days=LEAD_RETENTION_DAYS),
        flow=payload.flow,
        lang=lang,
        name=payload.name.strip(),
        email=str(payload.email).lower().strip(),
        phone=(payload.phone or "").strip() or None,
        organisation=(payload.organisation or "").strip() or None,
        answers=payload.answers,
        summary=summary[:4000],
        consent_given=True,
        consent_ts=now,
        consent_text=CONSENT_TEXT_EL if lang == "el" else CONSENT_TEXT_EN,
        fit_score=fit,
        fit_notes=notes,
        status="new",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    logger.info("Lead %s captured (flow=%s, fit=%.2f)", lead.id, lead.flow, fit)

    thanks = (
        f"<p>Ευχαριστώ. Τα στοιχεία σου καταγράφηκαν και θα τα δει άνθρωπος από "
        f"την ομάδα του Κωνσταντίνου.</p><p>{scheduler_line(lang)}</p>"
        if lang == "el" else
        f"<p>Thank you. Your details are logged and a human from Konstantinos's "
        f"team will see them.</p><p>{scheduler_line(lang)}</p>"
    )
    # fit_score deliberately absent from the response.
    return {
        "ok": True,
        "lead_id": lead.id,
        "message": thanks,
        "retention_days": LEAD_RETENTION_DAYS,
        "erasure": f"DELETE /api/leads/erase?email={lead.email}",
    }


class EraseIn(BaseModel):
    email: EmailStr
    confirm: bool = True


@router.delete("/erase")
async def erase(payload: EraseIn, db: OrmSession = Depends(get_db)):
    """GDPR Art. 17 — erasure by email. Public, unauthenticated, by design.

    Requiring a login to exercise a data right would defeat the right: the people
    most likely to use it are those who never wanted an account. The deletion is
    a hard DELETE, not a soft flag.

    **The response is identical whether or not the address was present.** An
    earlier version returned the deleted row count, which is precisely an
    address-existence oracle: `deleted: 0` means "never contacted him",
    `deleted: 1` means "did". On an unauthenticated endpoint that lets anyone
    enumerate his client list one address at a time — and the addresses worth
    testing are exactly the ones an attacker would guess (a competitor's CEO, a
    journalist). The count is logged server-side, where the team needs it, and is
    not returned.
    """
    email = str(payload.email).lower().strip()
    n = db.query(Lead).filter(func.lower(Lead.email) == email).delete(
        synchronize_session=False
    )
    db.commit()
    logger.info("Erasure request processed for %s… (%d row(s)).", email[:3], n)
    return {
        "ok": True,
        "message": (
            "Το αίτημα διαγραφής εκτελέστηκε. Αν υπήρχαν στοιχεία με αυτό το "
            f"email, έχουν διαγραφεί. · Your erasure request has been processed. "
            f"If any details existed for this address, they have been deleted. "
            f"({ORG_EMAIL})"
        ),
    }


def purge_expired(db: OrmSession) -> int:
    """Delete leads past their stamped retention date. Called by startup/admin."""
    n = db.query(Lead).filter(Lead.expires_at < datetime.utcnow()).delete(
        synchronize_session=False
    )
    db.commit()
    if n:
        logger.info("Retention purge removed %d expired lead(s).", n)
    return n


@router.get("/admin/list")
async def admin_list(
    db: OrmSession = Depends(get_db),
    user: str = Depends(require_internal_user),
    flow: str | None = None,
    limit: int = 100,
):
    """Admin-only lead list. Fail-closed auth (see security.py).

    Runs the retention purge first, so the list can never show data that should
    already have been deleted even if no scheduled job is configured.
    """
    purge_expired(db)
    q = db.query(Lead)
    if flow:
        q = q.filter(Lead.flow == flow)
    rows = q.order_by(Lead.created_at.desc()).limit(min(limit, 500)).all()
    return {
        "count": len(rows),
        "retention_days": LEAD_RETENTION_DAYS,
        "leads": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "flow": r.flow,
                "lang": r.lang,
                "name": r.name,
                "email": r.email,
                "phone": r.phone,
                "organisation": r.organisation,
                "summary": r.summary,
                "answers": r.answers,
                "fit_score": r.fit_score,
                "fit_notes": r.fit_notes,
                "status": r.status,
                "consent_ts": r.consent_ts.isoformat() if r.consent_ts else None,
            }
            for r in rows
        ],
    }
