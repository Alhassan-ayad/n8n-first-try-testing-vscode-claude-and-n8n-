// Contact policy engine (plan §6). Pure function: given a message, what we
// know about the client, and how many capped messages they already received,
// decide send / defer / hold / suppress. Enforced in the platform for every
// send — never left to the person pressing the button.

import { config } from './config';
import {
  atCairo,
  type CapWindow,
  isQuietHours,
  isWithinWindow,
  nextCallWindow,
  isCallWindow,
  nextWindowOpen,
  nextWindowRelease,
  quietHoursRelease,
} from './time';
import { type Category, type Channel, type Kind, MANDATORY_KINDS, MANDATORY_TOPICS, type Topic } from './types';

/** Marketing frequency caps (plan §6.3). Counted per client across all campaigns. */
export const FREQUENCY_CAPS: Record<Channel, Partial<Record<CapWindow, number>>> = {
  push: { day: 1, week: 4 },
  email: { week: 2 },
  sms: { month: 4 },
  whatsapp: { month: 4 },
  call: { quarter: 2 },
  inapp: {},
};

export const PUSH_MAX_CHARS = 90;
export const CAMPAIGN_SLOTS = ['11:00', '19:00'] as const;

export interface PolicyMessage {
  channel: Channel;
  kind: Kind;
  topic: Topic;
  category: Category;
  capped: boolean;
  campaignSlot?: string | null;
  /** The same content is also being sent by push (plan §4 SMS rule). */
  pushTwin?: boolean;
}

export interface PolicyClient {
  /** Granted consents as `${channel}:${topic}`. */
  consents: ReadonlySet<string>;
  /** Destination is on the suppression list for marketing on this channel. */
  suppressedMarketing: boolean;
  /** Destination is invalid (hard bounce, unregistered) — blocks everything. */
  suppressedAll: boolean;
  /** We have an address / phone / token for this channel. */
  hasDestination: boolean;
  /** At least one valid push token and push not disabled. */
  pushReachable: boolean;
  /** Client-set price alert delivery window (HH:mm). */
  alertWindow?: { start: string; end: string } | null;
}

export interface PolicyCounts {
  /** Capped messages already sent on this channel in the current window. */
  day: number;
  week: number;
  month: number;
  quarter: number;
  /** Campaign slots already used for this client today (any channel). */
  campaignSlotsToday?: string[];
}

export type PolicyDecision =
  | { action: 'send' }
  | { action: 'defer'; until: Date; reason: string }
  | { action: 'hold'; until: Date; reason: string }
  | { action: 'suppress'; reason: string };

export function isMandatory(kind: Kind, topic: Topic): boolean {
  return MANDATORY_KINDS.has(kind) || MANDATORY_TOPICS.has(topic);
}

export function hasConsent(client: PolicyClient, channel: Channel, topic: Topic): boolean {
  return client.consents.has(`${channel}:${topic}`);
}

export function evaluatePolicy(
  msg: PolicyMessage,
  client: PolicyClient,
  counts: PolicyCounts,
  now: Date,
): PolicyDecision {
  // 1. Destination checks apply to everything.
  if (!client.hasDestination) return { action: 'suppress', reason: 'no_destination' };
  if (client.suppressedAll) return { action: 'suppress', reason: 'invalid_destination' };

  const mandatory = isMandatory(msg.kind, msg.topic);

  // WhatsApp needs explicit opt-in even for service messages (plan §4).
  if (msg.channel === 'whatsapp' && !hasAnyWhatsAppOptIn(client)) {
    return { action: 'suppress', reason: 'whatsapp_not_opted_in' };
  }

  // 2. Category A / security / OTP / service notices: never capped, never quiet-houred.
  if (mandatory) return { action: 'send' };

  // 3. Consent — silence is not consent. In-app is part of the service.
  if (msg.channel !== 'inapp' && !hasConsent(client, msg.channel, msg.topic)) {
    return { action: 'suppress', reason: 'no_consent' };
  }

  // 4. Single suppression list.
  if (msg.channel !== 'inapp' && client.suppressedMarketing) return { action: 'suppress', reason: 'suppressed' };

  // 5. Timing. Client-configured alerts follow the client's own window instead of quiet hours.
  if (msg.kind === 'client_alert') {
    const c = config();
    const start = client.alertWindow?.start ?? c.PRICE_ALERT_WINDOW_START;
    const end = client.alertWindow?.end ?? c.PRICE_ALERT_WINDOW_END;
    if (!isWithinWindow(now, start, end)) {
      return { action: 'defer', until: nextWindowOpen(now, start, end), reason: 'outside_alert_window' };
    }
  } else if (msg.channel === 'call') {
    if (!isCallWindow(now)) return { action: 'defer', until: nextCallWindow(now), reason: 'outside_call_hours' };
  } else if (msg.channel !== 'inapp' && isQuietHours(now)) {
    return { action: 'defer', until: quietHoursRelease(now), reason: 'quiet_hours' };
  }

  // 6. Never use marketing SMS when the client will receive the push equivalent (plan §4).
  if (msg.channel === 'sms' && msg.pushTwin && client.pushReachable && hasConsent(client, 'push', msg.topic)) {
    return { action: 'suppress', reason: 'push_equivalent_available' };
  }

  // 7. Frequency caps — held (never dropped) until the window resets.
  if (msg.capped) {
    const caps = FREQUENCY_CAPS[msg.channel];
    for (const window of ['day', 'week', 'month', 'quarter'] as const) {
      const limit = caps[window];
      if (limit !== undefined && counts[window] >= limit) {
        return { action: 'hold', until: nextWindowRelease(window, now), reason: `cap_${msg.channel}_${window}` };
      }
    }
  }

  // 8. Campaign slots: 11:00 or 19:00, never both on the same day for one client.
  if (msg.campaignSlot && counts.campaignSlotsToday?.some((s) => s !== msg.campaignSlot)) {
    return { action: 'hold', until: atCairo(now, 1, msg.campaignSlot), reason: 'campaign_slot_used_today' };
  }

  return { action: 'send' };
}

function hasAnyWhatsAppOptIn(client: PolicyClient): boolean {
  for (const c of client.consents) if (c.startsWith('whatsapp:')) return true;
  return false;
}
