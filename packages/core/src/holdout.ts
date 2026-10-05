import { createHash } from 'node:crypto';

/**
 * Deterministic holdout assignment (plan §8.2, §12.2). The same client in the
 * same scope always lands in the same group, so re-runs and replays never move
 * people between treatment and holdout.
 */
export function bucketOf(clientId: string, scope: string): number {
  const h = createHash('sha256').update(`${scope}:${clientId}`).digest();
  return h.readUInt32BE(0) % 10_000; // 0..9999 → 0.01% granularity
}

export function isInHoldout(clientId: string, scope: string, holdoutPct: number): boolean {
  if (holdoutPct <= 0) return false;
  return bucketOf(clientId, scope) < Math.round(holdoutPct * 100);
}

/** Holdout percentage for offers and campaigns may not go below 10% (plan §8.2). */
export const MIN_OFFER_HOLDOUT_PCT = 10;
