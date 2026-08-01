# Handover — Python assistant (`python-assistant/`)

A second, independent implementation of the Kintzios assistant, in Python/FastAPI.
It does **not** replace `apps/api` — see "Relationship to the existing bot" below.

Run it:

```bash
cd python-assistant
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add GEMINI_API_KEY
python manage.py ingest
python manage.py serve        # http://localhost:8020
python -m pytest              # 133 tests, no key or network needed
```

## Relationship to the existing bot

| | `apps/api` (existing) | `python-assistant/` (this) |
|---|---|---|
| Stack | Fastify + React, PGlite/pgvector | FastAPI + TF-IDF/FAISS |
| Retrieval | Gemini embeddings | hybrid; **works keyless** via TF-IDF |
| Guardrails | — | 4 refusal classes + distress escalation |
| Rights/speaker gating | — | enforced, tested both directions |
| Quote verification | — | deterministic, ungrounded quotes removed |
| Lead capture | — | 4 flows, consent-gated |
| GDPR | — | retention + erasure endpoint |
| Tests | — | 113, offline |

The two overlap on retrieval and chat. What is genuinely new here is the
**compliance and attribution layer**; that is the part worth porting if the Node
app stays the primary. See `ARCHITECTURE_NOTES.md` for per-module reasoning.

## What it does

1. **Digital Kintzios (Kitsi)** — answers only from his published material, with
   `[N]` citations, in GR or EN with no translation step.
2. **Keynote-pillar navigator** — his site advertises ~50 thematic pillars and
   lists none. Describe a problem, get matching pillars. *Lead the demo with this.*
3. **Lead qualification** — 4 flows (keynote / workshop / mentoring / Notify Show
   guest), taken from his own contact form. Never quotes a price.
4. **Internal transcript search** — team-only, over the full index including
   material not cleared for publication.

## Three guarantees, and where they live

| Guarantee | Enforced in | Tested in |
|---|---|---|
| He said it — not a guest, not the model | `public_filter` in `services/indexing.py`; one-speaker-per-chunk in `ingest/transcripts.py` | `test_rights.py`, `test_chunker.py` |
| Every quote is real | `services/grounding.py` (≥0.6 token overlap; ungrounded quotes **deleted**) | `test_guardrails.py` |
| Restricted material never goes public | same filter, asserted both directions | `test_rights.py` |

Mutation-tested: breaking the rights filter, the AI-Act disclosure, the consent
gate, or the speaker cast each makes the suite fail.

## Read these before changing anything

* `ARCHITECTURE_NOTES.md` — reuse/adapt/port/new per module; the five wrong
  premises in the original brief; the measured retrieval calibration.
* `corpus/README.md` — the frontmatter contract, and what Kintzios still must
  supply.
* `persona/README.md` — why the GR and EN prompts are written natively rather
  than translated.
* `DEMO_SCRIPT.md` — 12-minute client demo, from captured outputs.

## Traps

1. **`ingest/transcripts.py` is the highest-risk module.** A chunk spanning a
   speaker turn still passes the speaker filter and produces a correct-looking
   citation — attributing a guest's words to him, with nothing raising. Its two
   regression tests are load-bearing.
2. **Gemini safety is `BLOCK_ONLY_HIGH`, deliberately.** The upstream BPAN app
   uses `BLOCK_NONE` (defensible there — clinically reviewed safety layer). Do
   not inherit it: this is unscreened traffic under his name.
3. **Admin auth fails closed** — unconfigured returns 503, not open access.
4. **Model ids get retired.** Set `GEMINI_MODELS` in `.env`; run
   `python manage.py models` to list what your key can actually use.
5. **Never hardcode a crisis number in the persona prompts** — the backend injects
   it (Γραμμή Ζωής 1018).

## Not done

* **Generation is untested end-to-end** — no key was available during the build.
  Retrieval, guardrails, grounding, leads and erasure are verified keyless; the
  persona *voice* has never been read. Do this first.
* **The corpus is 90% website copy** — 12 of 158 chunks are pillar placeholders,
  2 transcripts are fixtures.
* **His privacy notice cannot cover this app** (`ARCHITECTURE_NOTES.md` §8).
* **`google.generativeai` is deprecated** — migrate to `google.genai`.
* **Relevance floors are tuned on 158 chunks** — re-measure on the real corpus.
