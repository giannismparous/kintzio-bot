"""Scope guardrails, distress escalation, and the AI Act Art. 50 disclosure.

Adapted from BPAN's `triage_service.py`, which classifies an incoming message
into six welfare categories with a Gemini JSON schema plus a sentiment score.
Structure retained; the semantics are different in three ways that matter.

1. **Deterministic first, LLM second.** BPAN's triage is LLM-only. Here the
   refusal classes are matched lexically before any model call. Two reasons: a
   refusal must not depend on an API being up or a key having quota, and a
   medical or crisis message must not be delayed by a network round trip. The
   LLM classifier is an optional second pass for intent routing, never the thing
   standing between a distressed user and a phone number.

2. **Distress is checked before scope.** A message can be both out-of-scope and
   a crisis ("I'm exhausted and I can't go on"). Ordering matters: classifying it
   as "psychological — refused" first would return a polite boundary and no help.
   So distress wins, always.

3. **This is a coaching brand, not a clinic — which raises the risk, not lowers
   it.** BPAN's users arrive knowing it is a patient-support service. A
   self-help-adjacent business mentor attracts people in genuine difficulty who
   are *not* expecting a clinical context, and the bot's confident register makes
   it likelier to be taken as advice. Hence a lower distress threshold than BPAN
   uses, and no partial answers on refusal classes.

The Greek crisis line is 1018 — BPAN's own system prompt names it
Γραμμή Ζωής 1018, and that label is kept verbatim here rather than paraphrased,
because a service name a distressed user may search for is not ours to reword. As in the BPAN
app. Numbers live here, never in the persona prompt, so there is one place to
correct them.
"""
from __future__ import annotations

import logging
import re
import unicodedata

logger = logging.getLogger(__name__)


def _fold(s: str) -> str:
    """Lowercase + strip Greek diacritics so patterns match unaccented input.

    Users type without accents constantly ("δεν αντεχω αλλο"). A pattern list
    that only matches accented forms would miss exactly the messages typed in a
    hurry, which correlates with the ones that matter most.
    """
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return unicodedata.normalize("NFC", s).replace("ς", "σ")


# --------------------------------------------------------------------------- #
# Distress. Checked first, and generously.
#
# A false positive costs a slightly odd reply plus a phone number. A false
# negative means a person in crisis gets leadership advice. The asymmetry is not
# close, so these patterns err toward catching.
# --------------------------------------------------------------------------- #
_DISTRESS = [
    # Greek — self-harm / hopelessness / crisis
    r"δεν αντεχω", r"δεν μπορω αλλο", r"δεν βλεπω φωσ", r"δεν εχει νοημα",
    r"θελω να τελειωσω", r"να δωσω τελοσ", r"αυτοκτον", r"να πεθανω",
    r"καταθλιψ", r"κριση πανικου", r"πανικο", r"απελπισ", r"μονοσ μου",
    r"κλαιω καθε", r"δεν κοιμαμαι", r"εξουθενωμεν", r"burn ?out", r"λυγισα",
    r"δεν αξιζω", r"βαροσ σε ολουσ", r"φαρμακα", r"ψυχιατρ", r"ψυχολογο",
    # English
    r"can'?t (go on|take it|cope)", r"want to (die|end (it|my life))",
    r"kill myself", r"suicid", r"self.?harm", r"hopeless", r"no way out",
    r"panic attack", r"depress", r"breaking down", r"burned? out",
    r"worthless", r"nobody cares", r"can'?t sleep",
]
_DISTRESS_RE = re.compile("|".join(_DISTRESS), re.IGNORECASE | re.UNICODE)

