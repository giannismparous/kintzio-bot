# ARCHITECTURE_NOTES

Reuse / adapt / port / new decisions for the Kintzios assistant, with the reason
for each. Written against what is actually in `~/Dropbox/BPAN`, not against the
build brief — five of the brief's premises were wrong, and §9 lists them.

---

## 1. What the reference apps actually are

The brief assumed two sibling directories, `bpan/` and `chios-forum/`. The real
layout:

| Assumed | Actual |
|---|---|
| `bpan/` | **the repo root itself** — `~/Dropbox/BPAN/src/app/` |
| `chios-forum/` | `~/Dropbox/BPAN/chios-forum-app/` |

`chios-forum-app` is a fork of the root app. `diff -rq` returns **9 differing
files**, one added router (`routers/forum.py`), and one added directory
(`static/`). Everything else is byte-identical. That fork is the precedent this
app follows, and `chios-forum-app/BUILD_PROMPT.md` states the house pattern in
its own words: *"Do not build from scratch. Clone the existing BPAN Companion app
and re-skin it."*

## 2. Verdict per module

| Module | Verdict | Note |
|---|---|---|
| `services/indexing.py` | **adapt** | TF-IDF + FAISS hybrid kept; added `lang`/`speaker`/`rights_cleared` metadata, a `predicate` argument on both search legs, `stats()`, and a bilingual term table replacing BPAN's Greek welfare-acronym gloss |
| `services/llm_manager.py` | **copy + one critical change** | Gemini key rotation and model fallback kept verbatim; `BLOCK_NONE` → `BLOCK_ONLY_HIGH` (§6) and the Κάπα3 crisis fallback strings re-skinned |
| `services/citations.py` | **reuse** | BPAN's `_apply_citations` extracted from `routers/api.py` into a service — three routes need it and duplicating it would guarantee drift |
| `services/guardrails.py` | **adapt** | from `triage_service.py`; deterministic-first instead of LLM-first, distress checked before scope, off-topic gate added |
| `services/grounding.py` | **port** | `_ground_claims()` from `simasia-copilot/backend/app/verify.py:245` — **not** from BPAN (§9.1) |
| `services/persona.py` | **new** | bilingual prompt assembly; `detect_lang` tightened vs BPAN's majority-count rule |
| `security.py` | **rewrite** | BPAN returns `"anonymous"` when unconfigured; this fails closed (§7) |
| `models.py` | **rewrite** | clinical tables dropped; `Lead` + `UnansweredQuestion` added |
| `routers/leads.py` | **new** | no analogue in either app |
| `ingest/transcripts.py` | **new** | the speaker-attribution chunker (§4) |
| `templates/chat.html` | **re-skin** | from `ms_support.html`, 25 KB → 9.7 KB |
| `static/kintzios-widget.js` | **re-skin** | from `chios-widget.js`; dropped speech input, image lightbox, and streaming (§5) |
| voice / OCR / PDF / story / file-upload modules | **dropped** | 8 modules, no analogue in this product |

Roughly 4,470 of ~5,550 LOC is copy-or-re-skin; ~1,050 is new; one ~30-line port.

## 3. The rights and attribution gate

This is the design centre. The persona claim is "he actually said this," and the
only thing making that true is a filter with two conditions:

```python
public_filter  = rights_cleared is True AND speaker == PERSONA_SPEAKER
```

Defined **once**, in `services/indexing.py`. Two copies of this predicate will
diverge and the resulting failure is silent.

Three supporting rules:

1. **A missing `rights_cleared` flag reads as NOT cleared.** Fail closed.
   (`tests/test_rights.py::test_missing_rights_flag_defaults_to_not_cleared`)
2. **A chunk never spans two speakers** (§4).
3. **The internal route is the mirror image** — no rights filter, no speaker
   filter, HTTP Basic required. Both directions are asserted, because a
   one-directional test passes trivially when retrieval is simply broken.

## 4. `ingest/transcripts.py` — the highest-risk module

The failure mode is silent. A chunk that spans a turn boundary still carries a
single speaker label, still passes the filter, still produces a correct-looking
citation — and attributes a guest's opinion to him. Nothing errors.

The bare `Speaker:` header form is resolved **against the file's declared
`speakers:` frontmatter**, never guessed from shape. An earlier version used a
permissive label pattern, and it matched ordinary dialogue: `Το θέμα είναι: δεν
ρωτάμε` parsed as a speaker named *"Το θέμα είναι"*. That is the exact
fabrication this module exists to prevent, and it is now a regression test
(`test_dialogue_colon_is_not_a_turn_header`).

Sub-40-character turns ("Ναι.", "Σωστά.") are dropped as retrieval noise — a
decision on record, not an accident.

## 5. Why the widget does not stream

BPAN and Chios both stream tokens. This one returns one payload, because the
answer must pass deterministic quote verification **in full** before any of it is
displayed. A fabricated quote that has already appeared on screen cannot be
retracted, and screenshots travel.

For the same reason `redact_ungrounded` **removes** an unverified quote rather
than labelling it. A hedged fabricated quote still reads as something he said.

## 6. Gemini safety settings — do not inherit

BPAN sets all four harm categories to `BLOCK_NONE`. That is defensible there and
documented in its own comment: a patient-support app discussing cancer and
suicide risk keeps tripping `PROHIBITED_CONTENT`, and BPAN wraps the model in a
clinically reviewed safety layer.

