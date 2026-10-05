// Consent store, preference centre and single suppression list (plan §6.4).

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type Channel,
  CONSENT_CHANNELS,
  CONSENTABLE_TOPICS,
  config,
  type ConsentChannel,
  MARKETING_TOPICS,
  type Topic,
} from '@cep/core';
import { normalizeEgyptMobile } from '@cep/providers';
import { type Client, prisma } from '@cep/db';

export interface ConsentChange {
  channel: ConsentChannel;
  topic: Topic;
  granted: boolean;
}

export interface ConsentMeta {
  source: string;
  wordingVersion?: string;
  wordingText?: string;
  ip?: string;
  actor?: string;
}

export async function setConsents(clientId: string, changes: ConsentChange[], meta: ConsentMeta): Promise<void> {
  for (const ch of changes) {
    if (!(CONSENT_CHANNELS as readonly string[]).includes(ch.channel)) throw new Error(`Unknown channel ${ch.channel}`);
    if (!(CONSENTABLE_TOPICS as readonly string[]).includes(ch.topic)) throw new Error(`Topic ${ch.topic} is not consent-based`);
    await prisma.$transaction([
      prisma.consent.upsert({
        where: { clientId_channel_topic: { clientId, channel: ch.channel, topic: ch.topic } },
        create: { clientId, channel: ch.channel, topic: ch.topic, granted: ch.granted, source: meta.source, wordingVersion: meta.wordingVersion },
        update: { granted: ch.granted, source: meta.source, wordingVersion: meta.wordingVersion },
      }),
      prisma.consentAudit.create({
        data: {
          clientId,
          channel: ch.channel,
          topic: ch.topic,
          granted: ch.granted,
          source: meta.source,
          wordingVersion: meta.wordingVersion,
          wordingText: meta.wordingText,
          ip: meta.ip,
          actor: meta.actor,
        },
      }),
    ]);
  }
}

/**
 * Registration-time capture (plan §6.4): separate, unticked options for
 * marketing email, marketing SMS, WhatsApp and promotional push.
 */
export interface RegistrationConsent {
  emailMarketing?: boolean;
  smsMarketing?: boolean;
  whatsapp?: boolean;
  pushPromotions?: boolean;
  priceDailyPush?: boolean;
  marketResearchEmail?: boolean;
  feedback?: boolean;
}

export function registrationConsentChanges(r: RegistrationConsent): ConsentChange[] {
  const out: ConsentChange[] = [];
  const add = (channel: ConsentChannel, topics: Topic[], granted: boolean | undefined) => {
    if (granted === undefined) return;
    for (const topic of topics) out.push({ channel, topic, granted });
  };
  add('email', MARKETING_TOPICS, r.emailMarketing);
  add('sms', ['lifecycle', 'promotions'], r.smsMarketing);
  add('whatsapp', ['lifecycle', 'promotions', 'price_daily'], r.whatsapp);
  add('push', MARKETING_TOPICS, r.pushPromotions);
  add('push', ['price_daily'], r.priceDailyPush);
  add('email', ['market_research'], r.marketResearchEmail);
  if (r.feedback !== undefined) {
    add('push', ['feedback'], r.feedback);
    add('email', ['feedback'], r.feedback);
    add('sms', ['feedback'], r.feedback);
  }
  return out;
}

export async function consentSet(clientId: string): Promise<Set<string>> {
  const rows = await prisma.consent.findMany({ where: { clientId, granted: true }, select: { channel: true, topic: true } });
  return new Set(rows.map((r) => `${r.channel}:${r.topic}`));
}

export async function preferences(clientId: string) {
  const granted = await consentSet(clientId);
  return {
    mandatoryNote: {
      en: 'Account, security and transaction messages are part of the service and are always sent, even if you switch off everything below.',
      ar: 'رسائل الحساب والأمان والمعاملات جزء من الخدمة وتُرسل دائمًا، حتى إذا أوقفت كل الخيارات أدناه.',
    },
    topics: CONSENTABLE_TOPICS.map((topic) => ({
      topic,
      channels: Object.fromEntries(CONSENT_CHANNELS.map((ch) => [ch, granted.has(`${ch}:${topic}`)])),
    })),
  };
}

// ── Suppression ─────────────────────────────────────────────────────────────

export function destinationFor(channel: Channel, client: Pick<Client, 'email' | 'phone' | 'id'>): string | null {
  if (channel === 'email') return client.email?.toLowerCase() ?? null;
  if (channel === 'sms' || channel === 'whatsapp' || channel === 'call') {
    return client.phone ? (normalizeEgyptMobile(client.phone) ?? client.phone) : null;
  }
  return client.id;
}

export function normalizeDestination(channel: string, value: string): string {
  if (channel === 'email') return value.trim().toLowerCase();
  if (channel === 'sms' || channel === 'whatsapp' || channel === 'call') return normalizeEgyptMobile(value) ?? value.trim();
  return value.trim();
}

export async function suppress(input: {
  channel: string;
  value: string;
  scope?: 'marketing' | 'all';
  reason: string;
  source?: string;
  clientId?: string | null;
  note?: string;
}): Promise<void> {
  const value = normalizeDestination(input.channel, input.value);
  const scope = input.scope ?? 'marketing';
  await prisma.suppression.upsert({
    where: { channel_value_scope: { channel: input.channel, value, scope } },
    create: { channel: input.channel, value, scope, reason: input.reason, source: input.source, clientId: input.clientId ?? null, note: input.note },
    update: { reason: input.reason, source: input.source, expiresAt: null },
  });
}

export async function suppressionState(channel: Channel, client: Pick<Client, 'email' | 'phone' | 'id'> | null, to?: string | null) {
  const values = new Set<string>();
  const dest = to ? normalizeDestination(channel, to) : client ? destinationFor(channel, client) : null;
  if (dest) values.add(dest);
  if (client) values.add(client.id);
  if (!values.size) return { marketing: false, all: false };
  const rows = await prisma.suppression.findMany({
    where: {
      channel: { in: [channel, 'all'] },
      value: { in: [...values] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { scope: true },
  });
  return { marketing: rows.length > 0, all: rows.some((r) => r.scope === 'all') };
}

// ── Unsubscribe tokens (one-click, plan §6.4) ───────────────────────────────

function sign(payload: string): string {
  return createHmac('sha256', config().UNSUBSCRIBE_SECRET).update(payload).digest('base64url').slice(0, 32);
}

export function unsubscribeToken(clientId: string, channel: string, topic: string): string {
  const payload = Buffer.from(`${clientId}|${channel}|${topic}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function parseUnsubscribeToken(token: string): { clientId: string; channel: string; topic: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const [clientId, channel, topic] = Buffer.from(payload, 'base64url').toString().split('|');
  return clientId && channel && topic ? { clientId, channel, topic } : null;
}

export function unsubscribeUrl(clientId: string, channel: string, topic: string): string {
  return `${config().PUBLIC_BASE_URL}/u/${unsubscribeToken(clientId, channel, topic)}`;
}

/** Opt a client out of all marketing on a channel (email unsubscribe, SMS STOP keyword). */
export async function optOutChannel(clientId: string, channel: ConsentChannel, source: string, actor?: string): Promise<void> {
  await setConsents(
    clientId,
    CONSENTABLE_TOPICS.filter((t) => t !== 'price_alerts').map((topic) => ({ channel, topic, granted: false })),
    { source, actor },
  );
}