# --------------------------------------------------------------------------- #
# Refusal classes. Four, as specified.
# --------------------------------------------------------------------------- #
_REFUSE = {
    "psychological": [
        # Requests for therapy/diagnosis. Distinct from _DISTRESS, which is a
        # person in difficulty rather than someone asking for clinical work.
        r"θεραπει[αε]σ? ", r"ψυχοθεραπ", r"διαγνωση καταθλιψ", r"διπολικ",
        r"αγχωδη διαταραχη", r"διαταραχη", r"adhd", r"διασπαση προσοχησ",
        r"therapy", r"psychotherap", r"diagnose me", r"bipolar", r"\badhd\b",
        r"anxiety disorder", r"ptsd", r"\bocd\b", r"mental (illness|disorder)",
    ],
    "medical": [
        r"συμπτωμα", r"διαγνωσ", r"φαρμακ", r"δοσολογ", r"θεραπεια", r"πονο",
        r"γιατρο", r"εξετασει", r"αρρωστ", r"εγκυ", r"διατροφολογ", r"διαιτα",
        r"symptom", r"diagnos", r"medicat", r"dosage", r"treatment", r"doctor",
        r"prescription", r"illness", r"pregnan", r"\bdiet\b",
    ],
    "legal": [
        r"νομικ", r"δικηγορο", r"αγωγη", r"μηνυση", r"δικαστηριο", r"συμβαση",
        r"αποζημιωση", r"απολυση ειναι νομιμ", r"εργατικο δικαιο", r"καταγγελια συμβασησ",
        r"legal", r"lawyer", r"attorney", r"sue\b", r"lawsuit", r"court",
        r"contract (law|clause)", r"wrongful (termination|dismissal)",
        r"severance", r"unfair dismissal", r"employment law",
    ],
    "financial": [
        r"επενδυ", r"μετοχ", r"χρηματιστηριο", r"κρυπτο", r"bitcoin", r"φορολογ",
        r"φορο", r"εφορια", r"δανειο", r"επιτοκιο", r"αποδοση κεφαλαιου",
        r"invest", r"stock market", r"\bshares?\b", r"crypto", r"\btax(es|ation)?\b",
        r"\bloan\b", r"interest rate", r"portfolio", r"\bira\b", r"401k",
    ],
}
_REFUSE_RE = {
    k: re.compile("|".join(v), re.IGNORECASE | re.UNICODE) for k, v in _REFUSE.items()
}

# In-scope vocabulary. Used to resolve overlap: "should I take legal action about
# my promotion" hits `legal`, but "how do I ask for a promotion" must not.
_IN_SCOPE = re.compile(
    "|".join([
        r"ηγεσι", r"ηγετ", r"ομαδα", r"στελεχ", r"manager", r"διοικησ", r"κουλτουρα",
        r"εργασιακ", r"υπαλληλ", r"εργαζομεν", r"καριερα", r"προαγωγη", r"μεντορ",
        r"mentoring", r"coaching", r"gen ?z", r"γενι[εω]", r"feedback", r"ομιλια",
        r"keynote", r"workshop", r"podcast", r"συνεντευξη", r"βιογραφικο",
        r"personal brand", r"networking", r"leadership", r"team", r"culture",
        r"career", r"promotion", r"employee", r"onboarding", r"retention",
        r"turnover", r"speaking", r"interview", r"\bcv\b", r"resume",
        # Identity / service / logistics questions. These carry no leadership
        # vocabulary but are squarely in scope and answerable from ORG_FACTS:
        # "who are you", "what does he do", "how do I book him".
        r"ποιοσ εισαι", r"ποιοσ ειναι", r"τι κανει", r"τι κανεισ", r"με ποιον μιλαω",
        r"κιντζιο", r"υπηρεσι", r"επικοινων", r"κλεισω", r"κρατηση", r"τιμ[ηέε]",
        r"κοστο", r"αμοιβ", r"διαθεσιμ", r"βιογραφικ[οό] του", r"εμπειρια",
        r"who are you", r"are you (a |an )?(ai|bot|human|real)", r"what do you do",
        r"kintzios", r"servic", r"contact", r"\bbook\b", r"booking", r"availab",
        r"price", r"\bfee\b", r"\bcost\b", r"hire", r"experience",
        # Gaps found by tests/test_relevance.py, where a real on-topic question
        # fell through the gate and was refused as off-topic:
        #   · "what makes a good leader" — only "leadership" was listed, not the
        #     bare noun/adjective forms.
        #   · "οι νέοι μας φεύγουν στον πρώτο χρόνο" — retention phrased in plain
        #     Greek, with no HR loanword anywhere in it. This is how a Greek
        #     manager actually types the question, so it must match.
        r"\bleader\b", r"\bleaders\b", r"\bleading\b", r"\bboss\b",
        r"φευγουν", r"αποχωρ", r"παραιτ", r"εγκαταλειπ",
        r"νεοι", r"νεουσ", r"αποφοιτ", r"προσληψ", r"προσλαμβ",
        r"δεξιοτητ", r"χαρακτηρα", r"συνεργατ", r"προϊσταμεν", r"αφεντικο",
        r"\bhiring\b", r"\bfiring\b", r"\bquit\b", r"\bresign", r"\bgraduate",
        r"\bskills?\b", r"\bcharacter\b", r"\bcolleague", r"\bmotivat",
    ]),
    re.IGNORECASE | re.UNICODE,
)


