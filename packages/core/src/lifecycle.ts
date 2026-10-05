// Lifecycle stages (plan §3.1) and value tiers (plan §3.2).

import type { LifecycleStage, ValueTier } from './types';

const DAY = 86_400_000;

export interface LifecycleInput {
  kycStatus: string;
  orderCount: number;
  hasRecurringPlan: boolean;
  lastOrderAt?: Date | null;
  lastLoginAt?: Date | null;
  closedAt?: Date | null;
}

export function computeStage(c: LifecycleInput, now = new Date()): LifecycleStage {
  if (c.closedAt) return 'S8';
  if (c.kycStatus !== 'approved') return 'S1';
  if (c.orderCount === 0) return 'S2';

  const sinceOrder = c.lastOrderAt ? (now.getTime() - c.lastOrderAt.getTime()) / DAY : Infinity;
  const lastActivity = Math.max(c.lastOrderAt?.getTime() ?? 0, c.lastLoginAt?.getTime() ?? 0);
  const sinceActivity = lastActivity ? (now.getTime() - lastActivity) / DAY : Infinity;

  if (sinceOrder >= 180) return 'S7';
  if (sinceActivity >= 60) return 'S6';
  if (c.hasRecurringPlan) return 'S5';
  if (c.orderCount >= 2) return 'S4';
  return 'S3';
}

/** Entry < 25k, Core 25k–250k, Premium 250k–2m, Private > 2m EGP held. */
export function computeTier(heldValueEgp: number): ValueTier {
  if (heldValueEgp >= 2_000_000) return 'private';
  if (heldValueEgp >= 250_000) return 'premium';
  if (heldValueEgp >= 25_000) return 'core';
  return 'entry';
}

export const TIER_RANK: Record<ValueTier, number> = { entry: 0, core: 1, premium: 2, private: 3 };

export function tierAtLeast(tier: string, min: ValueTier): boolean {
  return (TIER_RANK[tier as ValueTier] ?? 0) >= TIER_RANK[min];
}

/** Gram milestones (plan §5.3). */
export const GRAM_MILESTONES = [1, 10, 50, 100, 250, 500, 1000];

export function crossedMilestones(before: number, after: number): number[] {
  return GRAM_MILESTONES.filter((m) => before < m && after >= m);
}
