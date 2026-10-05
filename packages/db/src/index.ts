import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __cepPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__cepPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__cepPrisma = prisma;

/** Parse a JSON column, returning `fallback` on null/invalid. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function splitCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinCsv(values: Iterable<string>): string {
  return [...new Set([...values].map((s) => s.trim()).filter(Boolean))].join(',');
}
