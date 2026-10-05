// Admin: campaign register and offer register with the §8.3 / §9.2 approval
// routes, plus journeys, suppression and call lists.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CAMPAIGN_SLOTS,
  JOURNEY_BY_KEY,
  MIN_OFFER_HOLDOUT_PCT,
  OFFER_MECHANICS,
  segmentFilterSchema,
  segmentToWhere,
} from '@cep/core';
import { joinCsv, type Prisma, prisma } from '@cep/db';
import {
  audit,
  campaignResults,
  computeOfferRoute,
  countAudience,
  enrolByKey,
  journeyStats,
  launchCampaign,
  offerStatus,
  scheduleCampaign,
  suppress,
  validateCampaign,
} from '@cep/engine';
import { actor, hasRole, HttpError, paging, parse, requireAdmin, requireRole, sendCsv } from '../http';

const campaignBody = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{3,40}$/),
  name: z.string().min(3),
  objective: z.enum(['O1', 'O2', 'O3', 'O4', 'O5']),
  hypothesis: z.string().min(10),
  segmentId: z.string().nullish(),
  segmentFilter: segmentFilterSchema,
  holdoutPct: z.number().int().min(MIN_OFFER_HOLDOUT_PCT).max(50).default(10),
  channels: z.array(z.enum(['push', 'email', 'sms', 'inapp', 'whatsapp'])).min(1),
  templateKey: z.string(),
  topic: z.enum(['promotions', 'education', 'lifecycle', 'market_research']),
  kind: z.enum(['promotion', 'education', 'lifecycle', 'research']).default('promotion'),
  offerId: z.string().nullish(),
  sendDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  slot: z.enum(CAMPAIGN_SLOTS).nullish(),
  goalEvent: z.string().default('order.executed'),
  attributionDays: z.number().int().min(1).max(30).default(7),
});

const offerBody = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{3,40}$/),
  name: z.string().min(3),
  mechanic: z.enum(Object.keys(OFFER_MECHANICS) as [string, ...string[]]),
  eligibility: z.string().min(5),
  exclusions: z.string().nullish(),
  hypothesis: z.string().min(10),
  costPerRedemption: z.number().nonnegative(),
  expectedRedemption: z.number().min(0).max(1),
  eligibleCount: z.number().int().nonnegative(),
  isNewMechanic: z.boolean().default(false),
  touchesPricing: z.boolean().default(false),
  metalDenominated: z.boolean().default(true),
  hedgeReference: z.string().nullish(),
  holdoutPct: z.number().int().min(MIN_OFFER_HOLDOUT_PCT).max(50).default(10),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
  termsUrlEn: z.string().url().nullish(),
  termsUrlAr: z.string().url().nullish(),
  helpCentreUrl: z.string().url().nullish(),
});

