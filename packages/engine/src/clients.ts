// Single client view: create/sync clients and keep their facts current.

import {
  type ClientFacts,
  computeStage,
  computeTier,
  type Language,
  type LifecycleStage,
  type PlatformEvent,
  type ValueTier,
} from '@cep/core';
import { getHoldings, getUser } from '@cep/cdc';
import { type Client, joinCsv, prisma, splitCsv } from '@cep/db';
import { log } from './infra';

export function toFacts(c: Client): ClientFacts {
  return {
    id: c.id,
    externalId: c.externalId,
    language: (c.language === 'en' ? 'en' : 'ar') as Language,
    lifecycleStage: c.lifecycleStage as LifecycleStage,
    valueTier: c.valueTier as ValueTier,
    tags: splitCsv(c.tags),
    kycStatus: c.kycStatus,
    kycRejectCount: c.kycRejectCount,
    orderCount: c.orderCount,
    avgOrderAmount: c.avgOrderAmount,
    goldGrams: c.goldGrams,
    silverGrams: c.silverGrams,
    holdingValueEgp: c.holdingValueEgp,
    hasRecurringPlan: c.hasRecurringPlan,
    registeredAt: c.registeredAt,
    activatedAt: c.activatedAt,
    firstOrderAt: c.firstOrderAt,
    lastOrderAt: c.lastOrderAt,
    lastLoginAt: c.lastLoginAt,
    closedAt: c.closedAt,
    phone: c.phone,
    email: c.email,
    fullName: c.fullName,
    source: c.source,
  };
}

const SOURCE_TAGS: Record<string, string> = {
  moneyfellows: 'partner_moneyfellows',
  partner: 'partner',
  referral: 'referral',
  b2b2c: 'b2b2c',
};

function profileFrom(payload: Record<string, unknown>) {
  const data: Partial<Client> = {};
  if (payload.fullName !== undefined) data.fullName = (payload.fullName as string) ?? null;
  if (payload.phone !== undefined) data.phone = (payload.phone as string) ?? null;
  if (payload.email !== undefined) data.email = ((payload.email as string) ?? '').toLowerCase() || null;
  if (payload.language !== undefined) data.language = payload.language === 'en' ? 'en' : 'ar';
  return data;
}

/** Find or create the client for an event. Pulls the profile from mngm core when we don't know them yet. */
export async function ensureClient(externalId: string, e?: PlatformEvent): Promise<Client> {
  const existing = await prisma.client.findUnique({ where: { externalId } });
  if (existing) return existing;

  let data: Partial<Client> = e ? profileFrom(e.payload) : {};
  let source = (e?.payload.source as string | undefined) ?? 'organic';
  let former = Boolean(e?.payload.isFormerInstalment);
  let registeredAt = e?.type === 'client.registered' ? e.occurredAt : new Date();
  try {
    const u = await getUser(externalId);
    if (u) {
      data = {
        fullName: u.FullName,
        phone: u.Phone,
        email: u.Email?.toLowerCase() ?? null,
        language: u.Language?.toLowerCase() === 'en' ? 'en' : 'ar',
        ...data,
      };
      source = u.Source ?? source;
      former = former || Boolean(u.IsFormerInstalment);
      registeredAt = u.CreatedAt ?? registeredAt;
    }
  } catch (err) {
    log.warn({ err: (err as Error).message, externalId }, 'source lookup failed; creating client from event payload');
  }

  const tags = [SOURCE_TAGS[source.toLowerCase()], former ? 'former_instalment' : undefined].filter(Boolean) as string[];
  try {
    return await prisma.client.create({
      data: {
        externalId,
        fullName: data.fullName ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        language: data.language ?? 'ar',
        source,
        tags: joinCsv(tags),
        registeredAt,
      },
    });
  } catch {
    // Created concurrently.
    return prisma.client.findUniqueOrThrow({ where: { externalId } });
  }
}

/** Refresh holdings from mngm core and value them at the latest price. */
export async function refreshHoldings(clientId: string, externalId: string): Promise<Partial<Client>> {
  try {
    const h = await getHoldings(externalId);
    const [gold, silver] = await Promise.all([latestPrice('gold'), latestPrice('silver')]);
    const value = h.gold * (gold ?? 0) + h.silver * (silver ?? 0);
    const data = {
      goldGrams: h.gold,
      silverGrams: h.silver,
      cashBalanceEgp: h.cash,
      holdingValueEgp: Math.round(value),
      valueTier: computeTier(value + h.cash),
    };
    await prisma.client.update({ where: { id: clientId }, data });
    return data;
  } catch (err) {
    log.warn({ err: (err as Error).message, externalId }, 'holdings refresh failed');
    return {};
  }
}

