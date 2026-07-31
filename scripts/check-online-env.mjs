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
const isOnline = env.NODE_ENV === 'production' || Boolean(env.STATIC_BOT_BUNDLE);

const required = ['GEMINI_API_KEY'];
const onlineRequired = ['STATIC_BOT_BUNDLE'];

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

console.log('\nKintzio online check\n');

for (const key of required) need(key);

if (isOnline) {
  console.log('\nSingle-service Render deploy:');
  for (const key of onlineRequired) need(key);

  const bundlePath = path.resolve(root, env.STATIC_BOT_BUNDLE || '');
  if (!env.STATIC_BOT_BUNDLE || !fs.existsSync(bundlePath)) {
    console.log('✗ STATIC_BOT_BUNDLE — bundle file does not exist');
    ok = false;
  } else {
    console.log('✓ static bot bundle exists');
  }
} else {
  console.log('\nLocal dev mode — online vars optional.');
  console.log('Copy .env.online.example → .env when you are ready to deploy.');
}

console.log(ok ? '\nReady for online deploy.\n' : '\nFix the items above, then re-run npm run check:online\n');
process.exit(ok ? 0 : 1);
