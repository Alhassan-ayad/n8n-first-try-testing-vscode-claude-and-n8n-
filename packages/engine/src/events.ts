// Event router: every platform event (CDC or API) is logged once (idempotent
// on event id) and then routed: client facts → transactional catalogue →
// journeys → milestones/special rules. Price events go to the price engine.

import {
  CATALOG,
  crossedMilestones,
  type EventType,
  isEventType,
  JOURNEY_BY_KEY,
  type Language,
  type PlatformEvent,
} from '@cep/core';
import { type Client, type EventLog, Prisma, prisma, splitCsv } from '@cep/db';
import { applyEventFacts, ensureClient, setTags } from './clients';
import { log } from './infra';
import { createCallTask, enrol, handleJourneyEvent } from './journeys';
import { cancelGuards, createMessage, createMulti } from './messages';
import { handlePriceEvent } from './price';

export interface IncomingEvent {
  id: string;
  type: string;
  clientExternalId?: string;
  occurredAt?: Date | string;
  payload?: Record<string, unknown>;
}

const REDACT = new Set(['code', 'otp', 'password', 'pin']);

function redact(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, REDACT.has(k.toLowerCase()) ? '[redacted]' : v]));
}

/** Persist and process events in order. Returns the number newly processed. */
export async function ingestEvents(events: IncomingEvent[], source: 'cdc' | 'api' | 'scheduler'): Promise<number> {
  let processed = 0;
  for (const raw of events) {
    if (!isEventType(raw.type)) {
      log.warn({ type: raw.type }, 'unknown event type ignored');
      continue;
    }
    const e: PlatformEvent = {
      id: raw.id,
      type: raw.type,
      clientExternalId: raw.clientExternalId,
      occurredAt: raw.occurredAt ? new Date(raw.occurredAt) : new Date(),
      payload: raw.payload ?? {},
      source,
    };
    let row: EventLog;
    try {
      row = await prisma.eventLog.create({
        data: {
          eventId: e.id,
          type: e.type,
          clientExternalId: e.clientExternalId ?? null,
          payload: JSON.stringify(redact(e.payload)),
          source,
          occurredAt: e.occurredAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // already seen
      throw err;
    }
    await processLogged(row, e);
    processed++;
  }
  return processed;
}

async function processLogged(row: EventLog, e: PlatformEvent) {
  try {
    await processEvent(e);
    await prisma.eventLog.update({ where: { id: row.id }, data: { processedAt: new Date(), error: null } });
  } catch (err) {
    log.error({ err: (err as Error).message, eventId: e.id, type: e.type }, 'event processing failed');
    await prisma.eventLog.update({ where: { id: row.id }, data: { error: (err as Error).stack?.slice(0, 4000) ?? String(err) } });
  }
}

/** Retry events that failed or were never processed (crash between log and process). */
export async function recoverEvents(limit = 200): Promise<number> {
  const rows = await prisma.eventLog.findMany({
    where: { processedAt: null, createdAt: { lte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  for (const row of rows) {
    if (row.type === 'otp.requested') {
      // Codes are redacted at rest and expire quickly — never re-send a stale OTP.
      await prisma.eventLog.update({ where: { id: row.id }, data: { processedAt: new Date(), error: 'otp_not_recoverable' } });
      continue;
    }
    const e: PlatformEvent = {
      id: row.eventId,
      type: row.type as EventType,
      clientExternalId: row.clientExternalId ?? undefined,
      occurredAt: row.occurredAt,
      payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {},
      source: row.source as PlatformEvent['source'],
    };
    await processLogged(row, e);
  }
  return rows.length;
}

export async function processEvent(e: PlatformEvent): Promise<void> {
  if (e.type.startsWith('price.')) return handlePriceEvent(e);
  if (e.type === 'otp.requested') return handleOtp(e);
  if (e.type === 'gift.received' && !e.clientExternalId) return giftToNonClient(e);
  if (!e.clientExternalId) {
    log.warn({ type: e.type, id: e.id }, 'client event without clientExternalId');
    return;
  }

  const client0 = await ensureClient(e.clientExternalId, e);
  const { before, after: client } = await applyEventFacts(client0, e);

  const entry = CATALOG[e.type];
  if (entry?.cancelGuards) await cancelGuards(client.id, entry.cancelGuards(e));
  for (const [i, spec] of (entry?.messages ?? []).entries()) {
    if (spec.when && !spec.when(e)) continue;
    let notBefore: Date | null = null;
    if (spec.delayMinutes) notBefore = new Date(e.occurredAt.getTime() + spec.delayMinutes * 60_000);
    if (spec.notBeforeField) {
      const v = e.payload[spec.notBeforeField.field];
      if (!v) continue;
      notBefore = new Date(new Date(String(v)).getTime() + spec.notBeforeField.offsetMinutes * 60_000);
      if (notBefore < new Date()) continue; // reminder time already passed
    }
    await createMulti({
      client,
      channels: spec.channels.filter((c): c is Exclude<typeof c, 'call'> => c !== 'call'),
      fallbackIfNoPush: spec.fallbackIfNoPush?.filter((c): c is Exclude<typeof c, 'call'> => c !== 'call'),
      templateKey: spec.template,
      kind: spec.kind,
      topic: spec.topic,
      category: spec.category,
      vars: { ...e.payload, eventTime: e.occurredAt },
      notBefore,
      guardKey: spec.guardKey?.(e),
      inbox: spec.inbox,
      dedupeBase: `ev:${e.id}:${i}:${spec.template}`,
    });
  }

  await handleJourneyEvent(client, e);
  await specialRules(before, client, e);
}

async function specialRules(before: Client, client: Client, e: PlatformEvent) {
  // §7.1 — anyone rejected twice moves to a manual call-centre queue, not the automated journey.
  if (e.type === 'ekyc.rejected' && client.kycRejectCount >= 2 && !splitCsv(client.tags).includes('manual_kyc_queue')) {
    await setTags(client.id, ['manual_kyc_queue']);
    await createCallTask(client, 'manual_kyc', 2, 'activation');
  }

  // §5.3 — milestone recognition on gram thresholds, then a referral invitation.
  if (['order.executed', 'upload.credited', 'gift.received', 'plan.debit.succeeded'].includes(e.type)) {
    const crossed = crossedMilestones(before.goldGrams, client.goldGrams);
    if (crossed.length) {
      const milestone = crossed[crossed.length - 1]!;
      await createMulti({
        client,
        channels: ['push', 'email'],
        templateKey: 'milestone',
        kind: 'lifecycle',
        topic: 'lifecycle',
        category: 'C',
        vars: { milestone, grams: client.goldGrams, metal: 'gold' },
        inbox: true,
        dedupeBase: `milestone:${client.id}:gold:${milestone}`,
      });
      await enrol(JOURNEY_BY_KEY.get('referral_invite')!, client, { context: { milestone } });
    }
  }

  // §7.3 — recurring plan bonus: remind how many uninterrupted months remain.
  if (e.type === 'plan.debit.succeeded') {
    const months = Number(e.payload.consecutiveMonths ?? 0);
    const target = Number(process.env.RECURRING_BONUS_MONTHS ?? 6);
    if (months > 0 && months < target) {
      await createMessage({
        client,
        channel: 'inapp',
        templateKey: 'plan_bonus_progress',
        kind: 'lifecycle',
        topic: 'lifecycle',
        category: 'C',
        vars: { months, remaining: target - months, target },
        dedupeKey: `plan_bonus:${String(e.payload.planId)}:${months}`,
      });
    }
  }
}

async function handleOtp(e: PlatformEvent) {
  const phone = (e.payload.phone as string | undefined) ?? undefined;
  const email = (e.payload.email as string | undefined) ?? undefined;
  const client = e.clientExternalId ? await prisma.client.findUnique({ where: { externalId: e.clientExternalId } }) : null;
  const lang = ((e.payload.language as Language | undefined) ?? (client?.language as Language | undefined) ?? 'ar') as Language;
  const vars = { code: e.payload.code, purpose: e.payload.purpose };
  if (phone || client?.phone) {
    await createMessage({
      client,
      to: phone ?? client?.phone,
      channel: 'sms',
      templateKey: 'otp',
      kind: 'otp',
      topic: 'transactional',
      category: 'A',
      vars,
      language: lang,
      dedupeKey: `otp:${e.id}`,
    });
  } else if (email || client?.email) {
    await createMessage({
      client,
      to: email ?? client?.email,
      channel: 'email',
      templateKey: 'otp',
      kind: 'otp',
      topic: 'transactional',
      category: 'A',
      vars,
      language: lang,
      dedupeKey: `otp:${e.id}:email`,
    });
  }
}

async function giftToNonClient(e: PlatformEvent) {
  const phone = e.payload.recipientPhone as string | undefined;
  if (!phone) return;
  await createMessage({
    client: null,
    to: phone,
    channel: 'sms',
    templateKey: 'gift_received_invite',
    kind: 'transactional',
    topic: 'transactional',
    category: 'A',
    vars: e.payload,
    language: 'ar',
    dedupeKey: `gift:${e.id}:sms`,
  });
}
