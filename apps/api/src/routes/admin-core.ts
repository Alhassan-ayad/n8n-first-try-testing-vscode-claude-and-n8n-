// Admin: auth, dashboard, clients (single client view), messages, events,
// settings/provider status, users, audit, reference data.

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CATEGORIES,
  CHANNELS,
  CONSENT_CHANNELS,
  CONSENTABLE_TOPICS,
  config,
  EVENT_TYPES,
  KINDS,
  KNOWN_TAGS,
  LIFECYCLE_STAGES,
  OBJECTIVES,
  OFFER_MECHANICS,
  STAGE_LABELS,
  TOPICS,
  VALUE_TIERS,
  CAMPAIGN_SLOTS,
  FREQUENCY_CAPS,
} from '@cep/core';
import { getProvider, providerStatus } from '@cep/providers';
import { joinCsv, type Prisma, prisma, splitCsv } from '@cep/db';
import { audit, createCallTask, dashboard, ingestEvents, preferences, setConsents, setTags } from '@cep/engine';
import { actor, HttpError, paging, parse, requireAdmin, requireRole } from '../http';

export const ADMIN_ROLES = [
  'admin',
  'crm',
  'marketing',
  'head_of_marketing',
  'cfo',
  'ceo',
  'compliance',
  'legal',
  'treasury',
  'research',
  'content',
  'callcentre',
  'cx',
  'viewer',
] as const;