export async function adminRegisterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ── Campaign register ─────────────────────────────────────────────────────
  app.get('/admin/campaigns', async () => prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } }));

  app.get('/admin/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    return { ...c, problems: await validateCampaign(c) };
  });

  app.post('/admin/campaigns', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing') }, async (req) => {
    const b = parse(campaignBody, req.body);
    const size = await countAudience(b.segmentFilter);
    const c = await prisma.campaign.create({
      data: { ...b, channels: joinCsv(b.channels), segmentFilter: JSON.stringify(b.segmentFilter), segmentSize: size, createdBy: actor(req) },
    });
    await audit(actor(req), 'create', 'campaign', c.id, { code: c.code });
    return c;
  });

  app.put('/admin/campaigns/:id', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    const current = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    if (!['draft', 'in_review'].includes(current.status)) throw new HttpError(409, 'Only draft or in-review campaigns can be edited');
    const b = parse(campaignBody, req.body);
    const size = await countAudience(b.segmentFilter);
    const c = await prisma.campaign.update({
      where: { id },
      data: {
        ...b,
        channels: joinCsv(b.channels),
        segmentFilter: JSON.stringify(b.segmentFilter),
        segmentSize: size,
        status: 'draft',
        complianceReviewer: null,
        approver: null,
        approvedAt: null,
      },
    });
    await audit(actor(req), 'update', 'campaign', id);
    return c;
  });

  app.post('/admin/campaigns/:id/submit', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    const problems = await validateCampaign(c);
    if (problems.length) throw new HttpError(422, 'Campaign is not ready', problems);
    await audit(actor(req), 'submit', 'campaign', id);
    return prisma.campaign.update({ where: { id }, data: { status: 'in_review' } });
  });

  app.post('/admin/campaigns/:id/compliance', { preHandler: requireRole('compliance') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ approved: z.boolean(), note: z.string().optional() }), req.body);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    if (c.status !== 'in_review') throw new HttpError(409, 'Campaign is not in review');
    await audit(actor(req), b.approved ? 'compliance_ok' : 'compliance_reject', 'campaign', id, b);
    return prisma.campaign.update({
      where: { id },
      data: b.approved ? { complianceReviewer: actor(req), complianceNote: b.note } : { status: 'draft', complianceNote: b.note, complianceReviewer: null },
    });
  });

  app.post('/admin/campaigns/:id/approve', { preHandler: requireRole('head_of_marketing', 'ceo') }, async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    if (c.status !== 'in_review') throw new HttpError(409, 'Campaign is not in review');
    if (!c.complianceReviewer) throw new HttpError(409, 'Compliance review is required before approval (§9.2)');
    if (c.offerId) {
      const o = await prisma.offer.findUnique({ where: { id: c.offerId } });
      // Offers touching pricing or above EGP 500k need CEO sign-off on the campaign too.
      if (o && (o.approvalTier === 'above_500k' || o.approvalTier === 'pricing') && !hasRole(req, 'ceo')) {
        throw new HttpError(403, 'This campaign carries an offer that requires CEO approval');
      }
    }
    await audit(actor(req), 'approve', 'campaign', id);
    return prisma.campaign.update({ where: { id }, data: { status: 'approved', approver: actor(req), approvedAt: new Date() } });
  });

  app.post('/admin/campaigns/:id/schedule', { preHandler: requireRole('crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    try {
      return await scheduleCampaign(id, actor(req));
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
  });

  app.post('/admin/campaigns/:id/launch-now', { preHandler: requireRole('admin'), schema: { summary: 'Admin: launch an approved campaign immediately (policy still applies)' } }, async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    if (!['approved', 'scheduled'].includes(c.status)) throw new HttpError(409, 'Campaign must be approved');
    const problems = await validateCampaign(c);
    if (problems.length) throw new HttpError(422, 'Campaign is not ready', problems);
    await launchCampaign(c);
    await audit(actor(req), 'launch_now', 'campaign', id);
    return { ok: true };
  });

  app.post('/admin/campaigns/:id/cancel', { preHandler: requireRole('crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.campaign.update({ where: { id }, data: { status: 'cancelled' } });
    await prisma.message.updateMany({
      where: { campaignId: id, status: { in: ['pending', 'deferred', 'held'] } },
      data: { status: 'cancelled', statusReason: 'campaign_cancelled' },
    });
    await audit(actor(req), 'cancel', 'campaign', id);
    return c;
  });

  app.get('/admin/campaigns/:id/results', async (req) => campaignResults((req.params as { id: string }).id));

  app.post('/admin/campaigns/:id/decision', { preHandler: requireRole('head_of_marketing', 'crm') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ decision: z.enum(['keep', 'change', 'stop']), note: z.string().min(3) }), req.body);
    const result = await campaignResults(id);
    await audit(actor(req), 'decision', 'campaign', id, b);
    return prisma.campaign.update({ where: { id }, data: { decision: b.decision, decisionNote: b.note, result: JSON.stringify(result) } });
  });

  // ── Offer register ────────────────────────────────────────────────────────
  app.get('/admin/offers', async () => {
    const offers = await prisma.offer.findMany({ orderBy: { createdAt: 'desc' }, include: { approvals: true } });
    return offers.map((o) => ({ ...o, ...computeOfferRoute(o) }));
  });

  app.get('/admin/offers/:id', async (req) => offerStatus((req.params as { id: string }).id));

  const saveOffer = async (b: z.infer<typeof offerBody>) => {
    const { econ, route } = computeOfferRoute(b);
    return {
      ...b,
      worstCaseCost: econ.worstCaseCost,
      approvalTier: route.tier,
      requiredApprovals: joinCsv(route.requiredRoles),
      complianceLevel: route.complianceLevel,
    };
  };

  app.post('/admin/offers', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing', 'product') }, async (req) => {
    const b = parse(offerBody, req.body);
    const o = await prisma.offer.create({ data: { ...(await saveOffer(b)), createdBy: actor(req) } });
    await audit(actor(req), 'create', 'offer', o.id, { code: o.code });
    return offerStatus(o.id);
  });

  app.put('/admin/offers/:id', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    const current = await prisma.offer.findUniqueOrThrow({ where: { id } });
    if (!['draft', 'pending_approval', 'rejected'].includes(current.status)) throw new HttpError(409, 'Approved or live offers cannot be edited');
    const b = parse(offerBody, req.body);
    await prisma.offerApproval.deleteMany({ where: { offerId: id } }); // any change resets approvals
    await prisma.offer.update({ where: { id }, data: { ...(await saveOffer(b)), status: 'draft' } });
    await audit(actor(req), 'update', 'offer', id);
    return offerStatus(id);
  });

  app.post('/admin/offers/:id/submit', { preHandler: requireRole('marketing', 'crm', 'head_of_marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.offer.update({ where: { id }, data: { status: 'pending_approval' } });
    await audit(actor(req), 'submit', 'offer', id);
    return offerStatus(id);
  });

  app.post('/admin/offers/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ role: z.string(), decision: z.enum(['approved', 'rejected']).default('approved'), note: z.string().optional() }), req.body);
    if (!hasRole(req, b.role)) throw new HttpError(403, `You don't hold the ${b.role} role`);
    const o = await prisma.offer.findUniqueOrThrow({ where: { id } });
    if (o.status !== 'pending_approval') throw new HttpError(409, 'Offer is not pending approval');
    await prisma.offerApproval.upsert({
      where: { offerId_role: { offerId: id, role: b.role } },
      create: { offerId: id, role: b.role, approver: actor(req), decision: b.decision, note: b.note },
      update: { approver: actor(req), decision: b.decision, note: b.note, createdAt: new Date() },
    });
    await audit(actor(req), `offer_${b.decision}`, 'offer', id, b);
    if (b.decision === 'rejected') {
      await prisma.offer.update({ where: { id }, data: { status: 'rejected' } });
      return offerStatus(id);
    }
    const status = await offerStatus(id);
    if (status.ready) await prisma.offer.update({ where: { id }, data: { status: 'approved' } });
    return offerStatus(id);
  });

  app.post('/admin/offers/:id/review', { preHandler: requireRole('head_of_marketing', 'crm', 'cfo') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({
        actualRedemptions: z.number().int().nonnegative(),
        actualCost: z.number().nonnegative(),
        result: z.string().min(5),
        decision: z.enum(['keep', 'change', 'stop']),
      }),
      req.body,
    );
    await audit(actor(req), 'review', 'offer', id, b);
    return prisma.offer.update({ where: { id }, data: { ...b, status: 'reviewed' } });
  });

  // ── Journeys ──────────────────────────────────────────────────────────────
  app.get('/admin/journeys', async () => journeyStats());

  app.put('/admin/journeys/:key', { preHandler: requireRole('crm') }, async (req) => {
    const { key } = req.params as { key: string };
    if (!JOURNEY_BY_KEY.has(key)) throw new HttpError(404, 'Unknown journey');
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    await prisma.journey.upsert({ where: { key }, create: { key, enabled: b.enabled, updatedBy: actor(req) }, update: { enabled: b.enabled, updatedBy: actor(req) } });
    await audit(actor(req), b.enabled ? 'enable' : 'disable', 'journey', key);
    return { key, enabled: b.enabled };
  });

  app.get('/admin/journeys/:key/enrollments', async (req) => {
    const { key } = req.params as { key: string };
    const q = req.query as Record<string, string>;
    const { skip, take } = paging(q);
    return prisma.journeyEnrollment.findMany({
      where: { journeyKey: key, ...(q.status ? { status: q.status } : {}) },
      orderBy: { enteredAt: 'desc' },
      skip,
      take,
      include: { client: { select: { externalId: true, fullName: true, lifecycleStage: true, valueTier: true } } },
    });
  });

  app.post('/admin/journeys/:key/enrol', { preHandler: requireRole('crm'), schema: { summary: 'Enrol a segment (e.g. former instalment-finance migration)' } }, async (req) => {
    const { key } = req.params as { key: string };
    const def = JOURNEY_BY_KEY.get(key);
    if (!def) throw new HttpError(404, 'Unknown journey');
    if (!def.entry.manual && !def.entry.scan) throw new HttpError(409, 'This journey is event-driven only');
    const b = parse(z.object({ filter: segmentFilterSchema, limit: z.number().int().min(1).max(50_000).default(10_000) }), req.body);
    const clients = await prisma.client.findMany({ where: segmentToWhere(b.filter) as Prisma.ClientWhereInput, take: b.limit });
    let enrolled = 0;
    for (const c of clients) if (await enrolByKey(key, c, { source: 'admin', actor: actor(req) })) enrolled++;
    await audit(actor(req), 'enrol_segment', 'journey', key, { matched: clients.length, enrolled });
    return { matched: clients.length, enrolled };
  });

  // ── Suppression list ──────────────────────────────────────────────────────
  app.get('/admin/suppressions', async (req) => {
    const q = req.query as Record<string, string>;
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.SuppressionWhereInput = {
      ...(q.q ? { value: { contains: q.q.toLowerCase() } } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.suppression.count({ where }),
      prisma.suppression.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    return { total, page, pageSize, items };
  });

  app.post('/admin/suppressions', { preHandler: requireRole('crm', 'compliance', 'cx') }, async (req) => {
    const b = parse(
      z.object({
        channel: z.enum(['email', 'sms', 'push', 'whatsapp', 'call', 'all']),
        value: z.string().min(3),
        scope: z.enum(['marketing', 'all']).default('marketing'),
        reason: z.string().default('manual'),
        note: z.string().optional(),
      }),
      req.body,
    );
    await suppress({ ...b, source: `admin:${actor(req)}` });
    await audit(actor(req), 'suppress', 'suppression', null, b);
    return { ok: true };
  });

  app.delete('/admin/suppressions/:id', { preHandler: requireRole('compliance', 'admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await prisma.suppression.delete({ where: { id } });
    await audit(actor(req), 'unsuppress', 'suppression', id, row);
    return { ok: true };
  });

  // ── Call lists (CRM-generated, never a manual export) ─────────────────────
  app.get('/admin/call-tasks', async (req) => {
    const q = req.query as Record<string, string>;
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.CallTaskWhereInput = {
      ...(q.status ? { status: q.status } : { status: { in: ['open', 'in_progress'] } }),
      ...(q.reason ? { reason: q.reason } : {}),
      ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.callTask.count({ where }),
      prisma.callTask.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }],
        skip,
        take,
        include: { client: { select: { externalId: true, fullName: true, phone: true, language: true, valueTier: true, lifecycleStage: true, kycStatus: true } } },
      }),
    ]);
    return { total, page, pageSize, items };
  });

  app.get('/admin/call-tasks/export.csv', { preHandler: requireRole('callcentre', 'crm') }, async (req, reply) => {
    const rows = await prisma.callTask.findMany({
      where: { status: 'open' },
      orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }],
      include: { client: true },
    });
    await audit(actor(req), 'export', 'call_tasks', null, { rows: rows.length });
    return sendCsv(
      reply,
      `call-list-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((t) => ({
        taskId: t.id,
        reason: t.reason,
        priority: t.priority,
        dueAt: t.dueAt,
        clientId: t.client.externalId,
        name: t.client.fullName,
        phone: t.client.phone,
        language: t.client.language,
        tier: t.client.valueTier,
        stage: t.client.lifecycleStage,
      })),
    );
  });

  app.put('/admin/call-tasks/:id', { preHandler: requireRole('callcentre', 'crm', 'cx') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({
        status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
        outcome: z.enum(['reached_converted', 'reached_not_interested', 'reached_callback', 'no_answer', 'wrong_number', 'do_not_call']).optional(),
        notes: z.string().max(2000).optional(),
        assignedTo: z.string().optional(),
      }),
      req.body,
    );
    const t = await prisma.callTask.update({
      where: { id },
      data: { ...b, ...(b.status === 'done' ? { completedAt: new Date() } : {}) },
      include: { client: true },
    });
    if (b.outcome === 'do_not_call') {
      await suppress({ channel: 'call', value: t.client.id, scope: 'marketing', reason: 'do_not_call', source: 'callcentre', clientId: t.client.id });
    }
    if (b.outcome === 'wrong_number' && t.client.phone) {
      await suppress({ channel: 'call', value: t.client.phone, scope: 'all', reason: 'wrong_number', source: 'callcentre', clientId: t.client.id });
    }
    await audit(actor(req), 'call_outcome', 'call_task', id, b);
    return t;
  });
}
