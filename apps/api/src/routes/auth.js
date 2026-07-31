import { env } from '../config.js';
import { resolveDevUser, resolveUser } from '../services/auth.js';

export default async function authRoutes(fastify) {
  if (env.authMode === 'dev') {
    fastify.post('/auth/dev-login', async (request, reply) => {
      const username = String(request.body?.username || '')
        .trim()
        .toLowerCase();
      if (!username) {
        return reply.code(400).send({ error: 'username_required' });
      }
      request.headers['x-dev-user'] = username;
      await resolveDevUser(request, reply);
      if (reply.sent) return;
      return { user: request.user, mode: 'dev' };
    });
  }

  fastify.get('/auth/me', { preHandler: resolveUser }, async (request) => {
    return { user: request.user, mode: env.authMode };
  });

  fastify.get('/auth/config', async () => ({
    mode: env.authMode,
    supabaseUrl: env.authMode === 'supabase' ? env.supabaseUrl : null,
  }));
}
