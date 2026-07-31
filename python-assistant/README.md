# DialogosAI — Kintzios

Bilingual (GR/EN) RAG-grounded assistant for Konstantinos Kintzios: business
mentor, leadership coach, public speaker, host of «Θα Σας Ειδοποιήσουμε».

Four capabilities:

1. **Digital Kintzios** — answers only from his published material, with
   citations, and with every quote verified against the source before display.
2. **Keynote-pillar navigator** — his site promises ~50 thematic pillars and
   lists none of them. Describe a business problem, get the matching pillars.
3. **Lead qualification** — four flows, no prices ever quoted, GDPR-clean.
4. **Internal transcript search** — team-only, over the full index including
   material not cleared for publication.

Built by re-skinning the BPAN Companion app; see `ARCHITECTURE_NOTES.md` for the
reuse/adapt/port/new decision behind every module.

---

## Run it

```bash
cd kintzios
pip install -r requirements.txt
cp .env.example .env          # then edit
python manage.py ingest       # build the index over corpus/
python manage.py serve        # http://localhost:8020
```

`GEMINI_API_KEY` is **optional for development**. Without it the app boots,
indexes, retrieves, applies guardrails, captures leads and honours erasure — only
generation is unavailable, and `/api/ask` says so explicitly instead of faking an
answer. The entire test suite runs in that state.

To enable the admin surface, set `INTERNAL_USER` and `INTERNAL_PASSWORD`. Without
them `/admin` and `/api/internal/*` return **503** (fail closed, by design).

## Test

```bash
python -m pytest          # 107 tests, no network, no API key
```

## Layout

```
kintzios/
├── manage.py                  # ingest | crawl | serve
├── corpus/
│   ├── site/                  # 17 pages from the kkintzios.com crawl
│   ├── pillars/               # 12 keynote-pillar files (PLACEHOLDER)
│   ├── transcripts/           # 2 fixtures — real episodes go here
│   └── README.md              # frontmatter contract + what he must supply
├── persona/
│   ├── system_prompt_el.md    # written natively, not translated
│   ├── system_prompt_en.md
│   └── README.md              # why the two files are not translations
├── ingest/
│   ├── crawl.py               # refresh corpus/site from the live site
│   ├── documents.py           # frontmatter + document chunking
│   └── transcripts.py         # speaker-turn chunker (highest-risk module)
├── src/app/
│   ├── routers/               # api · leads · internal · web
│   ├── services/              # indexing · persona · grounding · guardrails
│   │                          #   citations · llm_manager
│   ├── templates/             # chat · privacy · admin · widget_demo
│   └── static/kintzios-widget.js
├── tests/                     # 107 tests, all offline
├── ARCHITECTURE_NOTES.md
└── DEMO_SCRIPT.md
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ask` | — | persona Q&A with citations |
| POST | `/api/pillars/match` | — | problem → keynote pillars |
| GET | `/api/leads/flows` | — | the four qualification flows |
| POST | `/api/leads/capture` | — | store a lead (consent required) |
| DELETE | `/api/leads/erase` | — | GDPR Art. 17, by email |
| GET | `/api/health` | — | index counts |
| GET | `/api/leads/admin/list` | basic | leads + fit scores |
| GET | `/api/internal/search` | basic | full index, incl. non-cleared |
| GET | `/api/internal/unanswered` | basic | content-pipeline signal |
| GET | `/api/internal/stats` | basic | index + funnel |
| GET | `/` · `/privacy-policy` · `/widget-demo` | — | pages |
| GET | `/admin` | basic | dashboard |

## Embedding on kkintzios.com

```html
<script src="https://YOUR-DEPLOY-URL/static/kintzios-widget.js" defer></script>
```

Inline instead of a bubble:

```html
<div id="kintzios-assistant"></div>
<script>window.KINTZIOS_WIDGET_CONFIG = { mode: "inline", mount: "#kintzios-assistant" };</script>
<script src="https://YOUR-DEPLOY-URL/static/kintzios-widget.js" defer></script>
```

Set `CORS_ORIGINS=https://kkintzios.com` in `.env` first. See `/widget-demo`.

## The three guarantees, and where they are enforced

| Guarantee | Enforced by | Tested by |
|---|---|---|
| He said it — not a guest, not the model | `public_filter` in `services/indexing.py`; one-speaker-per-chunk in `ingest/transcripts.py` | `test_rights.py`, `test_chunker.py` |
| Every quote is real | `services/grounding.py`, ≥0.6 token overlap, ungrounded quotes **removed** | `test_guardrails.py` |
| Rights-restricted material never goes public | the same filter, asserted in both directions | `test_rights.py` |

Mutation-tested: breaking the rights filter, the disclosure, the consent gate or
the speaker cast each makes the suite fail.

## Before launch

1. **Corpus** — the real ~50 pillar titles, podcast transcripts with speaker
   labels and per-episode rights clearance. See `corpus/README.md`.
2. **Privacy notice** — his site notice cannot cover this app (see
   `ARCHITECTURE_NOTES.md` §8). Needs a lawyer's update.
3. **Read the answers** — with a key set, run `DEMO_SCRIPT.md` and check the
   voice against `persona/README.md` before showing anyone.
4. **Retune the relevance floors** once the real corpus is in (§11).
5. Tell him about the placeholder modal ("Hey you revealed the modal!" + Lorem
   Ipsum) still live on several kkintzios.com pages.
