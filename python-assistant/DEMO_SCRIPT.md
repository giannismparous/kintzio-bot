# DEMO_SCRIPT

A 12-minute demo for Konstantinos Kintzios. Ordered so the first thing he sees is
the thing he'll want, and the guardrails come after he's already interested.

**Before you start**

```bash
python manage.py serve      # http://localhost:8020
```

Set `GEMINI_API_KEY` first. Without it every step below still *routes* correctly
but the persona answers are replaced by a "model unavailable" notice with sources
— fine for testing, not for a demo.

**Do not open with the chatbot.** He is pitched AI tools constantly. Open with the
gap on his own website.

---

## 1 · The pillar navigator (3 min) — lead with this

> "Your site says you offer around fifty keynote thematic pillars. It doesn't list
> them. Someone with a problem has to email you and wait."

Open `http://localhost:8020`, and type in Greek:

**«Οι νέοι μας φεύγουν μέσα στον πρώτο χρόνο»**

Then in English: **"our managers can't give feedback"**

Both return matched pillars with a next step. Verified output on the seed corpus:

| Input | Pillars returned |
|---|---|
| Οι νέοι μας φεύγουν… | `servant-leadership`, `character-over-skills` |
| our managers can't give feedback | `servant-leadership`, `gen-z-bridge` |

**The point to make:** these are *placeholder* pillars — six of his likely themes
written by us. With his real fifty, this becomes the qualification step his inbox
currently does by hand. And note the language: Greek in, Greek out; English in,
English out. Nothing is translated in either direction.

## 2 · Digital Kintzios, with receipts (3 min)

**«Πώς διοικώ μια ομάδα με Gen Z;»**

Answers in his register, then click a `[1]` footnote — it jumps to the source, and
the source is a page on his own site.

Then in English: **"How do I give feedback to a senior manager?"**

**The point:** every claim is traceable, and *every quotation is verified
character-by-character against the source before it is shown to you.* If the model
produces a quote that isn't in the corpus, the quote is **deleted** — not
flagged, not hedged. A hedged fabricated quote still reads as something he said,
and screenshots travel.

If he pushes on this — and he should — show him:

```bash
python -m pytest tests/test_guardrails.py -k fabricated -v
```

## 3 · What it refuses (2 min)

This is where a personal-brand bot lives or dies. All four are real outputs:

**«Σε ποιες μετοχές να επενδύσω;»**
> Δεν απαντώ σε οικονομικά, φορολογικά ή επενδυτικά θέματα…

**"What is the capital of Peru?"**
> That's outside what I cover. I'm here for leadership, teams, workplace culture
> and careers — not general questions.

**«Πόσο κοστίζει μια ομιλία;»**
> Δεν δίνω τιμές — και δεν είναι υπεκφυγή. Η αμοιβή εξαρτάται από τη μορφή, το
> κοινό, τη διάρκεια…

**The point on that last one:** it will never quote a figure. Not a range, not a
"typically". Any number a bot produces becomes an anchor he has to argue down.

Then, carefully:

**"I can't go on like this"**
> I'm going to stop here, because what you're describing matters more than any
> career advice.

It stops, hands over the Greek support line 1018, and does not attempt coaching.
His brand is adjacent to self-help; some people will arrive in genuine
difficulty. **This is checked before anything else in the pipeline** — before
scope, before retrieval, before the model is called at all.

## 4 · Lead qualification (2 min)

**«Θέλω keynote για το συνέδριό μας»** → the speaking flow.

Four flows, taken from his own contact form: keynote · corporate workshop ·
individual mentoring · Notify Show guest. Consent checkbox is a **precondition** —
no consent, no stored record.

Then `http://localhost:8020/admin` (credentials required) and show the leads
table. Point at the **fit score**:

> "Your contact page already has a 'DO NOT REACH OUT IF…' list. That's a
> qualification rubric you apply by hand. It's encoded here as an internal
> signal — it sorts your inbox, it never rejects anyone, and the prospect never
> sees it."

## 5 · The two things only he can see (1.5 min)

Still in `/admin`:

**Internal search.** Search **«προάγουν τον καλύτερο τεχνικό σε manager»**. It
returns the hit, with speaker and timestamp — including from an episode marked
`rights_cleared: false`. Then show that the *public* assistant cannot reach that
same episode. Rights clearance is per-episode: a guest who hasn't approved
publication is searchable by his team and invisible to the public.

**Unanswered questions.** Every question the corpus couldn't answer, ranked by
frequency.

> "You built *Reboot Your Career* out of thousands of messages people sent you.
> This is that signal, collected continuously, ranked. It's your content pipeline."

## 6 · The widget (30 sec)

`http://localhost:8020/widget-demo` — two script tags, drops into WordPress,
bubble or inline. Bilingual toggle, AI disclosure visible before the first
message (EU AI Act Art. 50).

---

## What to say about what's missing

Don't let him discover these himself:

1. **The corpus is his website.** Six placeholder pillars and two fixture
   transcripts stand in for the real material. The assistant is exactly as good
   as what he supplies — the priority-ordered list is in `corpus/README.md`.
2. **His privacy notice needs updating** before this goes live. It covers form
   contact only and says comments are retained *indefinitely*. This app ships its
   own interim notice, but the site's needs a lawyer.
3. **Also:** several pages on kkintzios.com currently show a placeholder modal
   reading "Hey you revealed the modal!" followed by Lorem Ipsum. Worth
   mentioning regardless of this project.

## The close

> "It doesn't replace you. It handles the fifty conversations a week that end with
> someone asking whether you cover their problem — and it tells you which
> questions you should be answering next."
