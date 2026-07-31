import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import {
  chunkText,
  estimateTokens,
  sha256,
  normalizeUrl,
} from '@kintzio/core';
import {
  pool,
  vectorStore,
  objectStore,
  urlFetcher,
  getEmbedder,
} from '../config.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const running = new Set();
const SITE_CRAWL_MAX = Number(process.env.SITE_CRAWL_MAX_PAGES || 40);

async function updateJob(jobId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await pool.query(
    `UPDATE build_jobs SET ${sets.join(', ')} WHERE id = $1`,
    [jobId, ...keys.map((k) => fields[k])]
  );
}

async function updateBot(botId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = NOW()');
  await pool.query(
    `UPDATE bots SET ${sets.join(', ')} WHERE id = $1`,
    [botId, ...keys.map((k) => fields[k])]
  );
}

/** Remove chunks and page claims left behind when sources are deleted. */
export async function purgeOrphanedIndex(botId) {
  const { rows } = await pool.query(
    `DELETE FROM chunks
     WHERE bot_id = $1
       AND source_id NOT IN (SELECT id FROM sources WHERE bot_id = $1)
     RETURNING id`,
    [botId]
  );
  await pool.query(
    `DELETE FROM bot_pages
     WHERE bot_id = $1
       AND source_id NOT IN (SELECT id FROM sources WHERE bot_id = $1)`,
    [botId]
  );
  return rows.length;
}

