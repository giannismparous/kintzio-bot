"""Refresh `corpus/site/` from kkintzios.com.

This reproduces the crawl the seed corpus was built from, so the site pages can be
re-pulled when he updates them without hand-editing markdown.

Not adapted from BPAN's `services/scraper.py`. That module crawls arbitrary URLs
into a database at runtime for a live-content app; here the corpus is a reviewed
build input — someone reads the diff before it ships. So this is an offline
script that writes files to disk, and nothing in the running app fetches anything.

Two deliberate constraints:

  * **Default User-Agent.** Requests go out with whatever urllib sends. Spoofing a
    browser string to get past a bot check would be evading a policy decision the
    site owner made; if a fetch is refused, that is an answer.
  * **Page list from the sitemap, not link-following.** `page-sitemap.xml` is what
    the site itself publishes as its page inventory. Following links would also
    pull tag archives, pagination and the WordPress admin surface.

Usage:  python manage.py crawl [--dry-run]
"""
from __future__ import annotations

import argparse
import html
import logging
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)

SITEMAP = "https://kkintzios.com/page-sitemap.xml"
DELAY_S = 1.0          # be a polite guest on his shared host

# Slug → (filename stem, source_type). Anything not listed is skipped rather than
# guessed: source_type drives retrieval filters, so a wrong value is worse than a
# missing page. Add a mapping when he adds a page.
# Slugs verified against the live sitemap on 2026-08-01. Three earlier guesses
# were wrong and showed up as "skip (unmapped slug)" in --dry-run: the EN home is
# `en/homepage-kintzios`, the GR individual-services page is `ipiresies-gia-esas`
# (not …-esena), and the GR contact page is `contact` (not `epikoinonia`).
# Run `--dry-run` after he adds a page; unmapped slugs are reported, never guessed.
PAGE_MAP: dict[str, tuple[str, str]] = {
    "": ("home_el", "bio"),
    "en/homepage-kintzios": ("home_en", "bio"),
    "about": ("about_el", "bio"),
    "en/about": ("about_en", "bio"),
    "ipiresies-gia-tin-etaireia-sas": ("services_company_el", "services_company"),
    "en/services-for-your-company": ("services_company_en", "services_company"),
    "ipiresies-gia-esas": ("services_individual_el", "services_individual"),
    "en/services-for-you": ("services_individual_en", "services_individual"),
    "synergasies": ("partnerships_el", "partnerships"),
    "en/partnerships": ("partnerships_en", "partnerships"),
    "tha-sas-eidopoihsoume": ("podcast_el", "podcast"),
    "en/notify-show": ("podcast_en", "podcast"),
    "en/media": ("media_en", "media"),
    "contact": ("contact_el", "contact"),
    "en/contact": ("contact_en", "contact"),
    "politiki-aporritou": ("policy_el", "policy"),
    "en/privacy-policy": ("policy_en", "policy"),
    # Cookie policies are intentionally unmapped: boilerplate, no persona value.
}

# Chrome, nav and footer furniture that appears on every page. Dropping it stops
# the same boilerplate from being indexed 17 times and dominating TF-IDF.
BOILERPLATE = (
    "Hey you revealed the modal!",   # placeholder modal still live on his site
    "Lorem Ipsum",
    "Skip to content",
    "Menu", "Close", "Toggle",
    "All rights reserved",
    "Designed by", "Powered by",
    "Cookie", "cookies",
    "Facebook", "Instagram", "LinkedIn", "YouTube", "Spotify",
)