export async function latestPrice(metal: string): Promise<number | null> {
  const t = await prisma.priceTick.findFirst({ where: { metal, stale: false }, orderBy: { occurredAt: 'desc' } });
  return t?.buyPrice ?? null;
}

export async function setTags(clientId: string, add: string[] = [], remove: string[] = []): Promise<Client> {
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const tags = new Set(splitCsv(c.tags));
  add.forEach((t) => tags.add(t));
  remove.forEach((t) => tags.delete(t));
  return prisma.client.update({ where: { id: clientId }, data: { tags: joinCsv(tags) } });
}

/** Apply an event to the client's facts. Returns the client before and after. */
export async function applyEventFacts(client: Client, e: PlatformEvent): Promise<{ before: Client; after: Client }> {
  const p = e.payload;
  const data: Partial<Client> = {};
  let refresh = false;
  const tagsAdd: string[] = [];
  const tagsRemove: string[] = [];

  switch (e.type) {
    case 'client.registered':
    case 'client.updated':
      Object.assign(data, profileFrom(p));
      if (p.isFormerInstalment) tagsAdd.push('former_instalment');
      if (e.type === 'client.registered' && p.source) data.source = String(p.source);
      break;
    case 'client.closed':
      data.closedAt = e.occurredAt;
      break;
    case 'client.login':
      data.lastLoginAt = e.occurredAt;
      break;
    case 'ekyc.submitted':
      data.kycStatus = 'submitted';
      break;
    case 'ekyc.approved':
      data.kycStatus = 'approved';
      data.activatedAt = e.occurredAt;
      tagsRemove.push('manual_kyc_queue');
      break;
    case 'ekyc.rejected':
      data.kycStatus = 'rejected';
      data.kycRejectCount = client.kycRejectCount + 1;
      break;
    case 'order.executed': {
      data.lastOrderAt = e.occurredAt;
      if ((p.side ?? 'buy') === 'buy') {
        const amount = Number(p.amount ?? 0);
        data.orderCount = client.orderCount + 1;
        data.avgOrderAmount = (client.avgOrderAmount * client.orderCount + amount) / (client.orderCount + 1);
        if (!client.firstOrderAt) data.firstOrderAt = e.occurredAt;
        const grams = Number(p.grams ?? 0);
        if (p.metal === 'silver') data.silverGrams = client.silverGrams + grams;
        else data.goldGrams = client.goldGrams + grams;
      }
      refresh = true;
      break;
    }
    case 'upload.credited':
      tagsAdd.push('gold_uploader');
      refresh = true;
      break;
    case 'gift.sent':
      tagsAdd.push('gift_sender');
      refresh = true;
      break;
    case 'gift.received':
    case 'cash.in.settled':
    case 'cash.out.executed':
    case 'plan.debit.succeeded':
      refresh = true;
      break;
    case 'conversion.delivered':
      tagsAdd.push('physical_delivery');
      refresh = true;
      break;
    case 'plan.created':
      data.hasRecurringPlan = true;
      tagsAdd.push('recurring_plan');
      tagsRemove.push('former_instalment_pending');
      break;
    case 'plan.cancelled':
      data.hasRecurringPlan = false;
      tagsRemove.push('recurring_plan');
      break;
    default:
      break;
  }

  if (tagsAdd.length || tagsRemove.length) {
    const tags = new Set(splitCsv(client.tags));
    tagsAdd.forEach((t) => tags.add(t));
    tagsRemove.forEach((t) => tags.delete(t));
    data.tags = joinCsv(tags);
  }

  let after = Object.keys(data).length ? await prisma.client.update({ where: { id: client.id }, data }) : client;
  if (refresh) {
    const h = await refreshHoldings(after.id, after.externalId);
    if (Object.keys(h).length) after = { ...after, ...h } as Client;
  }
  after = await recomputeStage(after);
  return { before: client, after };
}

export async function recomputeStage(c: Client, now = new Date()): Promise<Client> {
  const stage = computeStage(c, now);
  const holdingTags = new Set(splitCsv(c.tags));
  holdingTags.delete('gold_only');
  holdingTags.delete('silver_only');
  holdingTags.delete('gold_and_silver');
  if (c.goldGrams > 0 && c.silverGrams > 0) holdingTags.add('gold_and_silver');
  else if (c.goldGrams > 0) holdingTags.add('gold_only');
  else if (c.silverGrams > 0) holdingTags.add('silver_only');
  const tags = joinCsv(holdingTags);
  if (stage === c.lifecycleStage && tags === c.tags) return c;
  return prisma.client.update({ where: { id: c.id }, data: { lifecycleStage: stage, tags } });
}