def classify(message: str) -> dict:
    """Route a message. Deterministic, no API call.

    Returns ``{"action": ..., "class": ..., "matched": ...}`` where action is
    one of ``distress`` | ``refuse`` | ``answer``.
    """
    folded = _fold(message)

    # 1. Distress first — always, even if the message also looks off-topic.
    m = _DISTRESS_RE.search(folded)
    if m:
        logger.info("Guardrail: distress signal %r", m.group(0))
        return {"action": "distress", "class": "distress", "matched": m.group(0)}

    # 2. Refusal classes. An in-scope workplace signal downgrades a single
    #    keyword hit — otherwise "my manager fired me, was that fair?" would be
    #    refused as legal when it is exactly what he talks about. Two or more
    #    hits in the same class still refuses: that is a real request for
    #    professional advice, not workplace vocabulary overlap.
    #    All classes are scored and the STRONGEST wins — not the first one in
    #    dict order. "θέλω ψυχοθεραπεία για αγχώδη διαταραχή" hits `medical` once
    #    (θεραπεια, as a substring of ψυχοθεραπεία) and `psychological` twice
    #    (ψυχοθεραπ, αγχωδη διαταραχη); returning on first match labelled it
    #    medical, which produces a refusal pointing at the wrong kind of
    #    professional. The margin here is 2 vs 1 — thin, which is why
    #    `psychological` is also listed FIRST in _CLASS_PATTERNS so that a tie
    #    resolves to the more specific class rather than to dict insertion luck.
    in_scope = bool(_IN_SCOPE.search(folded))
    scored: list[tuple[int, int, str, list[str]]] = []
    for rank, (cls, rx) in enumerate(_REFUSE_RE.items()):
        hits = rx.findall(folded)
        if not hits:
            continue
        if in_scope and len(hits) < 2:
            logger.info("Guardrail: %s keyword %r overridden by in-scope context", cls, hits[:1])
            continue
        scored.append((len(hits), -rank, cls, hits))

    if scored:
        scored.sort(reverse=True)
        _, _, cls, hits = scored[0]
        logger.info("Guardrail: refusing as %s (%d hits)", cls, len(hits))
        return {"action": "refuse", "class": cls, "matched": hits[:3]}

    # 3. No refusal class matched. Whether this is genuinely in scope is not
    #    decidable lexically — "what is the capital of Peru" contains no banned
    #    keyword, and on the seed corpus it still retrieves chunks at a score
    #    (0.098) close enough to a real question (0.186) that a score threshold
    #    alone cannot separate them. So the topical signal is returned to the
    #    caller, which combines it with the retrieval score: no topical signal
    #    AND weak retrieval → off-topic. Either one alone is not enough to
    #    refuse, because a rephrased on-topic question can miss the vocabulary
    #    list and a strong retrieval hit is itself evidence of relevance.
    return {
        "action": "answer",
        "class": "in_scope" if in_scope else "unclear",
        "matched": None,
        "topical": in_scope,
    }


# --------------------------------------------------------------------------- #
# Responses. HTML, per the persona formatting contract.
# --------------------------------------------------------------------------- #
_CRISIS_EL = (
    "<p>Σταματώ εδώ, γιατί αυτό που περιγράφεις είναι πιο σημαντικό από "
    "οποιαδήποτε συμβουλή για την καριέρα σου.</p>"
    "<p>Δεν είμαι ο κατάλληλος για αυτό — δεν είμαι άνθρωπος και δεν είμαι "
    "ειδικός. Μίλα σε κάποιον που είναι:</p>"
    "<ul>"
    "<li><b>1018</b> — Γραμμή Ζωής (χωρίς χρέωση, 24/7)</li>"
    "<li><b>1056</b> — Γραμμή για παιδιά και εφήβους</li>"
    "<li><b>166</b> — ΕΚΑΒ, για άμεσο κίνδυνο</li>"
    "</ul>"
    "<p>Αν προτιμάς, πες το σε έναν άνθρωπο που εμπιστεύεσαι, σήμερα. "
    "Δεν χρειάζεται να το κρατάς μόνος σου.</p>"
)
_CRISIS_EN = (
    "<p>I'm going to stop here, because what you're describing matters more than "
    "any career advice.</p>"
    "<p>I'm not the right one for this — I'm not a human and I'm not a "
    "professional. Please talk to someone who is:</p>"
    "<ul>"
    "<li><b>1018</b> — Γραμμή Ζωής, the Greek crisis line (free, 24/7)</li>"
    "<li><b>116 123</b> — international emotional support line</li>"
    "<li><b>112</b> — emergency services, if you are in immediate danger</li>"
    "</ul>"
    "<p>If you'd rather, tell someone you trust — today. You don't have to carry "
    "this on your own.</p>"
)

