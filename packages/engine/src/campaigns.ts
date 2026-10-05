// Campaign register (Appendix C) and offer register (§8): validation,
// approval gates, scheduling at 11:00/19:00, launch, and holdout results.

import {
  approvalRoute,
  atCairo,
  CAMPAIGN_SLOTS,
  type Channel,
  excludePrivateFromPromotions,
  hasBlockingIssues,
  type Kind,
  lintTemplate,
  MIN_OFFER_HOLDOUT_PCT,
  offerEconomics,
  offerReadiness,
  type SegmentFilter,
  segmentFilterSchema,
  type Topic,
  addBusinessDays,
} from '@cep/core';
import { type Campaign, type Offer, parseJson, prisma, splitCsv } from '@cep/db';
import { startBroadcast } from './broadcast';
import { audit, log } from './infra';
import { categoryForKind } from './journeys';

export async function validateCampaign(c: Campaign): Promise<string[]> {
  const problems: string[] = [];
  const parsed = segmentFilterSchema.safeParse(parseJson(c.segmentFilter, null));
  if (!parsed.success) problems.push('Segment filter is invalid');
  if (c.holdoutPct < MIN_OFFER_HOLDOUT_PCT) problems.push(`Holdout must be at least ${MIN_OFFER_HOLDOUT_PCT}%`);
  if (!c.hypothesis) problems.push('Written hypothesis is required');
  if (c.slot && !(CAMPAIGN_SLOTS as readonly string[]).includes(c.slot)) problems.push('Slot must be 11:00 or 19:00');
  const channels = splitCsv(c.channels);
  if (!channels.length) problems.push('At least one channel is required');

  for (const channel of channels) {
    const templates = await prisma.template.findMany({ where: { key: c.templateKey, channel, status: 'approved' } });
    if (!templates.length) problems.push(`No approved ${channel} template "${c.templateKey}"`);
    for (const t of templates) {
      const issues = lintTemplate({ ...t, channel: t.channel as Channel, language: t.language as 'ar' | 'en' });
      if (hasBlockingIssues(issues)) problems.push(`Template ${t.key}/${t.channel}/${t.language} fails compliance lint`);
    }
  }

  if (c.offerId) {
    const offer = await prisma.offer.findUnique({ where: { id: c.offerId } });
    if (!offer) problems.push('Referenced offer not found');
    else if (!['approved', 'live'].includes(offer.status)) problems.push(`Offer ${offer.code} is not approved (status ${offer.status})`);
  }
  return problems;
}

export async function scheduleCampaign(id: string, actor: string): Promise<Campaign> {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  if (c.status !== 'approved') throw new Error('Only approved campaigns can be scheduled');
  if (!c.sendDate || !c.slot) throw new Error('Send date and slot (11:00 or 19:00) are required');
  const problems = await validateCampaign(c);
  if (problems.length) throw new Error(problems.join('; '));
  const scheduledAt = atCairo(new Date(`${c.sendDate}T12:00:00Z`), 0, c.slot);
  if (scheduledAt < new Date()) throw new Error('Scheduled time is in the past');
  const updated = await prisma.campaign.update({ where: { id }, data: { status: 'scheduled', scheduledAt } });
  await audit(actor, 'schedule', 'campaign', id, { scheduledAt });
  return updated;
}

export async function launchCampaign(c: Campaign): Promise<void> {
  const filter = segmentFilterSchema.parse(parseJson<SegmentFilter>(c.segmentFilter, {}));
  const kind = c.kind as Kind;
  const finalFilter = kind === 'promotion' ? excludePrivateFromPromotions(filter) : filter;
  const channels = splitCsv(c.channels) as Array<Exclude<Channel, 'call'>>;
  await prisma.campaign.update({ where: { id: c.id }, data: { status: 'running', launchedAt: new Date() } });
  await startBroadcast(finalFilter, {
    templateKey: c.templateKey,
    channels,
    kind,
    topic: c.topic as Topic,
    category: categoryForKind(kind),
    inbox: channels.includes('push') || channels.includes('sms'),
    campaignId: c.id,
    campaignSlot: c.slot ?? undefined,
    holdoutScope: `campaign:${c.id}`,
    holdoutPct: c.holdoutPct,
    dedupePrefix: `campaign:${c.id}`,
    vars: { campaignCode: c.code },
  });
  log.info({ campaign: c.code }, 'campaign launched');
}

