import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env, initDb, closeDb, pool } from './config.js';
import { closeBrowser } from '@kintzio/core';
import publicRoutes from './routes/public.js';
import { initStaticBotStore } from './services/staticBotStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../web/dist');

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024,
});

const staticMode = Boolean(env.staticBotBundle);
if (staticMode) {
  await initStaticBotStore(env.staticBotBundle);
} else {
  await initDb();
}

const corsOptions =
  env.authMode === 'dev'
    ? {
        origin: true,
        allowedHeaders: [
          'Content-Type',
          'X-Dev-User',
          'X-Admin-Key',
          'Authorization',
        ],
      }
    : {
        origin: (origin, cb) => {
          const allowed = String(env.corsOrigin || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (!origin || allowed.includes(origin)) {
            cb(null, true);
            return;
          }
          cb(null, false);
        },
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
      };

await app.register(cors, corsOptions);

if (!staticMode) {
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });
}

app.addHook('onRequest', async (request, reply) => {
  if (process.env.NODE_ENV !== 'production') return;
  const protectedPath =
    request.url === '/auth' ||
    request.url.startsWith('/auth/') ||
    request.url === '/bots' ||
    request.url.startsWith('/bots/');
  if (!protectedPath) return;
  if (!env.adminApiKey) {
    return reply.code(503).send({ error: 'admin_disabled' });
  }
  if (request.headers['x-admin-key'] !== env.adminApiKey) {
    return reply.code(401).send({ error: 'admin_unauthorized' });
  }
});

if (!staticMode && env.storageMode === 'local') {
  await app.register(fastifyStatic, {
    root: env.uploadDir,
    prefix: '/files/',
    decorateReply: false,
  });
}

app.get('/health', async () => ({
  ok: true,
  mode: staticMode ? 'static-bundle' : 'database',
  authMode: env.authMode,
  storageMode: env.storageMode,
}));

if (!staticMode) {
  const [{ default: authRoutes }, { default: botRoutes }] = await Promise.all([
    import('./routes/auth.js'),
    import('./routes/bots.js'),
  ]);
  await app.register(authRoutes);
  await app.register(botRoutes);
}
await app.register(publicRoutes);

if (fs.existsSync(path.join(webDistDir, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      String(request.headers.accept || '').includes('text/html')
    ) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}

if (!staticMode) {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    app.log.error('Database not reachable.');
    app.log.error(err.message);
    process.exit(1);
  }
}

await app.listen({ port: env.apiPort, host: env.apiHost });
console.log(`Kintzio API on http://localhost:${env.apiPort} (${env.authMode})`);

async function shutdown() {
  await closeBrowser().catch(() => {});
  await app.close().catch(() => {});
  if (!staticMode) await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