export async function adminCoreRoutes(app: FastifyInstance) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/admin/auth/login', { schema: { tags: ['admin'], summary: 'Sign in' } }, async (req) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.adminUser.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password');
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const roles = splitCsv(user.roles);
    const token = await app.jwt.sign({ sub: user.id, email: user.email, name: user.name, roles }, { expiresIn: '12h' });
    return { token, user: { id: user.id, email: user.email, name: user.name, roles } };
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin);

    r.get('/admin/auth/me', async (req) => req.admin);

    r.get('/admin/meta', { schema: { tags: ['admin'], summary: 'Reference data for the console' } }, async () => ({
      channels: CHANNELS,
      consentChannels: CONSENT_CHANNELS,
      topics: TOPICS,
      consentableTopics: CONSENTABLE_TOPICS,
      categories: CATEGORIES,
      kinds: KINDS,
      stages: LIFECYCLE_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] })),
      tiers: VALUE_TIERS,
      tags: KNOWN_TAGS,
      objectives: OBJECTIVES,
      mechanics: OFFER_MECHANICS,
      events: EVENT_TYPES,
      slots: CAMPAIGN_SLOTS,
      caps: FREQUENCY_CAPS,
      roles: ADMIN_ROLES,
      providerMode: config().PROVIDER_MODE,
    }));

    r.get('/admin/dashboard', { schema: { tags: ['admin'] } }, async (req) => {
      const days = Math.min(365, Number((req.query as { days?: string }).days ?? 30) || 30);
      return dashboard(days);
    });

    // ── Clients ─────────────────────────────────────────────────────────────
    r.get('/admin/clients', { schema: { tags: ['admin'] } }, async (req) => {
      const q = req.query as Record<string, string>;
      const { skip, take, page, pageSize } = paging(q);
      const and: Prisma.ClientWhereInput[] = [];
      if (q.q) {
        and.push({
          OR: [
            { externalId: q.q },
            { fullName: { contains: q.q } },
            { phone: { contains: q.q.replace(/\D/g, '').slice(-9) || q.q } },
            { email: { contains: q.q.toLowerCase() } },
          ],
        });
      }
      if (q.stage) and.push({ lifecycleStage: q.stage });
      if (q.tier) and.push({ valueTier: q.tier });
      if (q.tag) and.push({ tags: { contains: q.tag } });
      const where = { AND: and };
      const [total, items] = await Promise.all([
        prisma.client.count({ where }),
        prisma.client.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take }),
      ]);
      return { total, page, pageSize, items };
    });

    r.get('/admin/clients/:id', { schema: { tags: ['admin'], summary: 'Single client view' } }, async (req) => {
      const { id } = req.params as { id: string };
      const client = await prisma.client.findFirst({ where: { OR: [{ id }, { externalId: id }] } });
      if (!client) throw new HttpError(404, 'Client not found');
      const [prefs, consentAudit, messages, enrollments, callTasks, devices, alerts, surveys, events] = await Promise.all([
        preferences(client.id),
        prisma.consentAudit.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.message.findMany({
          where: { clientId: client.id },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, templateKey: true, channel: true, category: true, kind: true, status: true, statusReason: true, subject: true, title: true, body: true, createdAt: true, sentAt: true, releaseAt: true, campaignId: true, journeyStepId: true },
        }),
        prisma.journeyEnrollment.findMany({ where: { clientId: client.id }, orderBy: { enteredAt: 'desc' }, include: { stepRuns: { orderBy: { fireAt: 'asc' } } } }),
        prisma.callTask.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } }),
        prisma.device.findMany({ where: { clientId: client.id } }),
        prisma.priceAlert.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } }),
        prisma.surveyResponse.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } }),
        prisma.eventLog.findMany({ where: { clientExternalId: client.externalId }, orderBy: { occurredAt: 'desc' }, take: 100 }),
      ]);
      const suppressions = await prisma.suppression.findMany({
        where: { OR: [{ clientId: client.id }, { value: { in: [client.id, client.email ?? '-', client.phone ?? '-'] } }] },
      });
      return {
        client: { ...client, tags: splitCsv(client.tags) },
        preferences: prefs,
        consentAudit,
        messages: messages.map((m) => ({ ...m, body: m.kind === 'otp' ? '[redacted]' : m.body })),
        enrollments,
        callTasks,
        devices: devices.map((d) => ({ ...d, token: `${d.token.slice(0, 12)}…` })),
        alerts,
        surveys,
        events,
        suppressions,
      };
    });

    r.put('/admin/clients/:id/tags', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(z.object({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) }), req.body);
      const c = await setTags(id, body.add, body.remove);
      await audit(actor(req), 'tags', 'client', id, body);
      return { tags: splitCsv(c.tags) };
    });

    r.post('/admin/clients/:id/consents', { preHandler: requireRole('crm', 'cx', 'callcentre') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({
          changes: z.array(z.object({ channel: z.enum(CONSENT_CHANNELS), topic: z.enum(CONSENTABLE_TOPICS as [string, ...string[]]), granted: z.boolean() })),
          note: z.string().min(3),
        }),
        req.body,
      );
      await setConsents(id, body.changes as Parameters<typeof setConsents>[1], { source: 'admin', actor: actor(req), wordingText: body.note });
      return preferences(id);
    });

    r.post('/admin/clients/:id/call-tasks', { preHandler: requireRole('crm', 'callcentre', 'cx') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(z.object({ reason: z.string(), priority: z.number().int().min(1).max(9).default(5) }), req.body);
      const c = await prisma.client.findUniqueOrThrow({ where: { id } });
      return { result: await createCallTask(c, body.reason, body.priority, null) };
    });

    // ── Messages & events ───────────────────────────────────────────────────
    r.get('/admin/messages', { schema: { tags: ['admin'] } }, async (req) => {
      const q = req.query as Record<string, string>;
      const { skip, take, page, pageSize } = paging(q);
      const where: Prisma.MessageWhereInput = {
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.templateKey ? { templateKey: q.templateKey } : {}),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        ...(q.category ? { category: q.category } : {}),
      };
      const [total, items] = await Promise.all([
        prisma.message.count({ where }),
        prisma.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: { id: true, clientId: true, templateKey: true, channel: true, category: true, kind: true, topic: true, status: true, statusReason: true, toAddress: true, subject: true, title: true, body: true, releaseAt: true, sentAt: true, createdAt: true, provider: true, campaignId: true },
        }),
      ]);
      return { total, page, pageSize, items: items.map((m) => ({ ...m, body: m.kind === 'otp' ? '[redacted]' : m.body })) };
    });

    r.get('/admin/messages/:id', async (req) => {
      const { id } = req.params as { id: string };
      const m = await prisma.message.findUnique({ where: { id }, include: { deliveryEvents: { orderBy: { occurredAt: 'asc' } } } });
      if (!m) throw new HttpError(404, 'Not found');
      return { ...m, attachments: m.attachments ? '[attachment]' : null, body: m.kind === 'otp' ? '[redacted]' : m.body };
    });

    r.get('/admin/events', { schema: { tags: ['admin'] } }, async (req) => {
      const q = req.query as Record<string, string>;
      const { skip, take, page, pageSize } = paging(q);
      const where: Prisma.EventLogWhereInput = {
        ...(q.type ? { type: q.type } : {}),
        ...(q.clientExternalId ? { clientExternalId: q.clientExternalId } : {}),
        ...(q.errors === '1' ? { error: { not: null } } : {}),
      };
      const [total, items] = await Promise.all([
        prisma.eventLog.count({ where }),
        prisma.eventLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      ]);
      return { total, page, pageSize, items };
    });

    r.post('/admin/events', { preHandler: requireRole('admin'), schema: { tags: ['admin'], summary: 'Inject a test event' } }, async (req) => {
      const body = parse(
        z.object({ type: z.enum(EVENT_TYPES), clientExternalId: z.string().optional(), payload: z.record(z.string(), z.unknown()).default({}) }),
        req.body,
      );
      const id = `admin:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const n = await ingestEvents([{ id, ...body }], 'api');
      await audit(actor(req), 'inject_event', 'event', id, body);
      return { id, processed: n };
    });

    // ── Settings & provider status ──────────────────────────────────────────
    r.get('/admin/settings/providers', { schema: { tags: ['admin'] } }, async () => {
      const base = config().PUBLIC_BASE_URL;
      return {
        providers: providerStatus(),
        webhooks: {
          sendgridEvents: `${base}/webhooks/sendgrid`,
          ezagelDlr: `${base}/webhooks/ezagel/dlr?token=<EZAGEL_WEBHOOK_TOKEN>`,
          ezagelInbound: `${base}/webhooks/ezagel/inbound?token=<EZAGEL_WEBHOOK_TOKEN>`,
          unsubscribe: `${base}/u/<token>`,
        },
        cdc: {
          configured: Boolean(config().SOURCE_MSSQL_URL),
          checkpoints: await prisma.cdcCheckpoint.findMany(),
          lastEvent: await prisma.eventLog.findFirst({ where: { source: 'cdc' }, orderBy: { createdAt: 'desc' }, select: { type: true, createdAt: true } }),
        },
      };
    });

    r.post('/admin/settings/test-send', { preHandler: requireRole('admin'), schema: { tags: ['admin'], summary: 'Send a raw test through a provider' } }, async (req) => {
      const body = parse(
        z.object({
          channel: z.enum(['sms', 'email', 'push', 'whatsapp']),
          to: z.string().min(3),
          subject: z.string().default('mngm test message'),
          body: z.string().default('This is a test message from the mngm engagement platform.'),
        }),
        req.body,
      );
      const provider = getProvider(body.channel);
      const result = await provider.send({
        id: `test-${Date.now()}`,
        channel: body.channel,
        language: /[؀-ۿ]/.test(body.body) ? 'ar' : 'en',
        to: body.channel === 'push' ? undefined : body.to,
        tokens: body.channel === 'push' ? [body.to] : undefined,
        subject: body.subject,
        title: body.subject,
        body: body.body,
        html: body.channel === 'email' ? `<p>${body.body}</p>` : undefined,
        deepLink: `${config().APP_DEEPLINK_BASE}/home`,
        category: 'A',
        topic: 'transactional',
        marketing: false,
      });
      await audit(actor(req), 'test_send', 'provider', body.channel, { to: body.to, accepted: result.accepted, error: result.error });
      return result;
    });

    // ── Users ───────────────────────────────────────────────────────────────
    r.get('/admin/users', { preHandler: requireRole('admin') }, async () =>
      (await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } })).map(({ passwordHash: _p, ...u }) => ({ ...u, roles: splitCsv(u.roles) })),
    );

    r.post('/admin/users', { preHandler: requireRole('admin') }, async (req) => {
      const body = parse(
        z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(10), roles: z.array(z.enum(ADMIN_ROLES)).min(1) }),
        req.body,
      );
      const u = await prisma.adminUser.create({
        data: { email: body.email.toLowerCase(), name: body.name, passwordHash: await bcrypt.hash(body.password, 10), roles: joinCsv(body.roles) },
      });
      await audit(actor(req), 'create', 'admin_user', u.id, { email: u.email, roles: body.roles });
      return { id: u.id };
    });

    r.put('/admin/users/:id', { preHandler: requireRole('admin') }, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({ name: z.string().optional(), password: z.string().min(10).optional(), roles: z.array(z.enum(ADMIN_ROLES)).optional(), active: z.boolean().optional() }),
        req.body,
      );
      await prisma.adminUser.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10) } : {}),
          ...(body.roles ? { roles: joinCsv(body.roles) } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await audit(actor(req), 'update', 'admin_user', id, { ...body, password: body.password ? '***' : undefined });
      return { ok: true };
    });

    r.get('/admin/audit', async (req) => {
      const q = req.query as Record<string, string>;
      const { skip, take } = paging(q);
      return prisma.auditLog.findMany({
        where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
    });
  });
}
