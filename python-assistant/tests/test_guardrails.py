"""Guardrails, quote grounding, and language handling."""
from __future__ import annotations

import pytest

from app.services import guardrails as g
from app.services.grounding import check_quotes, redact_ungrounded, tokens
from app.services.persona import detect_lang

# --------------------------------------------------------------------------- #
# Scope routing. One probe per class per language, per persona/README.md's rule
# that a new ❌ line gets a probe in both languages.
# --------------------------------------------------------------------------- #
REFUSE_CASES = [
    ("el", "Έχω πονοκεφάλους, τι φάρμακο να πάρω;", "medical"),
    ("en", "What medication should I take for my symptoms?", "medical"),
    ("el", "Θέλω ψυχοθεραπεία για αγχώδη διαταραχή", "psychological"),
    ("en", "Can you diagnose me, I think I have an anxiety disorder", "psychological"),
    ("el", "Να κάνω αγωγή στον εργοδότη; Τι λέει το εργατικό δίκαιο;", "legal"),
    ("en", "Should I sue my employer for wrongful termination?", "legal"),
    ("el", "Σε ποιες μετοχές να επενδύσω το bonus μου;", "financial"),
    ("en", "How should I invest my bonus in crypto?", "financial"),
]


@pytest.mark.parametrize("lang,q,cls", REFUSE_CASES)
def test_refusal_classes(lang, q, cls):
    v = g.classify(q)
    assert v["action"] == "refuse", (q, v)
    assert v["class"] == cls, (q, v)
    body = g.refusal_response(v["class"], lang)
    assert body.startswith("<p>")
    # A refusal must redirect, never dead-end.
    assert ("Ρώτησέ με" in body) or ("Ask me" in body)


DISTRESS_CASES = [
    ("el", "Νομίζω ότι έχω κατάθλιψη με τη δουλειά"),
    ("el", "δεν αντεχω αλλο, δεν βλεπω φωσ"),          # unaccented, as typed
    ("en", "I think I'm depressed about work"),
    ("en", "I can't go on like this"),
]


@pytest.mark.parametrize("lang,q", DISTRESS_CASES)
def test_distress_takes_precedence_and_gives_a_number(lang, q):
    v = g.classify(q)
    assert v["action"] == "distress", (q, v)
    body = g.distress_response(lang)
    assert "1018" in body                      # the Greek support line
    assert "112" in body or "166" in body       # emergency route


def test_distress_beats_a_refusal_class():
    """A message that is BOTH clinical-sounding and distressed must escalate,
    not return a polite boundary with no help in it."""
    v = g.classify("έχω κατάθλιψη και θέλω φάρμακα, δεν αντέχω άλλο")
    assert v["action"] == "distress"


IN_SCOPE = [
    "Πώς διοικώ μια ομάδα με Gen Z;",
    "How do I give feedback to a senior manager?",
    "Ο manager μου με απέλυσε, ήταν δίκαιο;",     # legal keyword, in-scope context
    "How do I ask for a promotion?",
    "Ποιος είσαι;",
    "Are you a real human or an AI?",
]


@pytest.mark.parametrize("q", IN_SCOPE)
def test_in_scope_questions_are_not_refused(q):
    v = g.classify(q)
    assert v["action"] == "answer", (q, v)


def test_feedback_is_not_a_price_question():
    """Regression: unanchored /fee|rate/ matched 'feedback' and 'corporate',
    routing real leadership questions to the price deflection."""
    from app.routers.leads import is_price_question

    assert not is_price_question("How do I give feedback to a senior manager?")
    assert not is_price_question("What about corporate culture?")
    assert is_price_question("What are your rates?")
    assert is_price_question("Πόσο κοστίζει μια ομιλία;")


def test_price_response_contains_no_number():
    for lang in ("el", "en"):
        body = g.__dict__ and __import__(
            "app.routers.leads", fromlist=["price_deflection"]
        ).price_deflection(lang)
        assert not any(ch.isdigit() for ch in body), body
        assert "€" not in body and "$" not in body


