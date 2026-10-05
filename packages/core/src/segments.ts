// Segment filter DSL (plan §3). Stored as JSON on Segment / Campaign rows and
// translated to a Prisma `where` by the engine. Also evaluable in memory.

import { z } from 'zod';
import type { ClientFacts } from './types';

export const segmentFilterSchema = z.object({
  stages: z.array(z.string()).optional(),
  tiers: z.array(z.string()).optional(),
  /** Client has at least one of these tags. */
  tagsAny: z.array(z.string()).optional(),
  /** Client has all of these tags. */
  tagsAll: z.array(z.string()).optional(),
  /** Client has none of these tags. */
  tagsNone: z.array(z.string()).optional(),
  language: z.enum(['ar', 'en']).optional(),
  sources: z.array(z.string()).optional(),
  kycStatus: z.array(z.string()).optional(),
  minOrders: z.number().int().optional(),
  maxOrders: z.number().int().optional(),
  hasRecurringPlan: z.boolean().optional(),
  holdsMetal: z.enum(['gold', 'silver', 'any']).optional(),
  minHoldingValue: z.number().optional(),
  maxHoldingValue: z.number().optional(),
  /** Last order at least N days ago (or never). */
  inactiveDays: z.number().int().optional(),
  /** Registered at least N days ago. */
  registeredDaysAgoMin: z.number().int().optional(),
  registeredDaysAgoMax: z.number().int().optional(),
  externalIds: z.array(z.string()).optional(),
});

export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

const DAY = 86_400_000;

export function matchesSegment(c: ClientFacts, f: SegmentFilter, now = new Date()): boolean {
  if (f.stages?.length && !f.stages.includes(c.lifecycleStage)) return false;
  if (f.tiers?.length && !f.tiers.includes(c.valueTier)) return false;
  if (f.tagsAny?.length && !f.tagsAny.some((t) => c.tags.includes(t))) return false;
  if (f.tagsAll?.length && !f.tagsAll.every((t) => c.tags.includes(t))) return false;
  if (f.tagsNone?.length && f.tagsNone.some((t) => c.tags.includes(t))) return false;
  if (f.language && c.language !== f.language) return false;
  if (f.sources?.length && !f.sources.includes(c.source)) return false;
  if (f.kycStatus?.length && !f.kycStatus.includes(c.kycStatus)) return false;
  if (f.minOrders !== undefined && c.orderCount < f.minOrders) return false;
  if (f.maxOrders !== undefined && c.orderCount > f.maxOrders) return false;
  if (f.hasRecurringPlan !== undefined && c.hasRecurringPlan !== f.hasRecurringPlan) return false;
  if (f.holdsMetal === 'gold' && c.goldGrams <= 0) return false;
  if (f.holdsMetal === 'silver' && c.silverGrams <= 0) return false;
  if (f.holdsMetal === 'any' && c.goldGrams + c.silverGrams <= 0) return false;
  if (f.minHoldingValue !== undefined && c.holdingValueEgp < f.minHoldingValue) return false;
  if (f.maxHoldingValue !== undefined && c.holdingValueEgp > f.maxHoldingValue) return false;
  if (f.inactiveDays !== undefined && c.lastOrderAt && now.getTime() - c.lastOrderAt.getTime() < f.inactiveDays * DAY)
    return false;
  if (f.registeredDaysAgoMin !== undefined && now.getTime() - c.registeredAt.getTime() < f.registeredDaysAgoMin * DAY)
    return false;
  if (f.registeredDaysAgoMax !== undefined && now.getTime() - c.registeredAt.getTime() > f.registeredDaysAgoMax * DAY)
    return false;
  if (f.externalIds?.length && !f.externalIds.includes(c.externalId)) return false;
  return true;
}

/** Translate to a Prisma `ClientWhereInput`-shaped object (kept untyped to avoid a db dependency). */
export function segmentToWhere(f: SegmentFilter, now = new Date()): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ closedAt: null }];
  if (f.stages?.length) and.push({ lifecycleStage: { in: f.stages } });
  if (f.tiers?.length) and.push({ valueTier: { in: f.tiers } });
  // tags are stored as ",a,b," style csv without padding; match on token boundaries
  const tagCond = (t: string) => ({
    OR: [{ tags: t }, { tags: { startsWith: `${t},` } }, { tags: { endsWith: `,${t}` } }, { tags: { contains: `,${t},` } }],
  });
  if (f.tagsAny?.length) and.push({ OR: f.tagsAny.map(tagCond) });
  if (f.tagsAll?.length) for (const t of f.tagsAll) and.push(tagCond(t));
  if (f.tagsNone?.length) for (const t of f.tagsNone) and.push({ NOT: tagCond(t) });
  if (f.language) and.push({ language: f.language });
  if (f.sources?.length) and.push({ source: { in: f.sources } });
  if (f.kycStatus?.length) and.push({ kycStatus: { in: f.kycStatus } });
  if (f.minOrders !== undefined) and.push({ orderCount: { gte: f.minOrders } });
  if (f.maxOrders !== undefined) and.push({ orderCount: { lte: f.maxOrders } });
  if (f.hasRecurringPlan !== undefined) and.push({ hasRecurringPlan: f.hasRecurringPlan });
  if (f.holdsMetal === 'gold') and.push({ goldGrams: { gt: 0 } });
  if (f.holdsMetal === 'silver') and.push({ silverGrams: { gt: 0 } });
  if (f.holdsMetal === 'any') and.push({ OR: [{ goldGrams: { gt: 0 } }, { silverGrams: { gt: 0 } }] });
  if (f.minHoldingValue !== undefined) and.push({ holdingValueEgp: { gte: f.minHoldingValue } });
  if (f.maxHoldingValue !== undefined) and.push({ holdingValueEgp: { lte: f.maxHoldingValue } });
  if (f.inactiveDays !== undefined)
    and.push({ OR: [{ lastOrderAt: null }, { lastOrderAt: { lte: new Date(now.getTime() - f.inactiveDays * DAY) } }] });
  if (f.registeredDaysAgoMin !== undefined)
    and.push({ registeredAt: { lte: new Date(now.getTime() - f.registeredDaysAgoMin * DAY) } });
  if (f.registeredDaysAgoMax !== undefined)
    and.push({ registeredAt: { gte: new Date(now.getTime() - f.registeredDaysAgoMax * DAY) } });
  if (f.externalIds?.length) and.push({ externalId: { in: f.externalIds } });
  return { AND: and };
}

/** Private clients get a named relationship contact and are excluded from mass promotional sends (§3.2). */
export function excludePrivateFromPromotions(f: SegmentFilter): SegmentFilter {
  const tiers = (f.tiers?.length ? f.tiers : ['entry', 'core', 'premium', 'private']).filter((t) => t !== 'private');
  return { ...f, tiers };
}
