"""Citation rendering — REUSED from the BPAN app's `_apply_citations`.

This is provenance *display*, and the BPAN implementation is good: it dedups by
URL so three markers pointing at the same page produce one list entry, retargets
every inline superscript at that entry's canonical anchor, and defensively strips
any "Πηγές:" section the model wrote itself (models do this despite the prompt;
the backend list is the single source of truth).

Extracted from `routers/api.py` into a service module — in BPAN it is a private
function next to the route it serves, but here three routes need it (persona,
pillar navigator, internal search) and duplicating it would guarantee drift.

Changes: bilingual labels rather than Greek-only, brand colour token, and no
`_normalise_url_for_link` local-file branch — Kintzios has no PDF corpus, so
every URL is either an http(s) link or empty. A source with no URL is listed by
title without a link rather than being dropped, which matters for placeholder
pillars and non-cleared transcripts that legitimately have no public page.

Claim verification is a SEPARATE mechanism and lives in `grounding.py`. A
correctly formatted citation pointing at a real page says nothing about whether
the quoted sentence appears there.
"""
from __future__ import annotations

import re

from app.config import is_link_excluded

_ACCENT = "#ff7d00"   # single place to change the citation link colour


def _sources_label(lang: str) -> str:
    return "Πηγές" if lang == "el" else "Sources"


def strip_model_source_list(html: str) -> str:
    """Remove a "Πηγές:"/"Sources:" block the model wrote itself.

    Kept from BPAN, extended to English. Deliberately conservative: it only
    matches a heading immediately followed by lines containing `[N]` markers, so
    a legitimate sentence mentioning the word "sources" survives.
    """
    return re.sub(
        r"(?:<br\s*/?>|<p>|\n){0,3}\s*(?:\*\*|<b>|<strong>)?\s*"
        r"(?:Πηγές|Πηγες|Sources)\s*:?(?:\*\*|</b>|</strong>)?\s*"
        r"(?:<br\s*/?>|<ol>|<ul>|\n)?(?:[^<]*?\[\d+\][^<]*?(?:<br\s*/?>|\n|$))+"
        r"(?:</ol>|</ul>)?",
        "",
        html,
        flags=re.IGNORECASE,
    )


def apply_citations(html: str, docs: list[dict], lang: str = "el") -> str:
    """Turn inline `[N]` markers into footnote links + append the source list.

    Only sources the model actually cited appear in the list. Markers outside
    the valid range are left as literal text rather than silently deleted —
    a visible oddity is easier to notice than a vanished citation.
    """
    if not html or not docs:
        return html

    html = strip_model_source_list(html)

    cited = [int(m) for m in re.findall(r"\[(\d+)\]", html) if 1 <= int(m) <= len(docs)]
    if not cited:
        return html

    # Group markers that point at the same URL; the first marker for a URL is
    # its canonical anchor.
    url_to_ns: dict[str, list[int]] = {}
    canonical: dict[int, int] = {}
    for n in sorted(set(cited)):
        d = docs[n - 1]
        url = (d.get("url") or "").strip().lower() or f"__no_url_{n}__"
        if url not in url_to_ns:
            url_to_ns[url] = []
            canonical[n] = n
        else:
            canonical[n] = url_to_ns[url][0]
        url_to_ns[url].append(n)

    def _repl(m: re.Match) -> str:
        n = int(m.group(1))
        if n not in canonical:
            return m.group(0)
        return (
            f'<sup><a href="#src-{canonical[n]}" '
            f'style="color:{_ACCENT};text-decoration:none;font-weight:600;">'
            f'[{n}]</a></sup>'
        )

    out = re.sub(r"\[(\d+)\]", _repl, html)

    items = []
    for url, ns in sorted(url_to_ns.items(), key=lambda x: x[1][0]):
        first = ns[0]
        d = docs[first - 1]
        title = (d.get("title") or ("πηγή" if lang == "el" else "source")).strip()[:120]
        href = (d.get("url") or "").strip()
        label = ", ".join(str(n) for n in ns)
        if not href or is_link_excluded(href) or is_link_excluded(title):
            items.append(f'<li id="src-{first}">[{label}] {title}</li>')
        else:
            items.append(
                f'<li id="src-{first}">[{label}] '
                f'<a href="{href}" target="_blank" rel="noopener">{title}</a></li>'
            )

    if items:
        out += (
            f'<br><br><b>{_sources_label(lang)}:</b>'
            f'<ol style="padding-left:1.2em;list-style:none;">' + "".join(items) + "</ol>"
        )
    return out


def format_history(history: list[dict], lang: str = "el", n: int = 5) -> str:
    """Render the last n exchanges for the prompt. Bilingual labels."""
    if not history:
        return ""
    q_lbl, a_lbl = ("Ερώτηση", "Απάντηση") if lang == "el" else ("Question", "Answer")
    turn = "Ανταλλαγή" if lang == "el" else "Exchange"
    out = [
        f"{turn} {i}:\n{q_lbl}: {ex.get('question','')}\n{a_lbl}: {ex.get('answer','')}"
        for i, ex in enumerate(history[-n:], 1)
    ]
    return "\n\n".join(out)
