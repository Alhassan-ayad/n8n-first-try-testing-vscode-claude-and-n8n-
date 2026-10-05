// HTTP API: admin console API, client API (mngm backend), provider webhooks,
// unsubscribe pages, health and OpenAPI docs at /docs.

import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError } from 'fastify';
import { config } from '@cep/core';
import { prisma } from '@cep/db';
import { log, redis } from '@cep/engine';
import { HttpError } from './http';
import { adminContentRoutes } from './routes/admin-content';
import { adminCoreRoutes } from './routes/admin-core';
import { adminRegisterRoutes } from './routes/admin-registers';
import { clientRoutes } from './routes/client';
import { webhookRoutes } from './routes/webhooks';

export async function buildServer() {
  const c = config();
  const app = Fastify({ loggerInstance: log, bodyLimit: 5 * 1024 * 1024, trustProxy: true, routerOptions: { maxParamLength: 512 } });

  // Keep the raw body: SendGrid signatures and client HMAC are computed over it.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = raw;
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      (err as FastifyError).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(formbody);
  await app.register(jwt, { secret: c.ADMIN_JWT_SECRET });
  await app.register(swagger, {
    openapi: {
      info: { title: 'mngm Client Engagement Platform API', version: '1.0.0' },
      components: {
        securitySchemes: {
          adminJwt: { type: 'http', scheme: 'bearer' },
          clientHmac: { type: 'apiKey', in: 'header', name: 'x-cep-signature' },
        },
      },
      tags: [
        { name: 'client', description: 'Called by the mngm backend (HMAC signed)' },
        { name: 'admin', description: 'Admin console (JWT)' },
        { name: 'webhooks', description: 'Provider callbacks' },
        { name: 'public', description: 'Unsubscribe pages' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const name = (err as { name?: string }).name;
    const code = (err as { code?: string }).code;
    if (name === 'NotFoundError' || code === 'P2025') return reply.code(404).send({ error: 'Not found' });
    if (code === 'P2002') return reply.code(409).send({ error: 'Already exists' });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Internal error' : err.message });
  });

  app.get('/health', { schema: { tags: ['public'] } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch (e) {
      checks.db = (e as Error).message;
    }
    try {
      checks.redis = (await redis().ping()) === 'PONG' ? 'ok' : 'down';
    } catch (e) {
      checks.redis = (e as Error).message;
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', providerMode: c.PROVIDER_MODE, checks });
  });

  app.get('/metrics', { schema: { tags: ['public'] } }, async (_req, reply) => {
    const rows = await prisma.message.groupBy({ by: ['channel', 'status'], _count: { _all: true } });
    const lines = ['# TYPE cep_messages_total gauge'];
    for (const r of rows) lines.push(`cep_messages_total{channel="${r.channel}",status="${r.status}"} ${r._count._all}`);
    const pendingEvents = await prisma.eventLog.count({ where: { processedAt: null } });
    lines.push('# TYPE cep_events_unprocessed gauge', `cep_events_unprocessed ${pendingEvents}`);
    return reply.type('text/plain').send(`${lines.join('\n')}\n`);
  });

  await app.register(webhookRoutes);
  await app.register(clientRoutes);
  await app.register(adminCoreRoutes);
  await app.register(adminContentRoutes);
  await app.register(adminRegisterRoutes);

  return app;
}

if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  const app = await buildServer();
  const port = config().API_PORT;
  await app.listen({ port, host: '0.0.0.0' });
  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
