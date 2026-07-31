import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_THEME,
  slugify,
  sha256,
  normalizeUrl,
  estimateTokens,
  urlDisplayLabel,
  fileDisplayLabel,
} from '@kintzio/core';
import { pool, objectStore, env, vectorStore, getEmbedder } from '../config.js';
import {
  resolveUser,
  requireBotOwner,
  mapBot,
  mapSource,
  mapJob,
} from '../services/auth.js';
import { enqueueBuild } from '../services/buildService.js';
import { answerBotChat } from '../services/chatService.js';
import { normalizeSourceCitations } from '../services/sourceCitations.js';
import { localizeBotUiCopy } from '../services/uiLocalizeService.js';

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeGender(value) {
  const g = String(value || 'neutral').toLowerCase();
  if (g === 'masculine' || g === 'feminine' || g === 'neutral') return g;
  return 'neutral';
}

async function markBotDirty(botId) {
  await pool.query(
    `UPDATE bots SET status = CASE WHEN status = 'ready' THEN 'draft' ELSE status END, updated_at = NOW() WHERE id = $1`,
    [botId]
  );
}

async function syncChunkCounts(botId, sourceId) {
  await pool.query(
    `UPDATE sources
     SET chunk_count = (SELECT COUNT(*)::int FROM chunks WHERE source_id = $1)
     WHERE id = $1`,
    [sourceId]
  );
  const chunkCount = await vectorStore.countByBot(botId);
  await pool.query(
    `UPDATE bots SET chunk_count = $2, updated_at = NOW() WHERE id = $1`,
    [botId, chunkCount]
  );
  return chunkCount;
}

