import { createRemoteJWKSet, jwtVerify } from 'jose';
import { pool } from '../config.js';
import { env } from '../config.js';

let jwks;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

function usernameFromEmail(email, fallbackId) {
  const local = String(email || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  if (local.length >= 2) return local;
  return `user_${String(fallbackId || '').replace(/-/g, '').slice(0, 8)}`;
}

async function uniqueUsername(base) {
  let candidate = base.slice(0, 32);
  for (let i = 0; i < 20; i += 1) {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [
      candidate,
    ]);
    if (!rows[0]) return candidate;
    const suffix = `_${i + 1}`;
    candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
  }
  return `user_${Date.now().toString(36)}`;
}

async function upsertSupabaseUser({ sub, email }) {
  const { rows: existing } = await pool.query(
    'SELECT id, username, email, auth_provider_id, created_at FROM users WHERE auth_provider_id = $1',
    [sub]
  );
  if (existing[0]) {
    if (email && existing[0].email !== email) {
      await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, existing[0].id]);
      existing[0].email = email;
    }
    return existing[0];
  }

  const base = usernameFromEmail(email, sub);
  const username = await uniqueUsername(base);
  const { rows } = await pool.query(
    `INSERT INTO users (username, auth_provider_id, email)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, auth_provider_id, created_at`,
    [username, sub, email || null]
  );
  return rows[0];
}

async function verifyViaAuthApi(token) {
  const apikey = env.supabaseServiceRoleKey || env.supabaseAnonKey;
  if (!apikey) throw new Error('missing_supabase_key');

  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey,
    },
  });
  if (!res.ok) throw new Error(`auth_api_${res.status}`);
  const user = await res.json();
  const sub = String(user?.id || '');
  const email = typeof user?.email === 'string' ? user.email : '';
  if (!sub) throw new Error('invalid_token');
  return { sub, email };
}

export async function verifySupabaseAccessToken(token) {
  if (!env.supabaseUrl) {
    throw new Error('SUPABASE_URL is not configured');
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${env.supabaseUrl}/auth/v1`,
    });
    const sub = String(payload.sub || '');
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (!sub) throw new Error('invalid_token');
    return { sub, email };
  } catch {
    return verifyViaAuthApi(token);
  }
}

export async function resolveDevUser(request, reply) {
  const username = String(request.headers['x-dev-user'] || '')
    .trim()
    .toLowerCase();
  if (!username || username.length < 2) {
    return reply.code(401).send({ error: 'missing_user', message: 'Set X-Dev-User header' });
  }
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    return reply.code(400).send({
      error: 'invalid_username',
      message: 'Username must be 2–32 chars: a-z, 0-9, _ or -',
    });
  }

  const { rows } = await pool.query(
    `INSERT INTO users (username) VALUES ($1)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, email, auth_provider_id, created_at`,
    [username]
  );
  request.user = rows[0];
}

export async function resolveSupabaseUser(request, reply) {
  const header = String(request.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Missing Bearer token' });
  }
  const token = header.slice(7).trim();
  if (!token) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Missing Bearer token' });
  }

  try {
    const { sub, email } = await verifySupabaseAccessToken(token);
    request.user = await upsertSupabaseUser({ sub, email });
  } catch (err) {
    request.log?.warn?.({ err: err.message }, 'supabase_auth_failed');
    return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired session' });
  }
}

/** Dev username header locally; Supabase JWT when AUTH_MODE=supabase. */
export async function resolveUser(request, reply) {
  if (env.authMode === 'dev') {
    return resolveDevUser(request, reply);
  }
  return resolveSupabaseUser(request, reply);
}

export async function requireBotOwner(request, reply, botId) {
  const { rows } = await pool.query('SELECT * FROM bots WHERE id = $1', [botId]);
  const bot = rows[0];
  if (!bot) {
    reply.code(404).send({ error: 'not_found', message: 'Bot not found' });
    return null;
  }
  if (bot.owner_id !== request.user.id) {
    reply.code(403).send({ error: 'forbidden', message: 'Not your bot' });
    return null;
  }
  return bot;
}

export function mapBot(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    theme: row.theme,
    iconUrl: row.icon_url,
    systemPrompt: row.system_prompt,
    welcomeMessage: row.welcome_message,
    suggestedQuestions: (() => {
      const value = row.suggested_questions;
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
    })(),
    rules: (() => {
      const r = row.rules;
      if (Array.isArray(r)) return r;
      if (typeof r === 'string') {
        try {
          const parsed = JSON.parse(r);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    keyFacts: (() => {
      const f = row.key_facts;
      if (Array.isArray(f)) return f;
      if (typeof f === 'string') {
        try {
          const parsed = JSON.parse(f);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    personaGender: row.persona_gender || 'neutral',
    sourceCitations: (() => {
      const value = row.source_citations;
      if (value && typeof value === 'object') return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return { showSources: true, hideTypes: ['key_facts'] };
        }
      }
      return { showSources: true, hideTypes: ['key_facts'] };
    })(),
    buildError: row.build_error,
    lastBuiltAt: row.last_built_at,
    chunkCount: row.chunk_count,
    sourceCount:
      row.source_count !== undefined && row.source_count !== null
        ? Number(row.source_count)
        : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSource(row) {
  return {
    id: row.id,
    botId: row.bot_id,
    type: row.type,
    label: row.label,
    uri: row.uri,
    contentHash: row.content_hash,
    status: row.status,
    byteSize: row.byte_size,
    errorMessage: row.error_message,
    scrapeMode: row.scrape_mode || 'page',
    showInCitations: row.show_in_citations !== false,
    chunkCount: row.chunk_count || 0,
    createdAt: row.created_at,
  };
}

export function mapJob(row) {
  return {
    id: row.id,
    botId: row.bot_id,
    mode: row.mode,
    status: row.status,
    progress: row.progress,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}
