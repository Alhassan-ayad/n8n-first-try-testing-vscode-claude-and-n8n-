// Dispatch: apply the contact policy at send time, then hand to the provider.
// Deferred (quiet hours / client window) and held (frequency cap) messages are
// released by the sweeper in priority order — held, never dropped.

import {
  type CapWindow,
  type Category,
  type Channel,
  evaluatePolicy,
  type Kind,
  type PolicyCounts,
  type Topic,
  windowStart,
} from '@cep/core';
import { getProvider, type OutboundMessage } from '@cep/providers';
import { type Message, parseJson, prisma } from '@cep/db';
import { consentSet, suppressionState, unsubscribeUrl } from './consent';
import { enqueueDispatch, log } from './infra';
import { createMessage } from './messages';

const SENT_STATUSES = ['sending', 'sent', 'delivered', 'opened', 'clicked'];
const DISPATCHABLE = ['pending', 'deferred', 'held'];
const MAX_ATTEMPTS = 4;

export class RetryableSendError extends Error {}

async function capCounts(clientId: string, channel: string, now: Date): Promise<PolicyCounts> {
  const count = (w: CapWindow) =>
    prisma.message.count({
      where: { clientId, channel, capped: true, status: { in: SENT_STATUSES }, sentAt: { gte: windowStart(w, now) } },
    });
  const [day, week, month, quarter, slots] = await Promise.all([
    count('day'),
    count('week'),
    count('month'),
    count('quarter'),
    prisma.message.findMany({
      where: { clientId, campaignSlot: { not: null }, status: { in: SENT_STATUSES }, sentAt: { gte: windowStart('day', now) } },
      select: { campaignSlot: true },
      distinct: ['campaignSlot'],
    }),
  ]);
  return { day, week, month, quarter, campaignSlotsToday: slots.map((s) => s.campaignSlot!).filter(Boolean) };
}

