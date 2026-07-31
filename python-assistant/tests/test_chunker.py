"""The speaker-attribution invariant.

These are the tests the persona guarantee rests on. Every other failure in this
app is loud; an attribution leak is silent — the answer still generates, the
citation still resolves, and someone else's words carry his name.
"""
from __future__ import annotations

import re

from ingest.transcripts import _bare_turn, _iter_turns, chunk_turns, load_transcript

# Any `[mm:ss] Speaker:` header appearing INSIDE a chunk means the chunk spans a
# turn boundary.
LABEL_IN_TEXT = re.compile(r"\[\d{1,2}:\d{2}(?::\d{2})?\]\s*[^:\[\]]{1,40}:")


def test_dialogue_colon_is_not_a_turn_header():
    """A colon inside dialogue must not create a speaker.

    Regression test for a real bug: the original bare-header pattern
    `^[\\w .'_-]{1,40}?\\s*:` matched "Το θέμα είναι: δεν ρωτάμε" and produced a
    speaker literally named "Το θέμα είναι". Because chunk_turns trusts the
    speaker field absolutely, that fabricates an attribution with no error
    raised anywhere.
    """
    cast = {"Kintzios", "Guest"}
    assert _bare_turn("Το θέμα είναι: δεν ρωτάμε", cast) is None
    assert _bare_turn("The point is: nobody asks", cast) is None
    # A declared speaker still works.
    assert _bare_turn("Kintzios: το θέμα είναι απλό", cast) == ("Kintzios", "το θέμα είναι απλό")


def test_undeclared_speaker_is_not_invented():
    """Without a cast entry, a `Name:` line is dialogue, not a header."""
    body = "[00:05] Kintzios: Πρώτη ατάκα.\nΜαρία: δεν είναι στο cast."
    turns = list(_iter_turns(body, {"Kintzios"}))
    assert [t[1] for t in turns] == ["Kintzios"]
    # The undeclared line is absorbed as continuation of his turn, not promoted.
    assert "Μαρία" in turns[0][2]


def test_no_chunk_spans_two_speakers():
    """The core invariant, on an alternating transcript.

    Turn text is deliberately over MIN_CHARS (40); see
    test_turns_below_min_chars_are_dropped for that threshold's own behaviour.
    """
    body = (
        "[00:01] Kintzios: Θα σου πω κάτι που δεν αρέσει σε κανέναν manager εδώ μέσα.\n"
        "[00:20] Guest: Διαφωνώ, και θα σου εξηγήσω γιατί με τη δική μου εμπειρία.\n"
        "[00:35] Kintzios: Και ξαναμιλώ εγώ, γιατί το θέμα δεν είναι εκεί που νομίζεις.\n"
        "[00:50] Host2: Και κλείνω εγώ τη συζήτηση με μια τελευταία ερώτηση για όλους.\n"
    )
    turns = list(_iter_turns(body, {"Kintzios", "Guest", "Host2"}))
    assert len(turns) == 4
    chunks = chunk_turns(turns)
    assert [c["speaker"] for c in chunks] == ["Kintzios", "Guest", "Kintzios", "Host2"]
    for c in chunks:
        assert not LABEL_IN_TEXT.search(c["content"]), c


def test_consecutive_same_speaker_turns_merge():
    """Consecutive turns by ONE speaker pack together; a different speaker cuts."""
    body = (
        "[00:01] Kintzios: Πρώτη σκέψη, αρκετά μεγάλη ώστε να περάσει το κατώφλι.\n"
        "[00:08] Kintzios: Δεύτερη σκέψη, που συνεχίζει ακριβώς την προηγούμενη.\n"
        "[00:20] Guest: Και τώρα μιλάω εγώ, για κάτι εντελώς διαφορετικό από πριν.\n"
    )
    chunks = chunk_turns(list(_iter_turns(body, {"Kintzios", "Guest"})))
    assert [c["speaker"] for c in chunks] == ["Kintzios", "Guest"]
    assert "Πρώτη σκέψη" in chunks[0]["content"]
    assert "Δεύτερη σκέψη" in chunks[0]["content"]
    assert "μιλάω εγώ" not in chunks[0]["content"]


def test_turns_below_min_chars_are_dropped():
    """Sub-40-char standalone turns are dropped, and that is deliberate.

    Transcripts are full of "Ναι.", "Σωστά.", "Ακριβώς." — indexing them adds
    retrieval noise and no answerable content. Documented here so the behaviour
    is a decision on record rather than a surprise when a short turn goes missing.
    """
    chunks = chunk_turns([("00:01", "Kintzios", "Ναι."), ("00:04", "Guest", "Σωστά.")])
    assert chunks == []


def test_long_turn_splits_within_itself():
    """An over-long single turn splits, and every piece keeps its one speaker."""
    long_text = " ".join(
        f"Πρόταση νούμερο {i} που λέει κάτι συγκεκριμένο για την ηγεσία." for i in range(40)
    )
    chunks = chunk_turns([("00:01", "Kintzios", long_text)])
    assert len(chunks) > 1
    assert {c["speaker"] for c in chunks} == {"Kintzios"}


def test_preamble_before_first_header_is_dropped():
    """Text with no speaker must never be assigned one."""
    body = "Σημείωση παραγωγής: αυτό είναι σχόλιο.\n[00:10] Kintzios: Η πρώτη ατάκα.\n"
    turns = list(_iter_turns(body, {"Kintzios"}))
    assert len(turns) == 1
    assert "Σημείωση παραγωγής" not in turns[0][2]


def test_real_corpus_transcripts_hold_the_invariant(tmp_path):
    """Run the invariant over the actual corpus files, not just fixtures."""
    from app.config import TRANSCRIPTS_DIR
    from pathlib import Path

    files = sorted(Path(TRANSCRIPTS_DIR).glob("*.md"))
    assert files, "no transcripts in corpus/transcripts/"
    total = 0
    for f in files:
        for rec in load_transcript(f):
            total += 1
            assert not LABEL_IN_TEXT.search(rec["content"]), (f.name, rec["content"][:80])
            assert rec["speaker"], f"empty speaker in {f.name}"
    assert total > 0
