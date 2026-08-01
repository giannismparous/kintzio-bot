"""Persona prompt assembly + language detection.

Adapted from the BPAN app's `routers/api.py`, where the system prompt is a
module-level string constant and the language directive is bracketed around it.
Two changes:

  * The prompt lives in `persona/*.md`, not in Python. A non-developer must be
    able to tune Kintzios's voice without touching a router, and the two
    language variants must be diffable side by side.
  * `_detect_lang_code` is reused conceptually but tightened — BPAN counts Greek
    vs Latin characters over the whole string, which misfires on Greek questions
    full of English loanwords ("έχω πρόβλημα με το onboarding του manager"),
    a routine phrasing in this domain. See `detect_lang`.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path

from app.config import DEFAULT_LANG, ORG_FACTS, PERSONA_DIR

logger = logging.getLogger(__name__)

_GREEK = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]")
_LATIN = re.compile(r"[A-Za-z]")


def detect_lang(text: str) -> str:
    """Return 'el' or 'en'.

    Greek script is a positive signal that survives loanwords: Greek
    professionals write "θέλω feedback από τον manager μου", which is a Greek
    question. So ANY meaningful Greek presence wins, rather than a raw majority
    count of Greek vs Latin characters (the BPAN rule, which would call that
    sentence English).

    The threshold is a small fraction rather than a single character so that one
    stray Greek letter in an English sentence doesn't flip it.
    """
    if not text or not text.strip():
        return DEFAULT_LANG
    g = len(_GREEK.findall(text))
    l = len(_LATIN.findall(text))
    if g == 0:
        return "en" if l else DEFAULT_LANG
    # ≥15% Greek letters, or Greek outright dominant → Greek.
    return "el" if (g / max(g + l, 1)) >= 0.15 else "en"


def language_directive(lang: str) -> str:
    """The instruction bracketed on both sides of the prompt.

    Kept from BPAN, including the both-sides placement: with a long system
    prompt plus a long retrieved-context block, a single directive at the top
    gets diluted and the model occasionally answers in the corpus's language
    rather than the user's. Repeating it after the context is cheap insurance.
    """
    if lang == "el":
        return (
            "ΓΛΩΣΣΑ ΑΠΑΝΤΗΣΗΣ: Ελληνικά. Απάντησε αποκλειστικά στα ελληνικά, "
            "ακόμη κι αν οι πηγές είναι στα αγγλικά. Μη μεταφράζεις αυτολεξεί "
            "αποσπάσματα σε εισαγωγικά."
        )
    return (
        "RESPONSE LANGUAGE: English. Answer exclusively in English, even if the "
        "sources are in Greek. Do not translate verbatim quoted excerpts."
    )


@lru_cache(maxsize=4)
def load_persona(lang: str) -> str:
    """Read persona/system_prompt_<lang>.md from disk (cached).

    Missing file is a deployment error, not something to paper over with a
    generic fallback prompt: an unstyled assistant answering in his name is
    worse than an outage. Raises.
    """
    lang = lang if lang in ("el", "en") else DEFAULT_LANG
    path = Path(PERSONA_DIR) / f"system_prompt_{lang}.md"
    if not path.exists():
        raise FileNotFoundError(
            f"Persona spec missing: {path}. The app cannot answer in {lang} "
            f"without it."
        )
    return path.read_text(encoding="utf-8").strip()


def clear_cache() -> None:
    """Drop the cached prompts — used by tests and by the reload hook."""
    load_persona.cache_clear()


def format_sources(docs: list[dict], lang: str, budget_chars: int = 9000) -> str:
    """Render retrieved chunks as numbered citation sources.

    Same contract as BPAN's `_format_retrieved`: numbered blocks the model
    references as `[N]`, with the per-source budget divided evenly so one long
    chunk can't crowd out the rest. Kintzios additions: the speaker and episode
    are shown, so the model can attribute naturally ("in the Gen Z episode"),
    and `lang` is shown so it knows when an excerpt is in the other language and
    must not be translated inside quotation marks.
    """
    if not docs:
        return "(δεν βρέθηκαν σχετικές πηγές)" if lang == "el" else "(no relevant sources found)"

    header = "=== ΠΗΓΗ" if lang == "el" else "=== SOURCE"
    per_doc = max(400, budget_chars // max(len(docs), 1))
    parts = []
    for i, d in enumerate(docs, 1):
        bits = [f"{header} [{i}] ==="]
        if d.get("title"):
            bits.append(f"TITLE: {d['title']}")
        if d.get("speaker"):
            bits.append(f"SPEAKER: {d['speaker']}")
        if d.get("episode"):
            ts = f" @ {d['timestamp']}" if d.get("timestamp") else ""
            bits.append(f"EPISODE: {d['episode']}{ts}")
        if d.get("source_type"):
            bits.append(f"TYPE: {d['source_type']}")
        bits.append(f"LANG: {d.get('lang', '?')}")
        if d.get("url"):
            bits.append(f"URL: {d['url']}")
        bits.append((d.get("content") or "").strip()[:per_doc])
        parts.append("\n".join(bits))
    return "\n\n".join(parts)


def build_prompt(question: str, docs: list[dict], lang: str, history: str = "") -> str:
    """Assemble the full prompt: directive · persona · facts · sources · question · directive.

    The bracketing directive and the every-turn re-injection of the persona and
    the fact block are both inherited from BPAN. The fact block (CAG) is
    unconditional so identity and contact questions work even when retrieval
    returns nothing.
    """
    directive = language_directive(lang)
    persona = load_persona(lang)
    facts_hdr = (
        "=== ΣΤΑΘΕΡΑ ΣΤΟΙΧΕΙΑ (πάντα διαθέσιμα, δεν χρειάζονται παραπομπή) ==="
        if lang == "el"
        else "=== STANDING FACTS (always available, no citation needed) ==="
    )
    q_hdr = "=== ΕΡΩΤΗΣΗ ΧΡΗΣΤΗ ===" if lang == "el" else "=== USER QUESTION ==="
    h_hdr = "=== ΠΡΟΗΓΟΥΜΕΝΗ ΣΥΖΗΤΗΣΗ ===" if lang == "el" else "=== CONVERSATION SO FAR ==="

    blocks = [directive, persona, f"{facts_hdr}\n{ORG_FACTS}"]
    if history:
        blocks.append(f"{h_hdr}\n{history}")
    blocks += [
        format_sources(docs, lang),
        f"{q_hdr}\n{question}",
        scope_instruction(lang),
        directive,
    ]
    return "\n\n".join(blocks)


# Scope is a JUDGEMENT, not a keyword match.
#
# This replaced a regex vocabulary list that refused "how to lead?" while
# answering "how do I lead a team?" — the shortest and most central question a
# leadership coach can be asked was the one it got wrong, because `\blead\b`
# happened not to fire on it. Enumerating the vocabulary of an entire domain in
# a pattern list is a losing game: the list is always missing the phrasing a
# real person just used, and every miss is a refusal in his name.
#
# The model reads the question and the retrieved sources and decides. It is
# told to lean IN: his domain is broad and adjacent questions (motivation,
# hiring, feedback, burnout, career change) are his territory, not edge cases.
# Only a genuinely unrelated question gets the sentinel.
#
# What stays deterministic, and why:
#   * distress   — must work when the model is down, and a missed distress
#                  signal is the worst failure this app has
#   * price      — a fabricated number becomes an anchor he argues down later
#   * rights     — retrieval filtering is a legal boundary, not a judgement
# Those three are safety and commercial invariants. Topic is neither.
_SCOPE_EL = """=== ΚΡΙΣΗ ΣΥΝΑΦΕΙΑΣ ===
Πριν απαντήσεις, κρίνε αν η ερώτηση αφορά τον τομέα του Κωνσταντίνου:
ηγεσία, διοίκηση ανθρώπων, ομάδες, εταιρική κουλτούρα, καριέρα, Gen Z και
πολυγενεακές ομάδες, δημόσιος λόγος, προσωπική εξέλιξη στη δουλειά.

