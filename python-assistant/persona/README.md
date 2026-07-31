# Persona spec

Two files, one per language, loaded by `services/persona.py` and re-injected on
**every** turn — the CAG pattern from the BPAN app, not a one-shot system message.
`config.ORG_FACTS` is appended so the assistant can answer "how do I reach him"
without a retrieval hit.

```
system_prompt_el.md   Greek  — the primary; his audience is Greek-first
system_prompt_en.md   English — same rules, not a loose translation
```

## Why the two files are not translations of each other

They are the same nine sections in the same order with the same rules, written
natively in each language. A translated prompt drifts: Greek `εσύ` carries the
direct-address register that "you" doesn't, and English self-help vocabulary has
clichés Greek doesn't (and vice versa), so the ❌ list has to be written against
the clichés that actually exist in that language. When you edit one, edit both —
§9 in each file says the voice must not soften across languages, and that is only
true if both files enforce it.

## The structure, and why each part is there

| § | Section | Purpose |
|---|---|---|
| 1 | Sources only | RAG-only grounding + the no-invented-quote rule, stated first because everything else is subordinate to it |
| 2 | What you do | The positive register |
| 3 | **What you never do** | The negative register |
| 4 | Citations | The `[N]` marker contract; forbids the model writing its own source list |
| 5 | When you don't know | The no-answer fallback, in his voice, with a mandatory way forward |
| 6 | Out of scope | Four refusal classes + distress escalation |
| 7 | Formatting | Clean HTML, never markdown — the reply is injected into a page |
| 8 | Transparency | EU AI Act Art. 50 |
| 9 | Language | Answer in the user's language; never translate a quoted excerpt |

## §3 is the section that earns its keep

Every prompt has a "be helpful and professional" section. This persona's actual
risk is different: the default LLM register for a leadership question **is**
generic self-help — frameworks, five-step lists, "step out of your comfort zone."
That output is fluent, on-topic, and would pass a casual review. It is also the
precise opposite of his positioning, which is built on negation:

> "I don't present theories. I provide answers."
> "I don't speak in concepts. I speak in real experiences."
> "I'm not for everyone – and that's perfectly fine."

So the anti-patterns are enumerated as hard prohibitions rather than left implicit.
A bot that sounds like every other leadership bot doesn't just underdeliver — it
actively contradicts the thing he sells.

## §1 is enforced, not merely requested

The no-invented-quote rule is not left to the model's goodwill. Any text the model
puts in quotation marks is checked against the retrieved sources by
`services/grounding.py` (ported from `simasia-copilot/backend/app/verify.py`):
tokenise the quote, tokenise the cited source, require ≥0.6 content-word overlap.
Below threshold, the claim is downgraded before the user sees it. The model does
not get to grade itself.

## Editing checklist

1. Change one file → change its counterpart. Sections stay in lockstep.
2. Adding a new ❌ line? Add a probe to `tests/test_persona.py` in both languages.
3. Never hardcode a crisis phone number, email or URL in these files. The backend
   injects those (`config.ORG_FACTS`, `services/guardrails.py`) so there is one
   place to correct them.
4. Never soften §1. Every other rule is style; that one is the product guarantee.
