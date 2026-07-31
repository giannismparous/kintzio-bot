import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  GeminiEmbedder,
  GeminiChatModel,
  FsObjectStore,
  SupabaseObjectStore,
  SimpleUrlFetcher,
  PgVectorStore,
} from '@kintzio/core';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/runMigrations.js';
import { recoverStaleBuildJobs } from './db/recoverStaleJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

dotenv.config({ path: path.join(rootDir, '.env') });

const authMode = (process.env.AUTH_MODE || 'dev').toLowerCase();
const storageMode = (process.env.STORAGE_MODE || 'local').toLowerCase();

export const env = {
  authMode: authMode === 'supabase' ? 'supabase' : 'dev',
  storageMode: storageMode === 'supabase' ? 'supabase' : 'local',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-flash-lite-latest',
  geminiEmbedDims: Number(process.env.GEMINI_EMBED_DIMS || 768),
  databaseUrl: process.env.DATABASE_URL || 'pglite:./data/pglite',
  apiPort: Number(process.env.PORT || process.env.API_PORT || 8787),
  apiHost: process.env.API_HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'data/uploads'),
  publicApiUrl: (
    process.env.PUBLIC_API_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:8787'
  ).replace(/\/$/, ''),
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'kintzio',
};

if (env.authMode === 'supabase' && !env.supabaseUrl) {
  console.warn('[config] AUTH_MODE=supabase but SUPABASE_URL is missing');
}
if (env.storageMode === 'supabase' && (!env.supabaseUrl || !env.supabaseServiceRoleKey)) {
  console.warn('[config] STORAGE_MODE=supabase but Supabase credentials are missing');
}

fs.mkdirSync(env.uploadDir, { recursive: true });

/** @type {import('pg').Pool | Awaited<ReturnType<typeof createPool>>} */
export let pool;

export let objectStore;

export let vectorStore;
export const urlFetcher = new SimpleUrlFetcher();

function createObjectStore() {
  if (env.storageMode === 'supabase') {
    const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseObjectStore({
      client,
      bucket: env.supabaseStorageBucket,
      publicBaseUrl: env.supabaseUrl,
    });
  }
  return new FsObjectStore({
    rootDir: env.uploadDir,
    publicBaseUrl: env.publicApiUrl,
  });
}

export async function initDb() {
  pool = await createPool(env.databaseUrl);
  await runMigrations(pool, { log: (msg) => console.log(msg) });
  await recoverStaleBuildJobs(pool);
  vectorStore = new PgVectorStore({ pool });
  objectStore = createObjectStore();
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end?.();
    pool = null;
    vectorStore = null;
    objectStore = null;
  }
}

export function getEmbedder() {
  return new GeminiEmbedder({
    apiKey: env.geminiApiKey,
    model: env.geminiEmbedModel,
    dimensions: env.geminiEmbedDims,
  });
}

export function getChatModel() {
  return new GeminiChatModel({
    apiKey: env.geminiApiKey,
    model: env.geminiChatModel,
  });
}