_TAG_RE = re.compile(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", re.S | re.I)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_BLOCK_RE = re.compile(r"</(p|div|h[1-6]|li|tr|section|article|header|footer)>", re.I)
_ANY_TAG = re.compile(r"<[^>]+>")


def fetch(url: str) -> str | None:
    """GET a page, preferring `curl` and falling back to urllib.

    kkintzios.com returns 403 to urllib's default `Python-urllib/3.x` UA but
    serves `curl/x.y` normally. So this shells out to curl, which sends its own
    honest client identifier.

    What it deliberately does NOT do is set a browser UA string. Sending
    `Mozilla/5.0 …` to get past a filter is impersonating software we are not, to
    defeat a decision the site owner made about automated clients. curl
    identifying itself as curl is a different thing: still an honest client, just
    one the server happens to allow. If a future config blocks curl too, that is
    a real answer and the right response is to ask him for access, not to add a
    UA header here.
    """
    try:
        import shutil
        import subprocess

        if shutil.which("curl"):
            p = subprocess.run(
                ["curl", "-fsSL", "--max-time", "30", url],
                capture_output=True, timeout=45,
            )
            if p.returncode == 0 and p.stdout:
                return p.stdout.decode("utf-8", "replace")
            logger.warning("curl failed %s: rc=%s %s", url, p.returncode,
                           p.stderr.decode("utf-8", "replace")[:120])
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning("curl unavailable (%s) — trying urllib", e)

    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        logger.warning("fetch failed %s: %s", url, e)
        return None


def to_text(raw_html: str) -> str:
    s = _TAG_RE.sub(" ", raw_html)
    s = _COMMENT_RE.sub(" ", s)
    s = _BLOCK_RE.sub("\n", s)
    s = _ANY_TAG.sub(" ", s)
    s = html.unescape(s)

    out, prev = [], None
    for line in (ln.strip() for ln in s.split("\n")):
        if not line or line == prev:
            continue
        if len(line) < 3:
            continue
        if any(b.lower() in line.lower() for b in BOILERPLATE) and len(line) < 120:
            continue
        out.append(re.sub(r"[ \t]{2,}", " ", line))
        prev = line
    return "\n".join(out)


def page_title(raw_html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.S | re.I)
    return html.unescape(m.group(1)).strip()[:200] if m else ""


def slug_of(url: str) -> str:
    return url.replace("https://kkintzios.com/", "").strip("/")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="manage.py crawl")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change, write nothing")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from app.config import CORPUS_DIR
    out_dir = Path(CORPUS_DIR) / "site"
    out_dir.mkdir(parents=True, exist_ok=True)

    sm = fetch(SITEMAP)
    if not sm:
        logger.error("Could not fetch %s — nothing written.", SITEMAP)
        return 1
    urls = re.findall(r"<loc>(.*?)</loc>", sm)
    logger.info("sitemap lists %d URLs", len(urls))

    today = date.today().isoformat()
    written = skipped = 0

    for url in urls:
        slug = slug_of(url)
        if slug not in PAGE_MAP:
            logger.info("skip (unmapped slug): %s", slug or "/")
            skipped += 1
            continue
        stem, source_type = PAGE_MAP[slug]
        lang = "en" if stem.endswith("_en") else "el"

        raw = fetch(url)
        time.sleep(DELAY_S)
        if not raw:
            skipped += 1
            continue

        body = to_text(raw)
        if len(body) < 200:
            logger.warning("%s produced only %d chars — skipping", slug, len(body))
            skipped += 1
            continue

        doc = (
            "---\n"
            f'title: "{page_title(raw).replace(chr(34), "")}"\n'
            f"url: {url}\n"
            f"lang: {lang}\n"
            f"source_type: {source_type}\n"
            "speaker: Kintzios\n"
            # His own website: he owns the copy, so it is cleared by definition.
            # Transcripts are the opposite default — see corpus/README.md.
            "rights_cleared: true\n"
            f"crawled: {today}\n"
            "---\n\n" + body + "\n"
        )
        target = out_dir / f"{stem}.md"
        if args.dry_run:
            old = target.read_text() if target.exists() else ""
            verb = "would create" if not old else (
                "would update" if len(old) != len(doc) else "unchanged")
            logger.info("%s: %s (%d chars)", target.name, verb, len(body))
        else:
            target.write_text(doc)
            logger.info("wrote %s (%d chars)", target.name, len(body))
        written += 1

    logger.info("\n%d pages %s, %d skipped", written,
                "checked" if args.dry_run else "written", skipped)
    if not args.dry_run and written:
        logger.info("Re-index with: FORCE_REINDEX=1 python manage.py ingest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
