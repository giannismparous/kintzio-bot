import * as cheerio from 'cheerio';
import { normalizeUrl } from '../domain/text.js';
import { BrowserRenderSession } from './browserRender.js';

const DEFAULT_MAX_PAGES = 40;
const BROWSER_RENDER_DISABLED = /^(1|true|yes)$/i.test(
  String(process.env.DISABLE_BROWSER_RENDER || '')
);

function sameHost(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function absolutize(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isCrawlable(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (u.pathname.match(/\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mp3|css|js|ico|woff2?)$/i)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSpaShell($) {
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const appRoot = $('#root, #app, #__next').first();
  const emptyAppMount =
    appRoot.length > 0 &&
    appRoot.children().length === 0 &&
    bodyText.length < 200;
  const noscriptOnly =
    /enable javascript/i.test(bodyText) && bodyText.length < 160;
  return emptyAppMount || noscriptOnly;
}

function metaFallback($) {
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const desc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const parts = [title, String(desc).trim()].filter(Boolean);
  return parts.join('\n\n').trim();
}

function parseHtmlContent(body, finalUrl) {
  const $ = cheerio.load(body);
  const title = ($('title').first().text() || $('h1').first().text() || finalUrl).trim();
  const spaShell = isSpaShell($);
  const $clean = cheerio.load(body);
  $clean('script, style, noscript, iframe, svg').remove();
  $clean('nav, footer, header').remove();
  let text = $clean('body').text().replace(/\s+/g, ' ').trim();
  const metaText = metaFallback($);
  const usedMetaOnly = !text || text.length < 40;
  if (usedMetaOnly) text = metaText;
  const needsBrowser = spaShell || (usedMetaOnly && text.length < 80);
  return { title, text, spaShell, needsBrowser, metaText };
}

export class SimpleUrlFetcher {
  async fetchTextStatic(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'KintzioBot/0.1 (+local-dev)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch URL (${res.status})`);
    }
    const contentType = res.headers.get('content-type') || '';
    const finalUrl = res.url || url;
    const body = await res.text();

    if (contentType.includes('text/plain')) {
      return { title: finalUrl, text: body, finalUrl, html: null, needsBrowser: false };
    }

    const parsed = parseHtmlContent(body, finalUrl);
    if (!parsed.text || parsed.text.length < 40) {
      if (parsed.needsBrowser) {
        return { ...parsed, finalUrl, html: body, needsBrowser: true, text: '' };
      }
      throw new Error('Could not extract enough text from URL');
    }
    return { ...parsed, finalUrl, html: body, needsBrowser: parsed.needsBrowser };
  }

  async fetchTextWithSession(url, session) {
    const rendered = await session.render(url);
    const parsed = parseHtmlContent(rendered.html, rendered.finalUrl);
    if (!parsed.text || parsed.text.length < 40) {
      throw new Error('Could not extract enough text from URL after rendering');
    }
    return {
      ...parsed,
      finalUrl: rendered.finalUrl,
      html: rendered.html,
      needsBrowser: false,
      rendered: true,
    };
  }

  async fetchText(url) {
    const staticResult = await this.fetchTextStatic(url);
    if (!staticResult.needsBrowser) {
      return staticResult;
    }
    if (BROWSER_RENDER_DISABLED) {
      if (staticResult.text && staticResult.text.length >= 40) {
        return { ...staticResult, needsBrowser: false, rendered: false };
      }
      throw new Error('This page requires JavaScript rendering, which is disabled');
    }

    const session = new BrowserRenderSession();
    try {
      return await this.fetchTextWithSession(url, session);
    } finally {
      await session.close();
    }
  }

  extractLinks(baseUrl, html) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const out = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = absolutize(baseUrl, href);
      if (!abs || !isCrawlable(abs) || !sameHost(baseUrl, abs)) return;
      try {
        out.add(normalizeUrl(abs));
      } catch {
        /* skip */
      }
    });
    return [...out];
  }

  async fetchSitemapUrls(seedUrl) {
    const urls = new Set();
    let origin;
    try {
      origin = new URL(seedUrl).origin;
    } catch {
      return [];
    }
    const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    for (const sm of candidates) {
      try {
        const res = await fetch(sm, {
          headers: { 'User-Agent': 'KintzioBot/0.1 (+local-dev)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<loc>')) continue;
        const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
        for (const loc of locs) {
          if (!isCrawlable(loc) || !sameHost(seedUrl, loc)) continue;
          if (loc.endsWith('.xml')) {
            try {
              const nested = await fetch(loc, {
                headers: { 'User-Agent': 'KintzioBot/0.1 (+local-dev)' },
                signal: AbortSignal.timeout(15000),
              });
              if (!nested.ok) continue;
              const nxml = await nested.text();
              for (const m of nxml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
                const u = m[1].trim();
                if (isCrawlable(u) && sameHost(seedUrl, u) && !u.endsWith('.xml')) {
                  try {
                    urls.add(normalizeUrl(u));
                  } catch {
                    /* skip */
                  }
                }
              }
            } catch {
              /* skip nested */
            }
            continue;
          }
          try {
            urls.add(normalizeUrl(loc));
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip sitemap */
      }
    }
    return [...urls];
  }

  /**
   * Crawl same-host pages starting from seedUrl.
   * @returns {Promise<Array<{ url: string, title: string, text: string }>>}
   */
  async crawlSite(seedUrl, { maxPages = DEFAULT_MAX_PAGES, onProgress } = {}) {
    const seed = normalizeUrl(seedUrl);
    const queue = [seed];
    const seen = new Set();
    const pages = [];
    let useBrowser = false;
    let lastError = '';
    const browserSession = new BrowserRenderSession();

    try {
      const fromSitemap = await this.fetchSitemapUrls(seed);
      for (const u of fromSitemap) {
        if (!seen.has(u)) queue.push(u);
      }

      while (queue.length && pages.length < maxPages) {
        const next = queue.shift();
        if (!next || seen.has(next)) continue;
        seen.add(next);

        try {
          if (onProgress) onProgress(pages.length + 1, maxPages, next);

          let fetched;
          if (useBrowser) {
            fetched = await this.fetchTextWithSession(next, browserSession);
          } else {
            fetched = await this.fetchTextStatic(next);
            if (fetched.needsBrowser) {
              if (BROWSER_RENDER_DISABLED) {
                if (!fetched.text || fetched.text.length < 40) {
                  throw new Error('This page requires JavaScript rendering, which is disabled');
                }
                fetched = { ...fetched, needsBrowser: false, rendered: false };
              } else {
                useBrowser = true;
                fetched = await this.fetchTextWithSession(next, browserSession);
              }
            }
          }

          const pageUrl = normalizeUrl(fetched.finalUrl || next);
          if (pages.some((p) => p.url === pageUrl)) continue;
          pages.push({
            url: pageUrl,
            title: fetched.title,
            text: fetched.text,
          });

          for (const link of this.extractLinks(pageUrl, fetched.html)) {
            if (!seen.has(link) && !queue.includes(link)) queue.push(link);
          }
        } catch (err) {
          lastError = err?.message || String(err);
          // skip failed pages; continue crawl
        }
      }

      // SPA with no crawlable HTML: at least index meta description so the source isn't empty
      if (!pages.length) {
        try {
          const staticSeed = await this.fetchTextStatic(seed);
          const meta = staticSeed.metaText || staticSeed.text || '';
          if (meta && meta.length >= 40) {
            pages.push({
              url: seed,
              title: staticSeed.title || seed,
              text: meta,
            });
          }
        } catch (err) {
          lastError = lastError || err?.message || String(err);
        }
      }
    } finally {
      await browserSession.close();
    }

    if (!pages.length) {
      throw new Error(
        lastError
          ? `Site scrape found no usable pages (${lastError})`
          : 'Site scrape found no usable pages'
      );
    }
    return pages;
  }
}