export async function launchDueCampaigns(now = new Date()): Promise<number> {
  const due = await prisma.campaign.findMany({ where: { status: 'scheduled', scheduledAt: { lte: now } } });
  for (const c of due) {
    const problems = await validateCampaign(c);
    if (problems.length) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: 'in_review', complianceNote: `Blocked at launch: ${problems.join('; ')}` } });
      log.warn({ campaign: c.code, problems }, 'campaign blocked at launch');
      continue;
    }
    await launchCampaign(c);
  }
  return due.length;
}

/** Treatment vs holdout conversion within the attribution window (plan §12.2). */
export async function campaignResults(id: string) {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  if (!c.launchedAt) return { campaign: c.code, status: c.status, note: 'Not launched yet' };
  const scope = `campaign:${c.id}`;
  const end = new Date(c.launchedAt.getTime() + c.attributionDays * 86_400_000);
  const assignments = await prisma.holdoutAssignment.findMany({
    where: { scope },
    select: { holdout: true, clientId: true, client: { select: { externalId: true } } },
  });
  const groups = { treated: [] as string[], holdout: [] as string[] };
  const treatedIds: string[] = [];
  for (const a of assignments) {
    (a.holdout ? groups.holdout : groups.treated).push(a.client.externalId);
    if (!a.holdout) treatedIds.push(a.clientId);
  }

  const converters = async (ids: string[]) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await prisma.eventLog.findMany({
        where: { type: c.goalEvent, clientExternalId: { in: ids.slice(i, i + 1000) }, occurredAt: { gte: c.launchedAt!, lte: end } },
        select: { clientExternalId: true },
        distinct: ['clientExternalId'],
      });
      n += rows.length;
    }
    return n;
  };
  const [ct, ch] = await Promise.all([converters(groups.treated), converters(groups.holdout)]);
  const msgStats = await prisma.message.groupBy({ by: ['channel', 'status'], where: { campaignId: id }, _count: { _all: true } });
  // Opt-out rate is a primary metric (plan §12.2): clients in the treated group who withdrew consent in the window.
  let optOuts = 0;
  for (let i = 0; i < treatedIds.length; i += 1000) {
    const rows = await prisma.consentAudit.findMany({
      where: { granted: false, createdAt: { gte: c.launchedAt, lte: end }, clientId: { in: treatedIds.slice(i, i + 1000) } },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    optOuts += rows.length;
  }
  const rT = groups.treated.length ? ct / groups.treated.length : 0;
  const rH = groups.holdout.length ? ch / groups.holdout.length : 0;
  return {
    campaign: c.code,
    goalEvent: c.goalEvent,
    attributionDays: c.attributionDays,
    windowClosed: new Date() > end,
    treated: groups.treated.length,
    holdout: groups.holdout.length,
    convertedTreated: ct,
    convertedHoldout: ch,
    conversionTreated: rT,
    conversionHoldout: rH,
    uplift: rT - rH,
    incrementalConversions: Math.round((rT - rH) * groups.treated.length),
    messages: msgStats.map((m) => ({ channel: m.channel, status: m.status, count: m._count._all })),
    optOuts,
    optOutRate: groups.treated.length ? optOuts / groups.treated.length : 0,
  };
}

// ── Offers ──────────────────────────────────────────────────────────────────

export function computeOfferRoute(o: Pick<Offer, 'costPerRedemption' | 'expectedRedemption' | 'eligibleCount' | 'holdoutPct' | 'isNewMechanic' | 'touchesPricing'>) {
  const econ = offerEconomics(o);
  const route = approvalRoute(econ.worstCaseCost, o.isNewMechanic, o.touchesPricing);
  return { econ, route };
}

export async function offerStatus(id: string) {
  const o = await prisma.offer.findUniqueOrThrow({ where: { id }, include: { approvals: true } });
  const { econ, route } = computeOfferRoute(o);
  const approvedRoles = o.approvals.filter((a) => a.decision === 'approved').map((a) => a.role);
  const problems = offerReadiness({
    ...o,
    approvedRoles,
    requiredRoles: route.requiredRoles,
  });
  const earliestStart = addBusinessDays(o.createdAt, route.leadTimeWorkingDays);
  if (o.startDate && o.startDate < earliestStart) {
    problems.push(`Lead time: ${route.leadTimeWorkingDays} working days → earliest start ${earliestStart.toISOString().slice(0, 10)}`);
  }
  return { offer: o, econ, route, approvedRoles, problems, ready: problems.length === 0 };
}
