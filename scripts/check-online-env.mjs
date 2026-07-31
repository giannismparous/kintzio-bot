#!/usr/bin/env node
/**
 * Quick sanity check before deploying online.
 * Run: npm run check:online
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.online.example');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

const env = { ...loadEnvFile(examplePath), ...loadEnvFile(envPath) };
const authMode = (env.AUTH_MODE || 'dev').toLowerCase();
const storageMode = (env.STORAGE_MODE || 'local').toLowerCase();
const isOnline = env.NODE_ENV === 'production' || Boolean(env.KINTZIO_DATA_DIR);

const required = ['GEMINI_API_KEY'];
const onlineRequired = [
  'DATABASE_URL',
  'UPLOAD_DIR',
  'KINTZIO_DATA_DIR',
  'ADMIN_API_KEY',
];

let ok = true;

function need(key) {
  const value = env[key];
  if (!value || value.includes('your_') || value.includes('replace_me')) {
    console.log(`✗ ${key} — missing or still placeholder`);
    ok = false;
    return;
  }
  console.log(`✓ ${key}`);
}

console.log(`\nKintzio online check (AUTH_MODE=${authMode}, STORAGE_MODE=${storageMode})\n`);

for (const key of required) need(key);

if (isOnline) {
  console.log('\nSingle-service Render deploy:');
  for (const key of onlineRequired) need(key);

  if (!env.DATABASE_URL?.startsWith('pglite:/var/data/')) {
    console.log('✗ DATABASE_URL — production PGlite must live under /var/data');
    ok = false;
  } else {
    console.log('✓ DATABASE_URL uses the persistent disk');
  }

  if (!String(env.UPLOAD_DIR || '').startsWith('/var/data/')) {
    console.log('✗ UPLOAD_DIR — production uploads must live under /var/data');
    ok = false;
  } else {
    console.log('✓ UPLOAD_DIR uses the persistent disk');
  }
} else {
  console.log('\nLocal dev mode — online vars optional.');
  console.log('Copy .env.online.example → .env when you are ready to deploy.');
}

console.log(ok ? '\nReady for online deploy.\n' : '\nFix the items above, then re-run npm run check:online\n');
process.exit(ok ? 0 : 1);
