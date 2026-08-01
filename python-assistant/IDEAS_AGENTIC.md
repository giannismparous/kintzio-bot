# Τούμπανο — the agentic version

The previous ideas list was mostly features. This one is about changing what the
thing *is*. Today it is a very careful search engine that writes. Nothing in it
decides anything: `grep -c "tools=\|function_call"` over the whole app returns
zero. One prompt in, one answer out.

Six ideas, ordered by how much they change the demo.

---

## 1. Derive his ~50 pillars FROM the episodes — don't ask him for them ⭐

This is the biggest one and it removes the blocker I have been repeating at him.

I keep saying *"give us the ~50 pillar titles and a paragraph each."* That is
homework for a man whose entire problem is that he has no time. He will not do
it, and until he does, the navigator matches burnout to `gen-z-bridge` at 0.098.

**Flip it.** Run an offline mining agent over the transcripts:

* cluster the episodes by theme
* for each cluster, extract the recurring argument, his three best verbatim
  lines, and the counter-position he keeps arguing against
* name the pillar **in his own words**, taken from how he actually says it
* emit a draft taxonomy with citations to the episodes that justify each one

Then the ask changes from *"write 50 descriptions"* to **"approve or correct
these 50 we found in your own material — 30 minutes."**

That is a far better meeting. You are not asking him for content, you are
showing him a map of his own thinking that he has never seen, with receipts. It
is also the single most impressive artifact you could put in front of him,
because it is *about him* and he could not have produced it himself.

Costs one batch job over the corpus. Needs the 20 calibration episodes, nothing
else. **Do this first.**

---

## 2. Make it tool-using, and delete the routing logic

Right now the router decides everything with `if` statements: is this a price
question, a pillar question, a lead. That is the same mistake as the scope
keyword list, just distributed across more files.

Give the model **tools** and let it choose:

| tool | does |
|---|---|
| `search_corpus(query, lang)` | what happens today |
| `match_pillars(problem)` | the navigator |
| `start_lead_flow(kind)` | begins qualification mid-conversation |
| `find_episodes(topic, date_range)` | for "has he changed his mind" |
| `check_availability()` | Calendly stub |

Why this is the real upgrade: a single question can now need **two** tools.
*"Do you do workshops for tech teams and what would you cover?"* is a lead
question and a pillar question. Today it gets one retrieval pass and half an
answer. With tools it gets both, in one turn, and the lead capture begins inside
the conversation instead of behind a form.

Keep exactly three things out of the model's hands — distress, price, and rights
filtering. Those are safety and legal invariants. Everything else is judgement,
and judgement is what the model is for.

---

## 3. Kitsi asks back — the diagnostic interview

He is a mentor. Mentors do not answer the first question; they find out what the
real question is. Right now Kitsi behaves like an FAQ.

> **Visitor:** Οι νέοι μας φεύγουν στον πρώτο χρόνο.
> **Kitsi:** Πριν σου πω τι νομίζω — τρία πράγματα. Φεύγουν από συγκεκριμένους
> managers ή από παντού; Τους το είπε κανείς πριν φύγουν; Και τι τους υποσχεθήκατε
> στη συνέντευξη που δεν βρήκαν;

Then it answers, using the answers.

This is agentic in the way that matters commercially: it is **multi-turn with a
goal**. And it is the most on-brand thing in this entire document — it is
literally his method, and it is what separates a mentor from a search box. It
also triples session length and produces a qualified lead as a by-product,
because by question three you know whether this person is worth his time.

Effort: low. It is a prompt and a small state machine over the session.

---

## 4. A register critic — second pass, cheap model

Generate the answer, then ask a second cheap call: *"Here is how Konstantinos
writes. Here is a draft. Does this sound like him? If not, what is wrong with
it?"* Regenerate once if it fails.

He is going to judge this product on exactly one axis — *does it sound like me* —
and right now there is no mechanism that even looks at that. Flash-lite makes it
nearly free. This is also the only way to catch register drift as the corpus
grows.

Ship it with a visible internal metric: *"92% of answers passed voice check on
first pass."* That is a number he will care about more than any grounding score.

---

## 5. The LinkedIn agent — where the money actually is

He is the **No. 2 most influential LinkedIn profile in Greece**. That is the
asset with the highest commercial value in his whole portfolio, and it depends
entirely on him personally writing posts.

An agent that: reads what his audience asked Kitsi this week (already logged),
finds where his own material answers it, and drafts three posts **in his voice,
each grounded in a real episode with the timestamp**, for him to edit and post.

This is not a chatbot feature. It is a second product, it justifies a much larger
retainer than €900/month, and it is defensible because nobody else has his
corpus. Pitch the bot, then sell this.

---

## 6. Voice — but the honest version

Real-time spoken conversation with Kitsi. Not a cloned voice: a clearly synthetic
one that says it is synthetic. The wow is in the **interaction**, not the timbre.

And keep the thing I proposed before: when it cites an episode, it plays the
twenty seconds of **him actually saying it**. Synthetic voice for the assistant's
own words, real audio for his. The distinction is audible, honest, and it makes
the whole product's argument in one interaction.

---

## What I would still refuse to make agentic

* **Distress.** Must work when the model is down. A planner deciding whether
  something counts as a crisis is not a trade worth making.
* **Price.** A fabricated number becomes an anchor he argues down later.
* **Rights filtering.** Spyros's material being barred from public answers is a
  legal boundary, not a judgement call.

Everything else — scope, routing, tool choice, follow-up questions, when to stop
asking and answer — belongs to the model.

---

## Order

1. **Pillar mining** (#1) — removes the blocker, best artifact for the meeting
2. **Register critic** (#4) — cheap, and it de-risks the only judgement he cares about
3. **Diagnostic interview** (#3) — biggest demo change per line of code
4. **Tool loop** (#2) — the real architecture change; do it once 1–3 prove the model can be trusted
5. **LinkedIn agent** (#5) — sell it as phase two
6. **Voice** (#6) — last, and only with rights settled

Everything above needs one thing first: an `AIza…` key. The value in `.env` is
still a 53-character `AQ.Ab…` OAuth token, so every model-dependent claim in this
document — including the scope fix from last night — is verified against a stub
and has never run against a real model.