export async function dispatchMessage(messageId: string, now = new Date()): Promise<string> {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || !DISPATCHABLE.includes(m.status)) return `skip:${m?.status ?? 'missing'}`;
  if (m.notBefore && m.notBefore > now) {
    await prisma.message.update({ where: { id: m.id }, data: { status: 'deferred', releaseAt: m.notBefore, statusReason: 'scheduled' } });
    return 'deferred:scheduled';
  }

  const client = m.clientId ? await prisma.client.findUnique({ where: { id: m.clientId } }) : null;
  const channel = m.channel as Channel;
  let tokens: string[] = [];
  if (channel === 'push' && client) {
    tokens = (await prisma.device.findMany({ where: { clientId: client.id, invalidatedAt: null }, select: { token: true } })).map((d) => d.token);
  }

  const supp = await suppressionState(channel, client, m.toAddress && channel !== 'push' ? m.toAddress : null);
  const consents = client ? await consentSet(client.id) : new Set<string>();
  const alert = client
    ? await prisma.priceAlert.findFirst({
        where: { clientId: client.id, active: true, windowStart: { not: null } },
        select: { windowStart: true, windowEnd: true },
      })
    : null;
  const hasDestination = channel === 'push' ? tokens.length > 0 : Boolean(m.toAddress);
  const counts = client && m.capped ? await capCounts(client.id, channel, now) : { day: 0, week: 0, month: 0, quarter: 0 };
  if (client && m.campaignSlot && !m.capped) counts.campaignSlotsToday = (await capCounts(client.id, channel, now)).campaignSlotsToday;

  const decision = evaluatePolicy(
    {
      channel,
      kind: m.kind as Kind,
      topic: m.topic as Topic,
      category: m.category as Category,
      capped: m.capped,
      campaignSlot: m.campaignSlot,
      pushTwin: m.pushTwin,
    },
    {
      consents,
      suppressedMarketing: supp.marketing,
      suppressedAll: supp.all,
      hasDestination,
      pushReachable: client ? (await prisma.device.count({ where: { clientId: client.id, invalidatedAt: null } })) > 0 : false,
      alertWindow: alert?.windowStart && alert.windowEnd ? { start: alert.windowStart, end: alert.windowEnd } : null,
    },
    counts,
    now,
  );

  if (decision.action === 'suppress') {
    await prisma.message.update({ where: { id: m.id }, data: { status: 'suppressed', statusReason: decision.reason } });
    return `suppressed:${decision.reason}`;
  }
  if (decision.action === 'defer' || decision.action === 'hold') {
    await prisma.message.update({
      where: { id: m.id },
      data: { status: decision.action === 'defer' ? 'deferred' : 'held', releaseAt: decision.until, statusReason: decision.reason },
    });
    return `${decision.action}:${decision.reason}`;
  }

  // Claim the message (guards against double sends from concurrent workers).
  const claimed = await prisma.message.updateMany({
    where: { id: m.id, status: { in: DISPATCHABLE } },
    data: { status: 'sending', attempts: { increment: 1 }, sentAt: now },
  });
  if (claimed.count === 0) return 'skip:claimed';

  const outbound: OutboundMessage = {
    id: m.id,
    channel: channel as OutboundMessage['channel'],
    language: m.language === 'en' ? 'en' : 'ar',
    to: m.toAddress ?? undefined,
    tokens,
    subject: m.subject,
    title: m.title,
    body: m.body,
    html: m.html,
    deepLink: m.deepLink,
    imageUrl: m.imageUrl,
    category: m.category,
    topic: m.topic,
    marketing: !['transactional', 'service_notice'].includes(m.topic),
    unsubscribeUrl: client ? unsubscribeUrl(client.id, 'email', m.topic) : null,
    attachments: parseJson(m.attachments, undefined),
  };

  const provider = getProvider(channel as 'sms' | 'email' | 'push' | 'whatsapp');
  let result;
  try {
    result = await provider.send(outbound);
  } catch (err) {
    result = { accepted: false, provider: provider.name, error: (err as Error).message, permanent: false };
  }

  if (result.invalidTokens?.length) {
    await prisma.device.updateMany({ where: { token: { in: result.invalidTokens } }, data: { invalidatedAt: new Date() } });
  }

  if (result.accepted) {
    await prisma.message.update({
      where: { id: m.id },
      data: {
        status: 'sent',
        statusReason: null,
        provider: result.provider,
        providerMessageId: result.providerMessageId ?? null,
        sentAt: new Date(),
        // Never keep OTP codes at rest.
        ...(m.kind === 'otp' ? { body: '[redacted]', vars: null } : {}),
      },
    });
    return 'sent';
  }

  const attempts = m.attempts + 1;
  const final = result.permanent || attempts >= MAX_ATTEMPTS;
  await prisma.message.update({
    where: { id: m.id },
    data: {
      status: final ? 'failed' : 'pending',
      statusReason: result.error?.slice(0, 1000) ?? 'send_failed',
      provider: result.provider,
      failedAt: final ? new Date() : null,
      sentAt: null,
    },
  });
  log.warn({ messageId: m.id, channel, error: result.error, attempts, final }, 'send failed');

  // SMS fallback for failed transactional email/push is handled by the catalog; OTP falls back to email.
  if (final && m.kind === 'otp' && channel === 'sms' && client?.email) {
    await createMessage({
      client,
      templateKey: m.templateKey,
      channel: 'email',
      kind: 'otp',
      topic: 'transactional',
      category: 'A',
      vars: parseJson(m.vars, {}),
      dedupeKey: `${m.dedupeKey}:email_fallback`,
    });
  }
  if (!final) throw new RetryableSendError(result.error ?? 'send failed');
  return 'failed';
}

/** Release deferred/held messages whose time has come, highest priority first. */
export async function releaseDue(now = new Date(), limit = 2000): Promise<number> {
  const due = await prisma.message.findMany({
    where: { status: { in: ['deferred', 'held'] }, releaseAt: { lte: now } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true, priority: true },
  });
  for (const m of due) {
    await prisma.message.update({ where: { id: m.id }, data: { status: 'pending' } });
    await enqueueDispatch(m.id, m.priority);
  }
  // Re-enqueue anything stuck in pending (e.g. Redis was flushed).
  const stuck = await prisma.message.findMany({
    where: { status: 'pending', createdAt: { lte: new Date(now.getTime() - 10 * 60_000) }, updatedAt: { lte: new Date(now.getTime() - 10 * 60_000) } },
    take: 500,
    select: { id: true, priority: true },
  });
  for (const m of stuck) await enqueueDispatch(m.id, m.priority);
  return due.length + stuck.length;
}
