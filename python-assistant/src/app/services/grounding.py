r"""Deterministic quote grounding — no LLM, no API call.

PORTED from `simasia-copilot/backend/app/verify.py` (`_ground_claims`, ~line 245),
not from the BPAN app. Worth being precise about why, because the two are easy to
conflate:

  * BPAN's `_apply_citations()` is a **provenance display** pipeline. It numbers
    retrieved sources, converts the model's `[N]` markers into footnote links,
    dedups by URL, and strips any "Πηγές:" list the model wrote itself. It is
    reused here (see `routers/api.py`) and it is very good at what it does.
  * It does not check whether the model's *quoted text* actually appears in the
    source it cited. That is this module. A citation can be perfectly formatted
    and point at a real page while the sentence in quotation marks was invented.

The rule, from the upstream docstring: the model does not get to grade itself.
The check is deterministic and it is the authority — when a quote isn't found in
the cited source, the quote is downgraded regardless of how confident the answer
sounded.

For Kintzios this is the mechanical half of the product guarantee. §1 of the
persona spec forbids inventing quotes; this module is what makes that a property
of the system rather than a request to the model.

## Two deliberate changes from the upstream implementation

1. **Unicode tokenisation.** Upstream: `re.split(r"[^a-z0-9]+", s.lower())`,
   which is ASCII-only — every Greek character is a separator, so a Greek quote
   tokenises to `[]`, `ev_tokens` is empty, and the claim is silently marked
   "nothing to check". Ported verbatim, the verifier would pass every Greek
   fabrication. That is the whole corpus. Fixed with `\w` under `re.UNICODE`.

2. **Greek accent folding.** «ηγεσία» quoted from a source written «ΗΓΕΣΙΑ», or
   with a final-sigma difference, must still match. Diacritics are stripped and
   final sigma normalised before comparison, so a real quote isn't downgraded on
   orthography.

Threshold stays 0.6, as upstream.
"""
from __future__ import annotations

import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

GROUNDED_THRESHOLD = 0.6
MIN_QUOTE_TOKENS = 2        # see note below

# Quotation styles the model might emit: Greek/French guillemets, curly doubles,
# straight doubles. Single quotes are deliberately excluded — apostrophes in both
# languages produce far too many false positives.
# 2, not 3. The tokenizer drops tokens under 3 chars, so a real 3-word English
# quote like "I provide answers" yields only ['provide','answers'] — at a floor of
# 3 it was skipped as "not a quote", i.e. NOT CHECKED. Under-checking is the
# dangerous direction here: an unchecked quote is an unverified quote. Two content
# tokens is still enough to make a false positive unlikely.
_QUOTE_RE = re.compile(r"«([^»]{8,400})»|“([^”]{8,400})”|\"([^\"]{8,400})\"")

# Marker the LLM uses to attribute a sentence to source N.
_CITE_RE = re.compile(r"\[(\d{1,2})\]")


def _fold(s: str) -> str:
    """Lowercase, strip Greek diacritics, normalise final sigma."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return unicodedata.normalize("NFC", s).replace("ς", "σ")


def tokens(s: str) -> list[str]:
    """Content words, Unicode-aware. Tokens of ≤2 chars are dropped as noise."""
    return [t for t in re.split(r"\W+", _fold(s), flags=re.UNICODE) if len(t) > 2]


def _strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "")


def check_quotes(answer_html: str, docs: list[dict]) -> dict:
    """Verify every quoted span in the answer against the retrieved sources.

    Returns::

        {
          "checked":   int,    # quotes examined
          "grounded":  int,    # quotes found in a source
          "ungrounded": [ {quote, frac, cited} ],
          "ok":        bool,   # no ungrounded quotes
        }

    Scoring: a quote's content-word overlap is measured against the pool of the
    sources cited in its vicinity, falling back to ALL retrieved sources when no
    marker is nearby. The fallback is deliberately generous — the aim is to catch
    invention, not to punish a misplaced marker, and a quote present in some
    retrieved source is not a fabrication.
    """
    text = _strip_tags(answer_html)
    all_pool = set()
    per_doc = []
    for d in docs:
        t = set(tokens(d.get("content", "")))
        per_doc.append(t)
        all_pool |= t

    result = {"checked": 0, "grounded": 0, "ungrounded": [], "ok": True}
    if not per_doc:
        return result

    for m in _QUOTE_RE.finditer(text):
        quote = next(g for g in m.groups() if g is not None).strip()
        qt = tokens(quote)
        if len(qt) < MIN_QUOTE_TOKENS:
            continue

        # Which sources were cited near this quote? Look ahead a short window;
        # the convention is the marker follows the sentence.
        window = text[m.end(): m.end() + 60]
        cited = [int(n) for n in _CITE_RE.findall(window)]
        pool = set()
        for n in cited:
            if 1 <= n <= len(per_doc):
                pool |= per_doc[n - 1]
        if not pool:
            pool = all_pool

        hits = sum(1 for t in qt if t in pool)
        frac = hits / len(qt)
        result["checked"] += 1
        if frac >= GROUNDED_THRESHOLD:
            result["grounded"] += 1
        else:
            result["ok"] = False
            result["ungrounded"].append(
                {"quote": quote[:160], "frac": round(frac, 2), "cited": cited}
            )
            logger.warning(
                "Ungrounded quote (overlap %.2f, cited %s): %r", frac, cited, quote[:80]
            )
    return result


def redact_ungrounded(answer_html: str, report: dict, lang: str = "el") -> str:
    """Remove ungrounded quotes from the answer before the user sees it.

    The downgrade is a removal, not a warning label. A hedged fabricated quote
    still reads as something he said, and screenshots travel — so it does not
    ship. The sentence around it survives; only the quotation marks and their
    contents are replaced with a short in-language note.
    """
    if report.get("ok", True):
        return answer_html
    note = (
        "[απόσπασμα αφαιρέθηκε: δεν επιβεβαιώθηκε στις πηγές]"
        if lang == "el"
        else "[quote removed: not verified against the sources]"
    )
    out = answer_html
    for item in report.get("ungrounded", []):
        q = item["quote"]
        for opener, closer in (("«", "»"), ("“", "”"), ('"', '"')):
            out = out.replace(f"{opener}{q}{closer}", f"<i>{note}</i>")
        # Long quotes are truncated to 160 chars in the report; fall back to a
        # prefix match so the removal still lands.
        if q in out:
            out = out.replace(q, note)
    return out