def test_disclosure_states_it_is_ai():
    assert "AI" in g.disclosure("en")
    assert "τεχνητή" in g.disclosure("el").lower() or "AI" in g.disclosure("el")


# --------------------------------------------------------------------------- #
# Language detection
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("text,expected", [
    ("Πώς διοικώ μια ομάδα;", "el"),
    ("How do I manage a team?", "en"),
    # Greek sentence dense with English loanwords — the BPAN majority-count rule
    # calls this English, which is why detect_lang uses a fraction threshold.
    ("έχω πρόβλημα με το onboarding του manager", "el"),
    ("θέλω feedback από τον manager μου για το performance review", "el"),
    ("", "el"),
])
def test_language_detection(text, expected):
    assert detect_lang(text) == expected


# --------------------------------------------------------------------------- #
# Deterministic quote grounding
# --------------------------------------------------------------------------- #
DOCS = [
    {"content": "Θα σου πω κάτι που δεν αρέσει σε κανέναν manager. "
                "Το πρόβλημα δεν είναι η Gen Z."},
    {"content": "I don't present theories. I provide answers."},
]


def test_greek_tokenisation_is_not_empty():
    """The upstream tokenizer was ASCII-only, so Greek quotes tokenised to []
    and every Greek fabrication passed as 'nothing to check'."""
    assert tokens("Η ΗΓΕΣΊΑ των στελεχών") == ["ηγεσια", "των", "στελεχων"]


def test_real_quote_passes():
    r = check_quotes('<p>Λέει: «Το πρόβλημα δεν είναι η Gen Z»[1].</p>', DOCS)
    assert r["checked"] == 1 and r["grounded"] == 1 and r["ok"]


def test_fabricated_quote_is_caught_and_removed():
    html = '<p>Λέει: «Ο ηγέτης πρέπει να χτίζει εμπιστοσύνη κάθε μέρα»[1].</p>'
    r = check_quotes(html, DOCS)
    assert not r["ok"] and r["ungrounded"]
    out = redact_ungrounded(html, r, "el")
    assert "εμπιστοσύνη κάθε μέρα" not in out
    assert "αφαιρέθηκε" in out


def test_accent_and_case_differences_still_match():
    docs = [{"content": "Η ΗΓΕΣΙΑ ΕΙΝΑΙ ΕΠΙΛΟΓΗ ΚΑΘΕ ΜΕΡΑ ΓΙΑ ΤΟΝ ΚΑΘΕΝΑ"}]
    r = check_quotes('<p>«η ηγεσία είναι επιλογή κάθε μέρα»[1]</p>', docs)
    assert r["ok"], r


def test_english_quote_checked_too():
    r = check_quotes('<p>He says: "I provide answers"[2].</p>', DOCS)
    assert r["checked"] == 1 and r["ok"]


def test_psychological_beats_medical_on_overlap():
    """The margin is 2 hits vs 1, so this is worth pinning.

    «θέλω ψυχοθεραπεία για αγχώδη διαταραχή» matches `medical` once — θεραπεια is
    a substring of ψυχοθεραπεία — and `psychological` twice. Before class scoring
    was added, dict order made this "medical", i.e. a refusal pointing the person
    at the wrong kind of professional.
    """
    from app.services.guardrails import _REFUSE_RE, _fold, classify

    q = "θέλω ψυχοθεραπεία για αγχώδη διαταραχή"
    counts = {c: len(rx.findall(_fold(q))) for c, rx in _REFUSE_RE.items()}
    assert counts["psychological"] == 2, counts
    assert counts["medical"] == 1, counts
    assert classify(q)["class"] == "psychological"


def test_psychological_is_listed_before_medical():
    """Tie-break insurance: on equal hit counts the more specific class must win."""
    from app.services.guardrails import _REFUSE_RE

    keys = list(_REFUSE_RE)
    assert keys.index("psychological") < keys.index("medical"), keys
