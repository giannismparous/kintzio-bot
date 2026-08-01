# Making Kitsi τούμπανο — ranked ideas

Ordered by (client wow × business value) ÷ effort. Every idea is checked against
what the code and corpus can actually support today.

---

## 0. First, the thing that is currently broken

**The pillar navigator returns wrong answers with near-zero confidence.**

Measured on the live index:

| problem | top match | score |
|---|---|---|
| «Οι νέοι μας φεύγουν στον πρώτο χρόνο» | `servant-leadership` | 0.060 |
| "our managers are burning out" | `gen-z-bridge` | 0.098 |

Burnout is not a Gen-Z-bridge question. All **12 of 12** pillar files are
`placeholder: true`, so the navigator is matching against text I invented, not
his. This is a content problem, not a code problem, and no feature below fixes
it. Get the real ~50 pillar titles and one-paragraph descriptions first.

---

## 1. Audio-grounded answers — his real voice, no cloning ⭐ THE one

When Kitsi answers, don't just cite *episode 137 at 12:04*. **Play the 20 seconds
of him actually saying it.**

Why this is the strongest idea in the list:

* **It is unfakeable.** The whole app is built to guarantee "he actually said
  this." Audio makes that guarantee *audible* — the visitor hears the proof
  rather than trusting a footnote.
* **It sidesteps voice cloning entirely.** No TTS, no deepfake, no Article 50(2)
  synthetic-audio marking problem, no "is this really him" ambiguity. It is a
  quotation, not a generation.
* **It is already 90% built.** The chunker keeps `[mm:ss]` timestamps and one
  speaker per chunk. The verifier already proves the quote is real. What is
  missing is an audio offset and a player.
* **Demo moment:** ask a question, get an answer, click a citation, hear his
  voice. That lands harder than any amount of fluent prose.

Effort: medium. Needs episode audio URLs + the timestamp mapping the chunker
already produces. Rights: same podcast clearance already required.

---

## 2. Live keynote mode

He does 500+ keynotes. Put a QR code on his closing slide.

* Audience scans → asks the questions they didn't raise their hand for.
* He gets a **live dashboard**: what this room is actually worried about,
  clustered, ranked, in real time.
* After the talk, every attendee keeps a working assistant — and every question
  is a lead signal.

No competitor does this, because no competitor's client is on stage 500 times a
year. It converts his single biggest activity into a data asset and a lead
funnel. This is the wedge that makes the product *his*, not generic.

Effort: low-medium. The chat already exists; this is a per-event session tag, a
clustering view, and a QR link.

---

## 3. "How his thinking evolved" — only possible with 400 episodes

Ask: *"Has his view on remote work changed?"* Kitsi retrieves his 2021 take and
his 2026 take and **shows the shift, with both timestamps.**

* Intellectually impressive in a way a FAQ bot can never be.
* Genuinely useful to him — he has said 400 episodes' worth of things and cannot
  remember all of it.
* Neuro-symbolic in the real sense: detect *contradiction or divergence* between
  two grounded chunks, don't ask the model to opine.
* Editorial gold: "I changed my mind about X" is a keynote and a LinkedIn post.

Effort: medium. Needs episode dates as chunk metadata (trivial) plus a
divergence check over same-topic chunks across time.

---

## 4. Corpus-gap report — what justifies the retainer

Every unanswered question is logged to `UnansweredQuestion`, and
`routers/internal.py` already groups and counts them for the admin dashboard.
**What is missing is not storage or display — it is delivery.** Nobody logs in
to a dashboard weekly.

Weekly or monthly email to him: *"31 people asked about succession planning. You
have nothing published on it."*

* Turns the bot from a cost into an instrument that tells him what to write,
  record, and speak about next.
* The single best argument for a monthly fee, because the value compounds and
  arrives on a schedule.
* Effort: **low.** The data is being collected right now.

---

## 5. Self-service fit check — his own rubric, pointed outward

He publishes a "DO NOT REACH OUT IF…" list. Today `score_fit()` applies it
privately, admin-only.

Flip it: let the prospect check themselves *before* the form. "Answer four
questions and I'll tell you honestly whether you should book him."

* Perfectly on-brand for someone whose homepage says *I don't present theories.
  I provide answers.* He already filters publicly; this just makes it
  interactive.
* Saves him the meetings he would have declined anyway.
* Memorable: a bot that talks you *out* of a booking is a bot people tell others
  about.

Effort: low — the scoring function exists. Needs careful copy so it reads as
honest rather than rude.

---

## 6. Talk-prep brief generator (internal, for him)

Client sends a brief → Kitsi assembles a fireside outline from his most relevant
real takes, with episode timestamps he can re-listen to on the flight.

Saves hours per engagement, ×500 engagements. Invisible to the public, high
value to him. Internal search already does the retrieval.

---

## 7. WhatsApp channel

The Greek market lives on WhatsApp. The API layer is channel-agnostic already;
this is an adapter, not a rebuild. Big reach per unit of effort.

---

## 8. Long-term profile (the competitors' known weakness)

Independent reviews of Delphi and Coachvox flag session-based memory as a
recurring gap. A returning visitor being remembered — "last time you asked about
retention on your engineering team" — is a visible differentiator.

Do this **after** the verifier work: memory plus weak grounding compounds errors
across sessions instead of containing them.

---

## What I would NOT do yet

* **Voice cloning / TTS in his voice.** The wow is real but idea #1 delivers
  most of it with none of the deepfake exposure, and Article 50 synthetic-audio
  marking standards are still being settled. Revisit only with explicit written
  rights and a settled marking scheme.
* **A planner agent.** Needs the verifier legs in place first, or a re-plan has
  no trustworthy signal to trigger on.
* **Anything else** before the real pillar content lands. A cleverer engine over
  placeholder text produces confident-sounding thinness.

---

## Order

1. Real pillar content + 20 calibration episodes (content, not code)
2. Corpus-gap report — lowest effort, funds the retainer
3. Audio-grounded citations — the demo centrepiece
4. Verifier legs (b) and (c) — makes ≥90% grounding measurable
5. Live keynote mode
6. Evolution-of-thinking
7. Fit check, WhatsApp, talk-prep briefs
8. Memory, last