async function insertSourceOrConflict(
  reply,
  botId,
  type,
  label,
  uri,
  contentHash,
  byteSize,
  scrapeMode = 'page'
) {
  const { rows: existing } = await pool.query(
    'SELECT * FROM sources WHERE bot_id = $1 AND content_hash = $2',
    [botId, contentHash]
  );
  if (existing.length) {
    return reply.code(409).send({
      error: 'duplicate_source',
      message: 'This source is already attached to the bot',
      source: mapSource(existing[0]),
    });
  }

  // Atomic page already indexed by a prior site/page scrape
  if (type === 'url' && scrapeMode === 'page') {
    const { rows: sameUri } = await pool.query(
      `SELECT id, label, scrape_mode FROM sources
       WHERE bot_id = $1 AND type = 'url' AND uri = $2`,
      [botId, uri]
    );
    if (sameUri[0]) {
      return reply.code(409).send({
        error: 'duplicate_source',
        message:
          sameUri[0].scrape_mode === 'site'
            ? 'This URL is already the seed of a full-site scrape on this bot'
            : 'This exact page URL is already attached to the bot',
      });
    }

    const { rows: pages } = await pool.query(
      'SELECT page_url, source_id FROM bot_pages WHERE bot_id = $1 AND page_url = $2',
      [botId, uri]
    );
    if (pages[0]) {
      return reply.code(409).send({
        error: 'duplicate_page',
        message: `This page is already indexed by another source (${pages[0].page_url})`,
      });
    }
  }

  // Only one full-site scrape per origin
  if (type === 'url' && scrapeMode === 'site') {
    let origin;
    try {
      origin = new URL(uri).origin;
    } catch {
      origin = uri;
    }
    const { rows: sites } = await pool.query(
      `SELECT id, uri, label FROM sources
       WHERE bot_id = $1 AND type = 'url' AND scrape_mode = 'site'`,
      [botId]
    );
    const clash = sites.find((s) => {
      try {
        return new URL(s.uri).origin === origin;
      } catch {
        return false;
      }
    });
    if (clash) {
      return reply.code(409).send({
        error: 'duplicate_site_scrape',
        message: `A full-site scrape for this domain already exists (${clash.label || clash.uri})`,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO sources (bot_id, type, label, uri, content_hash, status, byte_size, scrape_mode)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     RETURNING *`,
    [botId, type, label, uri, contentHash, byteSize, scrapeMode]
  );
  await markBotDirty(botId);
  return { source: mapSource(rows[0]) };
}

async function uniqueSlug(ownerId, baseName) {
  let base = slugify(baseName);
  let candidate = base;
  let i = 2;
  while (true) {
    const { rows } = await pool.query(
      'SELECT 1 FROM bots WHERE owner_id = $1 AND slug = $2',
      [ownerId, candidate]
    );
    if (!rows.length) return candidate;
    candidate = `${base}-${i}`;
    i += 1;
  }
}

export default async function botRoutes(fastify) {
  fastify.addHook('preHandler', resolveUser);

  fastify.get('/bots', async (request) => {
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM sources s WHERE s.bot_id = b.id) AS source_count
       FROM bots b
       WHERE b.owner_id = $1
       ORDER BY b.updated_at DESC`,
      [request.user.id]
    );
    return { bots: rows.map(mapBot) };
  });

  fastify.post('/bots', async (request, reply) => {
    const name = String(request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'name_required' });

    const { rows: dup } = await pool.query(
      'SELECT 1 FROM bots WHERE owner_id = $1 AND lower(name) = lower($2)',
      [request.user.id, name]
    );
    if (dup.length) {
      return reply.code(409).send({
        error: 'duplicate_name',
        message: 'You already have a bot with this name',
      });
    }

    const slug = await uniqueSlug(request.user.id, name);
    const theme = { ...DEFAULT_THEME, ...(request.body?.theme || {}) };
    const systemPrompt =
      request.body?.systemPrompt !== undefined
        ? String(request.body.systemPrompt)
        : '';
    const welcomeMessage =
      request.body?.welcomeMessage !== undefined
        ? String(request.body.welcomeMessage)
        : '';
    const suggestedQuestions = Array.isArray(request.body?.suggestedQuestions)
      ? request.body.suggestedQuestions
      : [];
    const rules = Array.isArray(request.body?.rules) ? request.body.rules : [];
    const personaGender = normalizeGender(request.body?.personaGender ?? 'neutral');

    const { rows } = await pool.query(
      `INSERT INTO bots (owner_id, name, slug, theme, system_prompt, welcome_message, suggested_questions, rules, persona_gender, key_facts, source_citations)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11::jsonb)
       RETURNING *`,
      [
        request.user.id,
        name,
        slug,
        JSON.stringify(theme),
        systemPrompt,
        welcomeMessage,
        JSON.stringify(suggestedQuestions),
        JSON.stringify(rules),
        personaGender,
        JSON.stringify(
          Array.isArray(request.body?.keyFacts) ? request.body.keyFacts : []
        ),
        JSON.stringify(
          normalizeSourceCitations(request.body?.sourceCitations)
        ),
      ]
    );
    return { bot: mapBot(rows[0]) };
  });

  fastify.get('/bots/:id', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const { rows: sources } = await pool.query(
      'SELECT * FROM sources WHERE bot_id = $1 ORDER BY created_at ASC',
      [bot.id]
    );
    const { rows: jobs } = await pool.query(
      'SELECT * FROM build_jobs WHERE bot_id = $1 ORDER BY created_at DESC LIMIT 5',
      [bot.id]
    );
    return {
      bot: mapBot(bot),
      sources: sources.map(mapSource),
      jobs: jobs.map(mapJob),
    };
  });

  fastify.patch('/bots/:id', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const body = request.body || {};

    if (body.name && body.name.trim() !== bot.name) {
      const { rows: dup } = await pool.query(
        'SELECT 1 FROM bots WHERE owner_id = $1 AND lower(name) = lower($2) AND id <> $3',
        [request.user.id, body.name.trim(), bot.id]
      );
      if (dup.length) {
        return reply.code(409).send({
          error: 'duplicate_name',
          message: 'You already have a bot with this name',
        });
      }
    }

    const nextName = body.name?.trim() || bot.name;
    const nextSlug =
      body.name && body.name.trim() !== bot.name
        ? await uniqueSlug(request.user.id, nextName)
        : bot.slug;

    const theme = body.theme
      ? { ...DEFAULT_THEME, ...(bot.theme || {}), ...body.theme }
      : bot.theme;
    const sourceCitations =
      body.sourceCitations !== undefined
        ? normalizeSourceCitations(body.sourceCitations)
        : bot.source_citations;

    const { rows } = await pool.query(
      `UPDATE bots SET
         name = $2,
         slug = $3,
         theme = $4::jsonb,
         icon_url = COALESCE($5, icon_url),
         system_prompt = COALESCE($6, system_prompt),
         welcome_message = COALESCE($7, welcome_message),
         suggested_questions = COALESCE($8::jsonb, suggested_questions),
         persona_gender = COALESCE($9, persona_gender),
         rules = COALESCE($10::jsonb, rules),
         key_facts = COALESCE($11::jsonb, key_facts),
         source_citations = $12::jsonb,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        bot.id,
        nextName,
        nextSlug,
        JSON.stringify(theme),
        body.iconUrl === undefined ? null : body.iconUrl,
        body.systemPrompt === undefined ? null : body.systemPrompt,
        body.welcomeMessage === undefined ? null : body.welcomeMessage,
        body.suggestedQuestions
          ? JSON.stringify(body.suggestedQuestions)
          : null,
        body.personaGender === undefined
          ? null
          : normalizeGender(body.personaGender),
        body.rules !== undefined ? JSON.stringify(body.rules) : null,
        body.keyFacts !== undefined ? JSON.stringify(body.keyFacts) : null,
        JSON.stringify(sourceCitations),
      ]
    );
    return { bot: mapBot(rows[0]) };
  });

  fastify.delete('/bots/:id', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    await pool.query('DELETE FROM bots WHERE id = $1', [bot.id]);
    return { ok: true };
  });

  fastify.post('/bots/:id/duplicate', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;

    let baseName = `${bot.name} copy`;
    let n = 2;
    while (true) {
      const { rows: dup } = await pool.query(
        'SELECT 1 FROM bots WHERE owner_id = $1 AND lower(name) = lower($2)',
        [request.user.id, baseName]
      );
      if (!dup.length) break;
      baseName = `${bot.name} copy ${n}`;
      n += 1;
    }

    const slug = await uniqueSlug(request.user.id, baseName);
    const { rows } = await pool.query(
      `INSERT INTO bots (owner_id, name, slug, theme, icon_url, system_prompt, welcome_message, suggested_questions, rules, persona_gender, key_facts, source_citations, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12::jsonb, 'draft')
       RETURNING *`,
      [
        request.user.id,
        baseName,
        slug,
        JSON.stringify(bot.theme),
        bot.icon_url,
        bot.system_prompt,
        bot.welcome_message,
        JSON.stringify(bot.suggested_questions),
        JSON.stringify(bot.rules || []),
        bot.persona_gender || 'neutral',
        JSON.stringify(bot.key_facts || []),
        JSON.stringify(bot.source_citations || { showSources: true, hideTypes: ['key_facts'] }),
      ]
    );
    const newBot = rows[0];

    const { rows: sources } = await pool.query(
      'SELECT * FROM sources WHERE bot_id = $1',
      [bot.id]
    );
    for (const s of sources) {
      let newUri = s.uri;
      let newHash = s.content_hash;
      if ((s.type === 'pdf' || s.type === 'txt' || s.type === 'text') && s.uri?.startsWith('/files/')) {
        const oldKey = s.uri.replace(/^\/files\//, '');
        try {
          const buf = await objectStore.get(oldKey);
          const newKey = `${newBot.id}/${uuidv4()}-${s.label}`;
          await objectStore.put(newKey, buf);
          newUri = `/files/${newKey}`;
          newHash = sha256(buf);
        } catch {
          continue;
        }
      }
      try {
        await pool.query(
          `INSERT INTO sources (bot_id, type, label, uri, content_hash, status, byte_size, scrape_mode, show_in_citations)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
           ON CONFLICT (bot_id, content_hash) DO NOTHING`,
          [
            newBot.id,
            s.type,
            s.label,
            newUri,
            newHash,
            s.byte_size,
            s.scrape_mode || 'page',
            s.show_in_citations !== false,
          ]
        );
      } catch {
        /* skip dup */
      }
    }

    return { bot: mapBot(newBot) };
  });

  fastify.post('/bots/:id/sources/upload', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'file_required' });

    const buf = await file.toBuffer();
    const label = file.filename || 'document';
    const lower = label.toLowerCase();
    let type = null;
    if (lower.endsWith('.pdf')) type = 'pdf';
    else if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown'))
      type = 'txt';
    else {
      return reply.code(400).send({
        error: 'unsupported_file',
        message: 'Supported uploads: PDF, TXT, MD',
      });
    }

    const contentHash = sha256(buf);
    const key = `${bot.id}/${uuidv4()}-${label}`;
    await objectStore.put(key, buf, file.mimetype || 'application/octet-stream');
    const uri = `/files/${key}`;
    return insertSourceOrConflict(reply, bot.id, type, label, uri, contentHash, buf.length);
  });

  fastify.post('/bots/:id/sources/text', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const text = String(request.body?.text || '').trim();
    if (text.length < 20) {
      return reply.code(400).send({
        error: 'text_too_short',
        message: 'Paste at least ~20 characters of text',
      });
    }
    const label =
      String(request.body?.label || '').trim() ||
      `Pasted text ${new Date().toISOString().slice(0, 16)}`;
    const contentHash = sha256(text);
    const key = `${bot.id}/${uuidv4()}-paste.txt`;
    const buf = Buffer.from(text, 'utf8');
    await objectStore.put(key, buf, 'text/plain');
    const uri = `/files/${key}`;
    return insertSourceOrConflict(reply, bot.id, 'text', label, uri, contentHash, buf.length);
  });

  fastify.post('/bots/:id/sources/url', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    let url;
    try {
      url = normalizeUrl(request.body?.url);
    } catch {
      return reply.code(400).send({ error: 'invalid_url' });
    }

    const scrapeMode = request.body?.scrapeMode === 'site' ? 'site' : 'page';
    // Hash includes mode so same URL can exist once as page and once as site? 
    // Prefer forbidding: same URL seed only once regardless of mode.
    const contentHash = sha256(`${scrapeMode}:${url}`);
    const label = request.body?.label || urlDisplayLabel(url);
    return insertSourceOrConflict(
      reply,
      bot.id,
      'url',
      label,
      url,
      contentHash,
      0,
      scrapeMode
    );
  });

  fastify.patch('/bots/:id/sources/:sourceId', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const { rows } = await pool.query(
      'SELECT * FROM sources WHERE id = $1 AND bot_id = $2',
      [request.params.sourceId, bot.id]
    );
    const source = rows[0];
    if (!source) return reply.code(404).send({ error: 'not_found' });

    if (request.body?.showInCitations !== undefined) {
      const showInCitations = Boolean(request.body.showInCitations);
      const { rows: updated } = await pool.query(
        `UPDATE sources SET show_in_citations = $2 WHERE id = $1 RETURNING *`,
        [source.id, showInCitations]
      );
      return { source: mapSource(updated[0]) };
    }

    if (source.type !== 'url') {
      return reply.code(400).send({ error: 'scrape_mode_url_only' });
    }

    const scrapeMode = request.body?.scrapeMode === 'site' ? 'site' : 'page';
    if (scrapeMode === source.scrape_mode) {
      return { source: mapSource(source) };
    }

    if (scrapeMode === 'site') {
      let origin;
      try {
        origin = new URL(source.uri).origin;
      } catch {
        origin = source.uri;
      }
      const { rows: sites } = await pool.query(
        `SELECT id, uri, label FROM sources
         WHERE bot_id = $1 AND type = 'url' AND scrape_mode = 'site' AND id <> $2`,
        [bot.id, source.id]
      );
      const clash = sites.find((s) => {
        try {
          return new URL(s.uri).origin === origin;
        } catch {
          return false;
        }
      });
      if (clash) {
        return reply.code(409).send({
          error: 'duplicate_site_scrape',
          message: `A full-site scrape for this domain already exists (${clash.label || clash.uri})`,
        });
      }
    }

    const contentHash = sha256(`${scrapeMode}:${source.uri}`);
    const { rows: hashClash } = await pool.query(
      'SELECT id FROM sources WHERE bot_id = $1 AND content_hash = $2 AND id <> $3',
      [bot.id, contentHash, source.id]
    );
    if (hashClash[0]) {
      return reply.code(409).send({
        error: 'duplicate_source',
        message: 'Another source already uses this URL mode combination',
      });
    }

    const label = urlDisplayLabel(source.uri) || source.label || source.uri;

    const { rows: updated } = await pool.query(
      `UPDATE sources
       SET scrape_mode = $2, content_hash = $3, label = $4, status = 'pending', error_message = NULL
       WHERE id = $1
       RETURNING *`,
      [source.id, scrapeMode, contentHash, label]
    );
    await markBotDirty(bot.id);
    return { source: mapSource(updated[0]) };
  });

  fastify.delete('/bots/:id/sources/:sourceId', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;

    const sourceId = request.params.sourceId;
    const { rows } = await pool.query(
      `SELECT id FROM sources WHERE id = $1 AND bot_id = $2`,
      [sourceId, bot.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'source_not_found' });

    await vectorStore.deleteBySource(sourceId);
    await pool.query('DELETE FROM bot_pages WHERE source_id = $1', [sourceId]);
    await pool.query('DELETE FROM sources WHERE id = $1 AND bot_id = $2', [
      sourceId,
      bot.id,
    ]);

    const chunkCount = await vectorStore.countByBot(bot.id);
    await pool.query(
      `UPDATE bots
       SET chunk_count = $2,
           status = CASE WHEN status = 'ready' THEN 'draft' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [bot.id, chunkCount]
    );
    return { ok: true, chunkCount };
  });

  fastify.post('/bots/:id/icon', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'file_required' });
    const buf = await file.toBuffer();
    const key = `${bot.id}/icon.png`;
    await objectStore.put(key, buf, 'image/png');
    const iconUrl = `${objectStore.publicUrl(key)}?v=${Date.now()}`;
    const { rows } = await pool.query(
      `UPDATE bots SET icon_url = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [bot.id, iconUrl]
    );
    return { bot: mapBot(rows[0]) };
  });

  fastify.delete('/bots/:id/icon', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    try {
      await objectStore.delete?.(`${bot.id}/icon.png`);
    } catch {
      /* optional */
    }
    const { rows } = await pool.query(
      `UPDATE bots SET icon_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [bot.id]
    );
    return { bot: mapBot(rows[0]) };
  });

  fastify.post('/bots/:id/build', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const mode = request.body?.mode === 'full' ? 'full' : 'adaptive';
    const job = await enqueueBuild(bot.id, mode);
    return { job: mapJob(job) };
  });

  fastify.get('/bots/:id/build/:jobId', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const { rows } = await pool.query(
      'SELECT * FROM build_jobs WHERE id = $1 AND bot_id = $2',
      [request.params.jobId, bot.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'job_not_found' });
    const { rows: botRows } = await pool.query('SELECT * FROM bots WHERE id = $1', [
      bot.id,
    ]);
    const { rows: sources } = await pool.query(
      'SELECT * FROM sources WHERE bot_id = $1 ORDER BY created_at ASC',
      [bot.id]
    );
    return {
      job: mapJob(rows[0]),
      bot: mapBot(botRows[0]),
      sources: sources.map(mapSource),
    };
  });

  fastify.get('/bots/:id/chunks', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const sourceId = request.query?.sourceId || null;
    const limit = Math.min(Math.max(Number(request.query?.limit) || 500, 1), 500);
    const offset = Math.max(Number(request.query?.offset) || 0, 0);

    const params = [bot.id];
    let where = 'c.bot_id = $1';
    if (sourceId) {
      params.push(sourceId);
      where += ` AND c.source_id = $${params.length}`;
    }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT c.id, c.source_id AS "sourceId", c.ordinal, c.content,
              c.token_estimate AS "tokenEstimate", c.page_url AS "pageUrl",
              s.label AS "sourceLabel", s.type AS "sourceType", s.uri AS "sourceUri"
       FROM chunks c
       JOIN sources s ON s.id = c.source_id
       WHERE ${where}
       ORDER BY s.created_at ASC, c.ordinal ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: counts } = await pool.query(
      `SELECT s.id AS "sourceId", s.label, s.type, s.uri, s.chunk_count AS "chunkCount",
              COUNT(c.id)::int AS "storedChunks"
       FROM sources s
       LEFT JOIN chunks c ON c.source_id = s.id
       WHERE s.bot_id = $1
       GROUP BY s.id
       ORDER BY s.created_at ASC`,
      [bot.id]
    );

    return {
      chunks: rows,
      bySource: counts,
      total: counts.reduce((n, r) => n + (r.storedChunks || 0), 0),
    };
  });

  fastify.patch('/bots/:id/chunks/:chunkId', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    const content = String(request.body?.content || '').trim();
    if (content.length < 20) {
      return reply.code(400).send({ error: 'content_too_short', message: 'Chunk needs at least 20 characters' });
    }

    const { rows } = await pool.query(
      `SELECT c.id, c.source_id AS "sourceId"
       FROM chunks c
       WHERE c.id = $1 AND c.bot_id = $2`,
      [request.params.chunkId, bot.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'chunk_not_found' });

    const embedder = getEmbedder();
    const [embedding] = await embedder.embedDocuments([content]);

    await pool.query(
      `UPDATE chunks
       SET content = $2,
           token_estimate = $3,
           content_hash = $4,
           embedding = $5::vector
       WHERE id = $1`,
      [
        rows[0].id,
        content,
        estimateTokens(content),
        sha256(content),
        vectorStore.toVectorLiteral(embedding),
      ]
    );

    const chunkCount = await syncChunkCounts(bot.id, rows[0].sourceId);
    return { ok: true, chunkCount };
  });

  fastify.delete('/bots/:id/chunks/:chunkId', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;

    const { rows } = await pool.query(
      `SELECT c.id, c.source_id AS "sourceId"
       FROM chunks c
       WHERE c.id = $1 AND c.bot_id = $2`,
      [request.params.chunkId, bot.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'chunk_not_found' });

    await pool.query('DELETE FROM chunks WHERE id = $1', [rows[0].id]);
    const chunkCount = await syncChunkCounts(bot.id, rows[0].sourceId);
    await markBotDirty(bot.id);
    return { ok: true, chunkCount };
  });

  fastify.delete('/bots/:id/sources/:sourceId/chunks', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;

    const { rows } = await pool.query(
      `SELECT id FROM sources WHERE id = $1 AND bot_id = $2`,
      [request.params.sourceId, bot.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'source_not_found' });

    await vectorStore.deleteBySource(request.params.sourceId);
    await pool.query(
      `UPDATE sources SET chunk_count = 0, status = 'pending', error_message = NULL WHERE id = $1`,
      [request.params.sourceId]
    );
    const chunkCount = await syncChunkCounts(bot.id, request.params.sourceId);
    await markBotDirty(bot.id);
    return { ok: true, chunkCount };
  });

  fastify.post('/bots/:id/chat', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    try {
      const result = await answerBotChat(bot.id, request.body?.message, {
        history: request.body?.history || [],
        language: request.body?.language,
      });
      return result;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({
        error: 'chat_failed',
        message: err.message,
      });
    }
  });

  fastify.post('/bots/:id/localize-ui', async (request, reply) => {
    const bot = await requireBotOwner(request, reply, request.params.id);
    if (!bot) return;
    try {
      const language = request.body?.language === 'el' ? 'el' : 'en';
      const welcomeMessage = bot.welcome_message || '';
      const suggestedQuestions = parseJsonArray(bot.suggested_questions);
      const result = await localizeBotUiCopy({
        welcomeMessage,
        suggestedQuestions,
        language,
        botName: bot.name,
      });
      return result;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({
        error: 'localize_failed',
        message: err.message,
      });
    }
  });
}
