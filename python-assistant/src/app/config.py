# src/app/config.py — DialogosAI / Kintzios
#
# Re-skin of the BPAN Companion config (../../src/app/config.py). Same shape:
# load .env early, anchor every path to the app root, expose PATHS, hold the
# CAG fact block that is baked into the system prompt every turn.
#
# Deltas vs BPAN (see ARCHITECTURE_NOTES.md §3):
#   * ORG_FACTS  → Kintzios facts, taken verbatim from kkintzios.com
#   * port 8002  → 8020  (BPAN 8002, Chios 8010, Kintzios 8020)
#   * new: LEAD_RETENTION_DAYS, SCHEDULER_URL, PERSONA_DIR, CORPUS_DIR
#   * new: RIGHTS_CLEARED_ONLY / PERSONA_SPEAKER — the retrieval filter contract
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# `override=True` so a real .env beats a stale shell export — the usual dev
# expectation. The escape hatch exists for the test suite: with a .env present,
# load_dotenv() would otherwise hand the developer's real admin credentials to the
# fail-closed auth tests, which assert on the UNCONFIGURED state. See
# tests/conftest.py for the full reasoning.
if not os.environ.get("KINTZIOS_SKIP_DOTENV"):
    load_dotenv(override=True)


# --- logging ---
def configure_logging(level=logging.INFO):
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )


# --- constants / timeouts ---
DEFAULT_TIMEOUT = 30
AI_GENERATION_TIMEOUT = 60
SCRAPING_TIMEOUT = 15

# --- directories ---
# Anchored to kintzios/ (parent of src/), so behaviour doesn't depend on the
# cwd uvicorn was launched from. Same fix as BPAN config.py.
_BASE_DIR = Path(__file__).resolve().parents[2]   # …/kintzios/

CORPUS_DIR     = str(_BASE_DIR / "corpus")
TRANSCRIPTS_DIR = str(_BASE_DIR / "corpus" / "transcripts")
PILLARS_DIR    = str(_BASE_DIR / "corpus" / "pillars")
EMBEDDINGS_DIR = str(_BASE_DIR / "embeddings")
PERSONA_DIR    = str(_BASE_DIR / "persona")
SCRAPED_DIR    = str(_BASE_DIR / "content")
UPLOADS_DIR    = str(_BASE_DIR / "uploads")

for _d in [CORPUS_DIR, TRANSCRIPTS_DIR, PILLARS_DIR, EMBEDDINGS_DIR, SCRAPED_DIR, UPLOADS_DIR]:
    os.makedirs(_d, exist_ok=True)

PATHS = {
    "CORPUS_DIR": CORPUS_DIR,
    "TRANSCRIPTS_DIR": TRANSCRIPTS_DIR,
    "PILLARS_DIR": PILLARS_DIR,
    "EMBEDDINGS_DIR": EMBEDDINGS_DIR,
    "PERSONA_DIR": PERSONA_DIR,
    "SCRAPED_DIR": SCRAPED_DIR,
    "UPLOADS_DIR": UPLOADS_DIR,
}

# --- LLM keys ---
# Same rotation contract as BPAN: GEMINI_API_KEY, GEMINI_API_KEY_2..10.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# EMBEDDINGS_AVAILABLE gates the FAISS/Gemini-embedding leg. Without a key the
# app still runs on the keyless TF-IDF leg — that is what the test suite uses.
try:
    import faiss  # noqa: F401
    EMBEDDINGS_AVAILABLE = bool(GEMINI_API_KEY)
except Exception:
    EMBEDDINGS_AVAILABLE = False

# --- server ---
APP_PORT = int(os.environ.get("APP_PORT", "8020"))

CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS",
        f"http://localhost:{APP_PORT},http://127.0.0.1:{APP_PORT}",
    ).split(",")
    if o.strip()
]

# --- internal / admin auth ---
# BPAN's security.py disables auth when these are unset. We keep the env-var
# contract but Kintzios FAILS CLOSED — the admin page holds lead PII.
# See ARCHITECTURE_NOTES.md §4.3.
INTERNAL_USER = os.environ.get("INTERNAL_USER", "")
INTERNAL_PASSWORD = os.environ.get("INTERNAL_PASSWORD", "")
ALLOW_INSECURE_ADMIN = os.environ.get("ALLOW_INSECURE_ADMIN", "") == "1"