None of it transfers. The corpus is business content, so filters-off buys
nothing; the audience is unscreened web traffic; and the reputational asymmetry
is total — one screenshot of this bot saying something abusive under his name
outweighs every good answer. `BLOCK_ONLY_HIGH` is set **explicitly** so the
choice is visible in review and cannot be mistaken for an oversight.

## 7. Admin auth fails closed

BPAN's `require_internal_user` returns `"anonymous"` when `INTERNAL_USER` is
unset — auth silently disables itself. Acceptable for an anonymous FAQ dashboard;
not for a table of named leads with phone numbers.

Unconfigured → **503**, not open access. `ALLOW_INSECURE_ADMIN=1` is a loudly
logged dev escape hatch. Note the test-suite trap this created: a session-scoped
fixture that set the credentials globally leaked them, and the four fail-closed
tests passed in isolation while failing in a full run — the worst failure mode
for a security test, since the passing version tests nothing. Now done with
`dependency_overrides`.

## 8. GDPR — and the site notice must change

New work in full; BPAN has only a two-boolean consent row.

* Consent is a **precondition**: no consent → 400, no row. Art. 7(1) requires
  demonstrable consent, and refusing to store is the only way that stays true.
* `expires_at` is **stamped at insert** from `LEAD_RETENTION_DAYS` (default 180),
  so changing the config later cannot retroactively extend the retention of data
  already collected.
* `DELETE /api/leads/erase` is **unauthenticated by design** — requiring a login
  to exercise a data right defeats the right. It returns a count only, never
  confirming whether an address was present, so it cannot be used as an
  address-checking oracle.
* The purge runs before every admin list, so stale data cannot be displayed even
  with no scheduled job configured.

> **Action for the client, before launch.** His current privacy notice
> (`/en/privacy-policy/`) covers form-based contact only, states comments are
> retained *indefinitely*, and does not mention AI processing, conversation
> logging or a retention period. It cannot be linked from an AI assistant that
> stores leads. `/privacy-policy` in this app documents the actual processing as
> an interim measure; the site notice needs a lawyer's update.

## 9. Five premises in the build brief that were wrong

1. **"The deterministic quote-grounding verification leg from the BPAN app"** —
   not in BPAN. It is in `simasia-copilot/backend/app/verify.py:245`, so this is
   a port across projects. Its tokenizer is also **ASCII-only**
   (`re.split(r"[^a-z0-9]+", ...)`): ported verbatim, every Greek quote tokenises
   to `[]` and every Greek fabrication passes unchecked. That is the entire
   corpus. Fixed with `\w` under `re.UNICODE` plus accent and final-sigma folding.
2. **"Gemini primary, OpenRouter fallback"** — there is no OpenRouter fallback
   anywhere. The string survives in three stale comments; every public method in
   `llm_manager.py` is Gemini-only. Dropped rather than pretended.
3. **"Prompt caching enabled where supported"** — not implemented in either app.
   The only cache is a disk cache of embedding vectors.
4. **"Reuse the consent pattern"** — BPAN's consent surface is two booleans on a
   session row. No contact record, no retention clock, no erasure. All new work.
5. **"Basic tests"** — there are no tests in either app to imitate.

Two further corrections to the brief's scope: **four** lead flows, not three (his
own contact form already names Business Consulting · Keynote · Mentoring ·
Notify Show collaboration · Other), and chunks carry a **`lang` field**, which
BPAN's metadata lacks entirely.

## 10. Ports

| App | Port |
|---|---|
| BPAN | 8002 |
| Chios Forum | 8010 |
| **Kintzios** | **8020** |

## 11. Known limits

* **Test isolation was broken and is now asserted.** `app/db.py` binds its engine
  at import, so setting `DB_URL` in a fixture was too late — the suite wrote 6
  fixture leads and 93 sessions into `src/kintzios.db` before this was caught.
  `DB_URL` is now set at conftest import, and `pytest_sessionfinish` asserts the
  app is bound to the temp DB.
* **Generation is untested end-to-end** — no `GEMINI_API_KEY` was available.
  Retrieval, guardrails, grounding, leads and erasure are all verified keyless;
  the persona *voice* has not been observed. First task with a key: run
  `DEMO_SCRIPT.md` end to end and read the answers against `persona/README.md`.
* **The corpus is 90% website copy.** 12 of 158 chunks are pillar placeholders and
  2 transcripts are fixtures. The assistant is only as good as what he supplies —
  see `corpus/README.md` for the priority-ordered asks.
* **The off-topic gate is heuristic** (vocabulary + retrieval score). It will
  misfire on unusual phrasing; `/api/internal/unanswered` is where that shows up.
* **`MIN_RELEVANCE` and `STRONG_RELEVANCE` are measured on 158 chunks**, over 10
  on-topic and 8 off-topic probes (`tests/test_relevance.py`):

  | | min | p25 | median | max |
  |---|---|---|---|---|
  | on-topic | 0.060 | 0.097 | 0.152 | 0.325 |
  | off-topic | 0.068 | — | 0.098 | 0.200 |

  The distributions **overlap almost completely** — off-topic max exceeds
  on-topic median. No score cut separates topic from non-topic on this corpus,
  which is why the off-topic gate is vocabulary-first with the score as a weak
  corroborator only. Both numbers need re-measuring when the real corpus lands.
* **The in-scope vocabulary list is incomplete by nature.** Two real on-topic
  questions ("what makes a good leader"; «οι νέοι μας φεύγουν στον πρώτο χρόνο»)
  were being refused as off-topic until the test suite caught them. Watch
  `/api/internal/unanswered` for more.