async function loadFileBytes(source) {
  const key = source.uri?.replace(/^\/files\//, '') || source.uri;
  return objectStore.get(key);
}

async function loadPdfText(source) {
  const buf = await loadFileBytes(source);
  const parsed = await pdfParse(buf);
  return String(parsed.text || '').trim();
}

async function loadPlainFileText(source) {
  const buf = await loadFileBytes(source);
  return buf.toString('utf8').trim();
}

/**
 * Claim a page URL for this source, or skip if another source already owns it.
 * Returns 'claimed' | 'skipped'
 */
async function claimPage(botId, sourceId, pageUrl, contentHash, title) {
  const { rows } = await pool.query(
    'SELECT source_id FROM bot_pages WHERE bot_id = $1 AND page_url = $2',
    [botId, pageUrl]
  );
  if (rows[0]) {
    if (rows[0].source_id === sourceId) {
      await pool.query(
        `UPDATE bot_pages SET content_hash = $3, title = $4 WHERE bot_id = $1 AND page_url = $2`,
        [botId, pageUrl, contentHash, title || null]
      );
      return 'claimed';
    }
    return 'skipped';
  }
  await pool.query(
    `INSERT INTO bot_pages (bot_id, page_url, source_id, content_hash, title)
     VALUES ($1, $2, $3, $4, $5)`,
    [botId, pageUrl, sourceId, contentHash, title || null]
  );
  return 'claimed';
}

async function embedPages(source, pages, embedder, onProgress) {
  let totalChunks = 0;
  let embeddedPages = 0;
  let skippedPages = 0;

  await vectorStore.deleteBySource(source.id);
  await pool.query('DELETE FROM bot_pages WHERE source_id = $1', [source.id]);

  for (let p = 0; p < pages.length; p += 1) {
    const page = pages[p];
    const text = String(page.text || '').trim();
    if (text.length < 20) continue;

    const pageUrl = page.url || null;
    const contentHash = sha256(text);

    if (pageUrl) {
      const claim = await claimPage(
        source.bot_id,
        source.id,
        pageUrl,
        contentHash,
        page.title
      );
      if (claim === 'skipped') {
        skippedPages += 1;
        if (onProgress) {
          onProgress({
            message: `Skipped duplicate page ${pageUrl}`,
            page: p + 1,
            total: pages.length,
          });
        }
        continue;
      }
    }

    const parts = chunkText(text);
    if (!parts.length) continue;

    const embeddings = [];
    for (let i = 0; i < parts.length; i += 1) {
      const [vec] = await embedder.embedDocuments([parts[i]]);
      embeddings.push(vec);
    }

    const records = parts.map((content, ordinal) => ({
      id: uuidv4(),
      botId: source.bot_id,
      sourceId: source.id,
      ordinal: totalChunks + ordinal,
      content,
      tokenEstimate: estimateTokens(content),
      contentHash: sha256(content),
      embedding: embeddings[ordinal],
      pageUrl,
    }));

    await vectorStore.upsertChunks(records);
    totalChunks += records.length;
    embeddedPages += 1;

    if (onProgress) {
      onProgress({
        message: `Embedded ${page.title || pageUrl || 'document'} (${embeddedPages}/${pages.length})`,
        page: p + 1,
        total: pages.length,
      });
    }
  }

  return { totalChunks, embeddedPages, skippedPages };
}

async function loadSourcePages(source, onProgress) {
  if (source.type === 'pdf') {
    const text = await loadPdfText(source);
    return [{ url: null, title: source.label, text }];
  }
  if (source.type === 'txt' || source.type === 'text') {
    let text;
    if (source.uri && String(source.uri).startsWith('/files/')) {
      text = await loadPlainFileText(source);
    } else {
      text = String(source.uri || '').trim();
    }
    return [{ url: null, title: source.label, text }];
  }
  if (source.type === 'url') {
    const mode = source.scrape_mode === 'site' ? 'site' : 'page';
    if (mode === 'site') {
      const pages = await urlFetcher.crawlSite(source.uri, {
        maxPages: SITE_CRAWL_MAX,
        onProgress: (n, max, url) => {
          if (onProgress) {
            onProgress({ message: `Crawling (${n}/${max}): ${url}` });
          }
        },
      });
      return pages;
    }
    const fetched = await urlFetcher.fetchText(source.uri);
    return [
      {
        url: normalizeUrl(fetched.finalUrl || source.uri),
        title: fetched.title || source.label,
        text: fetched.text,
      },
    ];
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

async function processSource(source, embedder, onProgress) {
  await pool.query(
    `UPDATE sources SET status = 'indexing', error_message = 'Starting…', chunk_count = 0 WHERE id = $1`,
    [source.id]
  );

  const pages = await loadSourcePages(source, onProgress);
  if (!pages.length) throw new Error('Source produced no pages');

  const totalBytes = pages.reduce(
    (sum, p) => sum + Buffer.byteLength(String(p.text || ''), 'utf8'),
    0
  );

  const result = await embedPages(source, pages, embedder, onProgress);
  if (!result.totalChunks) {
    throw new Error(
      result.skippedPages
        ? 'All pages were duplicates of content already indexed by another source'
        : 'Source produced too little text'
    );
  }

  const note =
    result.skippedPages > 0
      ? `Indexed ${result.embeddedPages} page(s) (skipped ${result.skippedPages} duplicate${result.skippedPages === 1 ? '' : 's'}) · ${result.totalChunks} chunks`
      : result.embeddedPages > 1
        ? `Indexed ${result.embeddedPages} pages · ${result.totalChunks} chunks`
        : `${result.totalChunks} chunks`;

  await pool.query(
    `UPDATE sources
     SET status = 'ready',
         error_message = $2,
         chunk_count = $3,
         byte_size = CASE WHEN $4 > byte_size THEN $4 ELSE byte_size END
     WHERE id = $1`,
    [source.id, note, result.totalChunks, totalBytes]
  );
  return result.totalChunks;
}

export async function enqueueBuild(botId, mode = 'adaptive') {
  const { rows } = await pool.query(
    `INSERT INTO build_jobs (bot_id, mode, status, progress, message, started_at)
     VALUES ($1, $2, 'queued', 0, 'Queued', NULL)
     RETURNING *`,
    [botId, mode]
  );
  const job = rows[0];
  setImmediate(() => runBuild(job.id).catch(console.error));
  return job;
}

export async function runBuild(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);

  const { rows: jobRows } = await pool.query(
    'SELECT * FROM build_jobs WHERE id = $1',
    [jobId]
  );
  const job = jobRows[0];
  if (!job) {
    running.delete(jobId);
    return;
  }

  const botId = job.bot_id;
  const mode = job.mode;

  try {
    await updateJob(jobId, {
      status: 'running',
      progress: 1,
      message: 'Starting build…',
      started_at: new Date(),
    });
    await updateBot(botId, { status: 'building', build_error: null });

    if (mode === 'full') {
      await vectorStore.deleteByBot(botId);
      await pool.query('DELETE FROM bot_pages WHERE bot_id = $1', [botId]);
      await pool.query(
        `UPDATE sources SET status = 'pending', error_message = NULL WHERE bot_id = $1`,
        [botId]
      );
    } else {
      const removed = await purgeOrphanedIndex(botId);
      if (removed > 0) {
        await updateJob(jobId, {
          message: `Removed ${removed} chunk(s) from deleted sources`,
        });
      }
    }

    // Process files/pastes before URLs so a bad scrape can't block local docs
    const { rows: sources } = await pool.query(
      `SELECT * FROM sources WHERE bot_id = $1
       ORDER BY
         CASE
           WHEN type IN ('pdf', 'txt', 'text') THEN 0
           WHEN type = 'url' AND scrape_mode = 'site' THEN 2
           ELSE 1
         END,
         created_at ASC`,
      [botId]
    );

    if (!sources.length) {
      throw new Error('Add at least one PDF or URL before building');
    }

    const embedder = getEmbedder();
    let done = 0;
    const failures = [];

    for (const source of sources) {
      const { rows: existingChunks } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM chunks WHERE source_id = $1',
        [source.id]
      );
      const hasChunks = (existingChunks[0]?.n || 0) > 0;

      // Site scrapes always re-run on adaptive so new pages can appear;
      // page/file sources can skip when unchanged & ready.
      const isSite = source.type === 'url' && source.scrape_mode === 'site';
      if (
        mode === 'adaptive' &&
        !isSite &&
        source.status === 'ready' &&
        hasChunks
      ) {
        done += 1;
        const progress = Math.round((done / sources.length) * 100);
        await updateJob(jobId, {
          progress,
          message: `Skipped unchanged: ${source.label}`,
        });
        continue;
      }

      await updateJob(jobId, {
        message: `Indexing: ${source.label}`,
        progress: Math.round((done / sources.length) * 90),
      });

      try {
        await processSource(source, embedder, async (info) => {
          await updateJob(jobId, {
            message: info.message || `Embedding ${source.label}`,
          });
        });
      } catch (err) {
        failures.push({ label: source.label, message: err.message });
        await pool.query(
          `UPDATE sources SET status = 'error', error_message = $2 WHERE id = $1`,
          [source.id, err.message]
        );
        await updateJob(jobId, {
          message: `Failed: ${source.label} — continuing with other sources`,
        });
      }

      done += 1;
      await updateJob(jobId, {
        progress: Math.round((done / sources.length) * 95),
        message: failures.length
          ? `Indexed ${done}/${sources.length} (${failures.length} failed)`
          : `Indexed: ${source.label}`,
      });
    }

    const chunkCount = await vectorStore.countByBot(botId);
    if (!chunkCount && failures.length) {
      throw new Error(
        `Build failed for all sources. First error: ${failures[0].label}: ${failures[0].message}`
      );
    }

    await updateBot(botId, {
      status: chunkCount > 0 ? 'ready' : 'error',
      chunk_count: chunkCount,
      last_built_at: new Date(),
      build_error: failures.length
        ? `${failures.length} source(s) failed: ${failures
            .map((f) => `${f.label} (${f.message})`)
            .join('; ')}`
        : null,
    });
    await updateJob(jobId, {
      status: chunkCount > 0 ? 'done' : 'error',
      progress: 100,
      message: failures.length
        ? `Done with ${chunkCount} chunks · ${failures.length} source(s) failed`
        : `Ready — ${chunkCount} chunks`,
      finished_at: new Date(),
    });
  } catch (err) {
    await updateBot(botId, {
      status: 'error',
      build_error: err.message,
    });
    await updateJob(jobId, {
      status: 'error',
      message: err.message,
      finished_at: new Date(),
    });
  } finally {
    running.delete(jobId);
  }
}

export { sha256 };