# --- lead handling / GDPR ---
# Retention default 6 months. A nightly purge is not scheduled here; the
# purge_expired_leads() helper in crud.py is called on startup and by the
# admin route, which is enough for MVP volumes.
LEAD_RETENTION_DAYS = int(os.environ.get("LEAD_RETENTION_DAYS", "180"))
SCHEDULER_URL = os.environ.get("SCHEDULER_URL", "")          # Calendly / HubSpot stub
PRIVACY_URL = os.environ.get("PRIVACY_URL", "/privacy-policy")

# --- retrieval filter contract ---
# The single predicate that separates the public persona from internal search.
# Public answers may ONLY use chunks where speaker == PERSONA_SPEAKER AND
# rights_cleared is True. Internal search applies no filter. Defined once here
# so the two routes cannot drift apart (ARCHITECTURE_NOTES.md §5.2).
PERSONA_SPEAKER = os.environ.get("PERSONA_SPEAKER", "Kintzios")

# --- languages ---
SUPPORTED_LANGS = ("el", "en")
DEFAULT_LANG = "el"

# --- Organisation / person facts injected into the system prompt (CAG block) ---
# Always available to the LLM regardless of retrieval, so the assistant can
# answer "how do I reach him" or "how many keynotes" without a retrieval hit.
# Every figure below is published on kkintzios.com — do not add unsourced ones.
ORG_NAME = os.environ.get("ORG_NAME", "Konstantinos Kintzios")
ORG_EMAIL = os.environ.get("ORG_EMAIL", "info@kkintzios.com")

# --- Assistant identity -----------------------------------------------------
# The assistant has a name of its own, and that is a transparency feature rather
# than a branding flourish: "Kitsi" is audibly a diminutive OF Kintzios, not
# Kintzios. A bot called "Konstantinos Kintzios" would imply it IS him, which is
# the impression the EU AI Act Art. 50 disclosure exists to prevent.
#
# Defined here once, because it appears in both persona prompts, the chat page,
# the widget, the guardrail responses and the page titles — six places that would
# otherwise drift apart the first time he wants it changed.
ASSISTANT_NAME = os.environ.get("ASSISTANT_NAME", "Kitsi")
ASSISTANT_NAME_EL = os.environ.get("ASSISTANT_NAME_EL", "Κίτσι")

# --- Brand palette ----------------------------------------------------------
# Taken from kkintzios.com itself, not chosen: #ff7d00 and #070f45 are the only
# two colours his site uses with any frequency (64 and 44 occurrences on the home
# pages), and #080f45 — a near-identical navy — is the fill of his own logo SVG.
# An earlier build used an invented gold (#c8a45c); it looked fine and matched
# nothing he owns.
BRAND_ORANGE = "#ff7d00"     # primary accent, CTAs, his own K glyph
BRAND_NAVY = "#070f45"       # ink, headers, avatar ground
BRAND_NAVY_LOGO = "#080f45"  # exact fill of kintzios-logo.svg
ORG_WEBSITE = os.environ.get("ORG_WEBSITE", "https://kkintzios.com")
ORG_PODCAST = os.environ.get("ORG_PODCAST", "Θα Σας Ειδοποιήσουμε / Notify Show")

