# Corpus contract

Everything the assistant is allowed to say comes from this directory. The
frontmatter is not decoration — the retrieval filter reads it, so a wrong flag
here is a wrong answer in production.

```
corpus/
  site/          17 pages crawled from kkintzios.com, 31 Jul 2026 (GR + EN)
  pillars/       one file per keynote pillar, per language  ← PLACEHOLDER
  transcripts/   podcast episodes, speaker-turn format      ← PLACEHOLDER
```

## Frontmatter fields

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Shown in the citation list |
| `url` | yes* | Cited link. Empty = cited by title only, never linked |
| `lang` | yes | `el` or `en`. **First-class metadata, never inferred at query time** |
| `source_type` | yes | `bio` `services_company` `services_individual` `partnerships` `media` `podcast` `contact` `policy` `pillar` `transcript` |
| `speaker` | yes for non-transcripts | `Kintzios` for his own copy. Transcripts set speaker per *turn*, not per file |
| `rights_cleared` | yes | `true` = may appear in public answers. `false` = **internal search only** |
| `placeholder` | no | `true` marks seed content to be replaced with the real thing |
| `episode`, `speakers` | transcripts | Episode id; the cast list |
| `pillar_slug`, `formats`, `tags` | pillars | Groups the GR/EN pair; drives the navigator |

## The two rules that carry the product guarantee

**1. Public answers require `speaker == Kintzios` AND `rights_cleared == true`.**
Defined once, in `config.PERSONA_SPEAKER` + `indexing.public_filter()`, and
applied at retrieval. Internal search applies no filter. If you find yourself
writing a second copy of this predicate, stop — that is how the two routes drift
and how a guest's opinion ends up attributed to him.

**2. A chunk never spans two speakers.**
Transcript turns are `[mm:ss] Speaker: text` starting at column 0. The chunker
splits on turn boundaries first and only then packs turns into chunks, and it
packs *consecutive turns by the same speaker* only. `tests/test_chunker.py`
asserts no chunk contains two speaker labels. This is the failure mode that
would break the "never fabricate his opinion" promise silently, which is why it
has a dedicated test rather than a code comment.

## Transcript format

```
[00:31] Kintzios: Θα σου πω κάτι που δεν αρέσει σε κανέναν manager…

[01:20] Guest: Στην εταιρεία μας βλέπουμε μεγάλο turnover.
```

Timestamps are optional but strongly preferred — the internal search route
returns them so the team can jump to the moment in the audio.

## What still has to arrive from Kintzios

| Priority | Asset | Why |
|---|---|---|
| 1 | The real ~50 pillar titles + one paragraph each | Unlocks the navigator. His site promises them; nothing lists them. Almost certainly already in a sales deck |
| 2 | Podcast transcripts with speaker labels + per-episode rights clearance | The only source of him at length in his own unedited voice. Slowest to obtain — start first |
| 3 | LinkedIn post archive | He is the No.2 most influential profile in Greece (Favikon); dense, on-voice, exportable |
| 4 | Media appearance transcripts | 10 titled appearances are listed on `/en/media/`, titles only |
| 5 | `Reboot Your Career` outline | Likely `rights_cleared: false` — it is a paid product. This is what the flag is for |

## Re-crawling the site

`python -m ingest.crawl` refreshes `corpus/site/` from kkintzios.com and
rewrites the frontmatter. It will not touch `pillars/` or `transcripts/`.
Re-run after he updates his site copy, then re-run `python -m ingest`.