Να είσαι ΓΕΝΝΑΙΟΔΩΡΟΣ. Ο τομέας του είναι ευρύς. Ερωτήσεις για κίνητρα,
προσλήψεις, feedback, εξουθένωση, αλλαγή καριέρας, συγκρούσεις, εμπιστοσύνη
ή χαρακτήρα ΕΙΝΑΙ μέσα στον τομέα. Μια σύντομη ή γενική ερώτηση («πώς να
ηγηθώ;») είναι απολύτως μέσα στον τομέα — απάντησέ την.

ΜΟΝΟ αν η ερώτηση είναι πραγματικά άσχετη (καιρός, αθλητικά, μαγειρική,
γεωγραφία, κώδικας, γενικές γνώσεις), απάντησε ΑΚΡΙΒΩΣ με τη λέξη:
[OUT_OF_SCOPE]
και τίποτε άλλο."""

_SCOPE_EN = """=== RELEVANCE JUDGEMENT ===
Before answering, judge whether the question falls in Konstantinos's domain:
leadership, people management, teams, workplace culture, careers, Gen Z and
multigenerational teams, public speaking, professional growth.

Be GENEROUS. His domain is broad. Questions about motivation, hiring,
feedback, burnout, career change, conflict, trust or character ARE in scope.
A short or general question ("how to lead?") is squarely in scope — answer it.

ONLY if the question is genuinely unrelated (weather, sports, cooking,
geography, code, general knowledge) reply with EXACTLY the token:
[OUT_OF_SCOPE]
and nothing else."""

OUT_OF_SCOPE_TOKEN = "[OUT_OF_SCOPE]"


def scope_instruction(lang: str) -> str:
    return _SCOPE_EL if lang == "el" else _SCOPE_EN