_REFUSAL_EL = {
    "medical": "ιατρικά θέματα",
    "psychological": "ψυχολογική ή ψυχιατρική υποστήριξη",
    "legal": "νομικά θέματα",
    "financial": "οικονομικά, φορολογικά ή επενδυτικά θέματα",
}
_REFUSAL_EN = {
    "medical": "medical questions",
    "psychological": "psychological or psychiatric support",
    "legal": "legal questions",
    "financial": "financial, tax or investment questions",
}
_REDIRECT_EL = (
    "Αυτό για το οποίο μπορώ να σου φανώ χρήσιμος: ηγεσία, διοίκηση ομάδων, "
    "εργασιακή κουλτούρα, καριέρα, Gen Z και πολυγενεακές ομάδες, public "
    "speaking. Ρώτησέ με κάτι από εκεί."
)
_REDIRECT_EN = (
    "Where I can actually be useful: leadership, people management, workplace "
    "culture, careers, Gen Z and multigenerational teams, public speaking. Ask "
    "me something there."
)


def distress_response(lang: str = "el") -> str:
    return _CRISIS_EL if lang == "el" else _CRISIS_EN


def refusal_response(cls: str, lang: str = "el") -> str:
    """A branded refusal: names the boundary, gives no partial answer, redirects.

    Written in his register — direct, no hedging, no apology paragraph. The one
    thing it never does is answer "a little bit," which is the failure mode that
    makes a scope guardrail decorative.
    """
    if lang == "el":
        topic = _REFUSAL_EL.get(cls, "αυτό το θέμα")
        return (
            f"<p>Δεν απαντώ σε {topic}. Δεν είναι θέμα διακριτικότητας — "
            f"απλώς δεν είμαι ο κατάλληλος, και μια μισή απάντηση εδώ κάνει "
            f"περισσότερο κακό από το να μη σου απαντήσω καθόλου.</p>"
            f"<p>Για αυτό θέλεις επαγγελματία του χώρου.</p>"
            f"<p>{_REDIRECT_EL}</p>"
        )
    topic = _REFUSAL_EN.get(cls, "that topic")
    return (
        f"<p>I don't answer {topic}. It's not squeamishness — I'm simply not the "
        f"right source, and half an answer here does more damage than no answer "
        f"at all.</p>"
        f"<p>For that you want a qualified professional.</p>"
        f"<p>{_REDIRECT_EN}</p>"
    )


# --------------------------------------------------------------------------- #
# EU AI Act Art. 50 — disclosure.
#
# Art. 50(1): people must be informed they are interacting with an AI system,
# unless it is obvious. Two surfaces, because a persona bot trading on someone's
# name is precisely the case where "obvious" cannot be assumed:
#   * a persistent banner in the UI (templates/chat.html, widget)
#   * this line, prepended to the FIRST assistant message of a session
# --------------------------------------------------------------------------- #
_DISCLOSURE_EL = (
    "<p><i>Είμαι το Κίτσι, ο ψηφιακός βοηθός του Κωνσταντίνου Κιντζιού — τεχνητή "
    "νοημοσύνη, όχι ο ίδιος. Απαντώ αποκλειστικά με βάση το δημοσιευμένο υλικό "
    "του και παραπέμπω στις πηγές.</i></p>"
)
_DISCLOSURE_EN = (
    "<p><i>I'm Kitsi, Konstantinos Kintzios's digital assistant — an AI, not him. I "
    "answer only from his published material and I cite my sources.</i></p>"
)


def disclosure(lang: str = "el") -> str:
    return _DISCLOSURE_EL if lang == "el" else _DISCLOSURE_EN


def off_topic_response(lang: str = "el") -> str:
    """Neither refusable nor answerable: simply not what this assistant is for.

    Distinct from `no_answer_response`, which means "he hasn't published on this
    in-scope topic." Here the topic itself is outside the assistant's remit, so
    promising to relay it to him would be misleading.
    """
    if lang == "el":
        return (
            "<p>Αυτό είναι έξω από αυτά που καλύπτω. Είμαι εδώ για ηγεσία, "
            "ομάδες, εργασιακή κουλτούρα και καριέρα — όχι για γενικές "
            "ερωτήσεις.</p>"
            f"<p>{_REDIRECT_EL}</p>"
        )
    return (
        "<p>That's outside what I cover. I'm here for leadership, teams, "
        "workplace culture and careers — not general questions.</p>"
        f"<p>{_REDIRECT_EN}</p>"
    )


def no_answer_response(lang: str = "el") -> str:
    """Retrieval came back empty. Never invent; always leave a route forward."""
    if lang == "el":
        return (
            "<p>Δεν έχω κάτι από τον Κωνσταντίνο πάνω σε αυτό, και δεν θα σου "
            "πω δικές μου γενικότητες — δεν θα σε βοηθούσαν.</p>"
            f"<p>{_REDIRECT_EL}</p>"
        )
    return (
        "<p>I don't have anything from Konstantinos on that, and I'm not going "
        "to give you my own generalities — they wouldn't help you.</p>"
        f"<p>{_REDIRECT_EN}</p>"
    )