_DEFAULT_ORG_FACTS = f"""\
ΟΝΟΜΑ: {ORG_NAME} (MBA) — Business Mentor | Leadership Coach | Public Speaker
ΙΣΤΟΣΕΛΙΔΑ: <a href="{ORG_WEBSITE}" target="_blank">{ORG_WEBSITE}</a>
EMAIL: <a href="mailto:{ORG_EMAIL}">{ORG_EMAIL}</a>
PODCAST: {ORG_PODCAST} — το No1 business podcast στην Ελλάδα,
  ~500.000 μηνιαία engagement σε Spotify / Apple Podcasts / YouTube.
ΕΜΠΕΙΡΙΑ (δημοσιευμένα στοιχεία):
  - 500+ keynote speeches
  - 250+ εταιρείες consulting
  - 8.000+ στελέχη σε mentoring
  - ~5.000 νέοι απόφοιτοι σε 8 χρόνια
  - 20 χρόνια στον χώρο
  - Νο2 πιο επιδραστικό LinkedIn προφίλ στην Ελλάδα (πηγή: Favikon)
ΠΡΟΣΩΠΙΚΗ ΙΣΤΟΡΙΑ: Το 2009 ζύγιζε 170 κιλά· έχασε 90 κιλά. Από αυτή την
  εμπειρία προκύπτει η κεντρική του θέση: κάθε αλλαγή ξεκινά από μία απόφαση —
  να πιστέψεις ότι τα πράγματα μπορούν να γίνουν καλύτερα.
ΥΠΗΡΕΣΙΕΣ ΓΙΑ ΕΤΑΙΡΕΙΕΣ: Business Consulting · Keynote Speaking (fireside chat
  format) · Leadership Development Workshops · Personal Development Talks ·
  Executive & C-Level Mentoring · People Management Skills · Generation Bridge
  Program (Gen Z / πολυγενεακές ομάδες).
ΥΠΗΡΕΣΙΕΣ ΓΙΑ ΑΤΟΜΑ: Personal Career Mentoring · Personal Development Talks ·
  Personal Branding & Networking · Strategic Connection Facilitation · Group
  Career Workshops · Leadership Coaching · Public Speaking Training.
ΘΕΜΑΤΙΚΟΙ ΠΥΛΩΝΕΣ: προσφέρει ~50 θεματικούς πυλώνες για keynotes· αν δεν
  υπάρχει αυτό που χρειάζεται ο πελάτης, φτιάχνεται νέος μαζί.
ΣΤΑΤΙΣΤΙΚΑ ΠΟΥ ΧΡΗΣΙΜΟΠΟΙΕΙ ΔΗΜΟΣΙΑ:
  - 89% των αποφάσεων πρόσληψης/απόλυσης παγκοσμίως βασίζονται στον χαρακτήρα,
    όχι μόνο στις δεξιότητες (πηγή: Leadership IQ).
  - 44% της Gen Z θεωρεί ότι οι προσδοκίες τους από την εργασία διαφέρουν
    σημαντικά από των παλαιότερων συναδέλφων (πηγή: Deloitte).
"""

ORG_FACTS = os.environ.get("ORG_FACTS", _DEFAULT_ORG_FACTS)


# --- link exclusion (reused verbatim from BPAN config.py contract) ---
# Any retrieved source whose URL/title matches one of these is cited by title
# only, never rendered as a clickable link.
_DO_NOT_LINK = [
    s.strip().lower()
    for s in os.environ.get("DO_NOT_LINK", "reboot-your-career,course,internal").split(",")
    if s.strip()
]


def is_link_excluded(value: str) -> bool:
    """True if this URL/title must not be rendered as a clickable link."""
    if not value:
        return False
    v = value.lower()
    return any(tok in v for tok in _DO_NOT_LINK)


# --- scheduler handoff copy ---
def scheduler_line(lang: str = "el") -> str:
    """The booking handoff. Empty SCHEDULER_URL degrades to an email prompt."""
    if SCHEDULER_URL:
        if lang == "el":
            return f'Κλείσε ένα σύντομο call: <a href="{SCHEDULER_URL}" target="_blank">{SCHEDULER_URL}</a>'
        return f'Book a short call: <a href="{SCHEDULER_URL}" target="_blank">{SCHEDULER_URL}</a>'
    if lang == "el":
        return f'Στείλε mail στο <a href="mailto:{ORG_EMAIL}">{ORG_EMAIL}</a> και κλείνουμε ένα call.'
    return f'Email <a href="mailto:{ORG_EMAIL}">{ORG_EMAIL}</a> and we will set up a call.'


METRICS_DEFAULT = {"questions": 0, "refusals": 0, "leads": 0, "no_retrieval": 0}
APP_HEALTH_DEFAULT = {"status": "starting", "indexed_chunks": 0}

# --- Agentic tool loop -----------------------------------------------------
# When on, the model chooses which tools to call (search_corpus, match_pillars,
# start_lead_flow) instead of the router deciding with if-statements. Falls back
# to single-shot generation automatically when the loop returns nothing, so
# turning this off is a rollback switch rather than a feature removal.
#
# Distress, price deflection and the rights filter stay OUTSIDE the loop in
# both modes — see services/tools.py for why.
AGENT_ENABLED = os.environ.get("AGENT_ENABLED", "1") not in ("0", "false", "no")
