import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { config } from '@cep/core';
import { prisma } from '@cep/db';

export const log = pino({
  level: config().LOG_LEVEL,
  base: { svc: process.env.CEP_SERVICE ?? 'cep' },
});

let connection: Redis | undefined;

export function redis(): Redis {
  if (!connection) {
    connection = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export const QUEUE = {
  dispatch: 'cep-dispatch',
  fanout: 'cep-fanout',
  cron: 'cep-cron',
} as const;

const queues = new Map<string, Queue>();

export function queue(name: (typeof QUEUE)[keyof typeof QUEUE]): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis() });
    queues.set(name, q);
  }
  return q;
}

export async function enqueueDispatch(messageId: string, priority = 5, delayMs = 0): Promise<void> {
  const opts: JobsOptions = {
    jobId: `m_${messageId}`,
    priority,
    delay: Math.max(0, delayMs),
    attempts: 4,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: 1000,
  };
  await queue(QUEUE.dispatch).add('dispatch', { messageId }, opts);
}

export async function audit(actor: string, action: string, entity: string, entityId?: string | null, detail?: unknown) {
  await prisma.auditLog.create({
    data: {
      actor,
      action,
      entity,
      entityId: entityId ?? null,
      detail: detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
    },
  });
}

export async function closeInfra(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await connection?.quit().catch(() => undefined);
  connection = undefined;
}

/** "Once per key per day" guard; returns the new count, or 0 if `max` was already reached. */
export async function bumpDailyMarker(key: string, day: string, max = 1): Promise<number> {
  const existing = await prisma.dailyMarker.findUnique({ where: { key_day: { key, day } } });
  if (!existing) {
    try {
      await prisma.dailyMarker.create({ data: { key, day, count: 1 } });
      return 1;
    } catch {
      return 0; // raced
    }
  }
  if (existing.count >= max) return 0;
  const updated = await prisma.dailyMarker.update({ where: { id: existing.id }, data: { count: { increment: 1 } } });
  return updated.count;
}
