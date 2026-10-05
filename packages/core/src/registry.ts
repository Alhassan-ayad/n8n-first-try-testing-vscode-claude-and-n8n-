// Every template key the platform can send, with the channels it needs.
// Used for the console's coverage view and to verify the seed is complete.

import { CATALOG } from './catalog';
import { JOURNEYS } from './journeys';
import type { Channel } from './types';

const EXTRA: Record<string, Channel[]> = {
  otp: ['sms', 'email'],
  daily_price: ['push', 'whatsapp'],
  price_alert: ['push', 'sms'],
  volatility_alert: ['push'],
  dip_alert: ['push'],
  trading_paused: ['push', 'email'],
  price_feed_restored: ['push'],
  monthly_statement: ['email'],
  plan_statement: ['push', 'inapp'],
  plan_bonus_progress: ['inapp'],
  zakat_summary: ['email', 'inapp'],
  nps_quarterly: ['email'],
  milestone: ['push', 'email'],
  anniversary: ['email', 'push'],
  gift_received_invite: ['sms'],
  incident_notice: ['push', 'email'],
  incident_resolved: ['push', 'email'],
  maintenance_notice: ['push', 'email'],
  fee_change_notice: ['email', 'push'],
  terms_notice: ['email'],
  csat_contact: ['sms'],
};

export function requiredTemplates(): Map<string, Set<Channel>> {
  const out = new Map<string, Set<Channel>>();
  const add = (key: string, channels: Channel[]) => {
    const set = out.get(key) ?? new Set<Channel>();
    channels.filter((c) => c !== 'call').forEach((c) => set.add(c));
    out.set(key, set);
  };
  for (const entry of Object.values(CATALOG)) {
    for (const spec of entry?.messages ?? []) add(spec.template, [...spec.channels, ...(spec.fallbackIfNoPush ?? [])]);
  }
  for (const j of JOURNEYS) {
    for (const s of j.steps) for (const a of s.actions) if (a.type === 'message') add(a.template, a.channels);
  }
  for (const [k, v] of Object.entries(EXTRA)) add(k, v);
  return out;
}
