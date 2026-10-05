// Admin: templates (with compliance workflow), segments, banners, incidents.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CATEGORIES,
  type Channel,
  config,
  hasBlockingIssues,
  type Kind,
  lintTemplate,
  baseVars,
  render,
  renderText,
  requiredTemplates,
  segmentFilterSchema,
  segmentToWhere,
  type Topic,
  TOPICS,
} from '@cep/core';
import { prisma } from '@cep/db';
import { audit, countAudience, createMessage, emailLayout, startBroadcast, textToHtml } from '@cep/engine';
import { actor, hasRole, HttpError, parse, requireAdmin, requireRole } from '../http';

const templateBody = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  channel: z.enum(['email', 'sms', 'push', 'inapp', 'whatsapp']),
  language: z.enum(['ar', 'en']),
  category: z.enum(CATEGORIES),
  topic: z.enum(TOPICS),
  subject: z.string().max(500).nullish(),
  title: z.string().max(500).nullish(),
  body: z.string().min(1),
  html: z.string().nullish(),
  deepLink: z.string().max(1000).nullish(),
  imageUrl: z.string().max(1000).nullish(),
  owner: z.string().nullish(),
});

function lint(t: z.infer<typeof templateBody>) {
  return lintTemplate({ ...t, channel: t.channel as Channel });
}

export async function adminContentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ── Templates ─────────────────────────────────────────────────────────────
  app.get('/admin/templates', { schema: { tags: ['admin'] } }, async (req) => {
    const q = req.query as Record<string, string>;
    const rows = await prisma.template.findMany({
      where: {
        ...(q.key ? { key: { contains: q.key } } : {}),
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.language ? { language: q.language } : {}),
        ...(q.category ? { category: q.category } : {}),
      },
      orderBy: [{ key: 'asc' }, { channel: 'asc' }, { language: 'asc' }, { version: 'desc' }],
    });
    if (q.all === '1') return rows;
    // Latest version per key/channel/language.
    const seen = new Set<string>();
    return rows.filter((t) => {
      const k = `${t.key}|${t.channel}|${t.language}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

  app.get('/admin/templates/coverage', { schema: { tags: ['admin'], summary: 'Required templates vs approved coverage' } }, async () => {
    const approved = await prisma.template.findMany({ where: { status: 'approved' }, select: { key: true, channel: true, language: true } });
    const have = new Set(approved.map((t) => `${t.key}|${t.channel}|${t.language}`));
    const out = [];
    for (const [key, channels] of requiredTemplates()) {
      for (const channel of channels) {
        out.push({ key, channel, ar: have.has(`${key}|${channel}|ar`), en: have.has(`${key}|${channel}|en`) });
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  });

  app.get('/admin/templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.template.findUnique({ where: { id } });
    if (!t) throw new HttpError(404, 'Not found');
    const versions = await prisma.template.findMany({
      where: { key: t.key, channel: t.channel, language: t.language },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, approvedBy: true, approvedAt: true, updatedAt: true },
    });
    return { ...t, versions };
  });

  app.post('/admin/lint', async (req) => {
    const t = parse(templateBody.partial({ key: true, category: true, topic: true }).extend({ body: z.string() }), req.body);
    return lintTemplate({ ...t, channel: (t.channel ?? 'sms') as Channel, language: t.language ?? 'en' });
  });

  app.post('/admin/templates', { preHandler: requireRole('crm', 'marketing', 'content', 'research') }, async (req) => {
    const t = parse(templateBody, req.body);
    const last = await prisma.template.findFirst({ where: { key: t.key, channel: t.channel, language: t.language }, orderBy: { version: 'desc' } });
    const created = await prisma.template.create({
      data: { ...t, version: (last?.version ?? 0) + 1, status: 'draft', lintReport: JSON.stringify(lint(t)), owner: t.owner ?? actor(req) },
    });
    await audit(actor(req), 'create', 'template', created.id, { key: t.key, channel: t.channel, language: t.language });
    return created;
  });

  app.put('/admin/templates/:id', { preHandler: requireRole('crm', 'marketing', 'content', 'research') }, async (req) => {
    const { id } = req.params as { id: string };
    const current = await prisma.template.findUniqueOrThrow({ where: { id } });
    const t = parse(templateBody, { ...current, ...(req.body as object) });
    const report = JSON.stringify(lint(t));
    // Approved / in-review templates are immutable: edits create a new draft version (§9.2).
    if (['approved', 'in_review', 'retired'].includes(current.status)) {
      const last = await prisma.template.findFirst({ where: { key: t.key, channel: t.channel, language: t.language }, orderBy: { version: 'desc' } });
      const created = await prisma.template.create({
        data: { ...t, version: (last?.version ?? 0) + 1, status: 'draft', lintReport: report, owner: actor(req) },
      });
      await audit(actor(req), 'new_version', 'template', created.id, { from: id });
      return created;
    }
    const updated = await prisma.template.update({ where: { id }, data: { ...t, lintReport: report, status: 'draft' } });
    await audit(actor(req), 'update', 'template', id);
    return updated;
  });

  app.post('/admin/templates/:id/submit', { preHandler: requireRole('crm', 'marketing', 'content', 'research') }, async (req) => {
    const { id } = req.params as { id: string };
    const t = await prisma.template.findUniqueOrThrow({ where: { id } });
    const issues = lintTemplate({ ...t, channel: t.channel as Channel, language: t.language as 'ar' | 'en' });
    if (hasBlockingIssues(issues)) throw new HttpError(422, 'Compliance lint failed', issues);
    const updated = await prisma.template.update({
      where: { id },
      data: { status: 'in_review', submittedBy: actor(req), lintReport: JSON.stringify(issues) },
    });
    await audit(actor(req), 'submit', 'template', id);
    return updated;
  });

  app.post('/admin/templates/:id/approve', { preHandler: requireRole('compliance') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ note: z.string().optional() }), req.body ?? {});
    const t = await prisma.template.findUniqueOrThrow({ where: { id } });
    if (t.status !== 'in_review') throw new HttpError(409, 'Only templates in review can be approved');
    if (t.submittedBy === actor(req) && !hasRole(req, 'admin')) throw new HttpError(403, 'Four-eyes rule: the submitter cannot approve');
    const issues = lintTemplate({ ...t, channel: t.channel as Channel, language: t.language as 'ar' | 'en' });
    if (hasBlockingIssues(issues)) throw new HttpError(422, 'Compliance lint failed', issues);
    await prisma.$transaction([
      prisma.template.updateMany({
        where: { key: t.key, channel: t.channel, language: t.language, status: 'approved', id: { not: id } },
        data: { status: 'retired' },
      }),
      prisma.template.update({
        where: { id },
        data: { status: 'approved', approvedBy: actor(req), approvedAt: new Date(), reviewedBy: actor(req), reviewNote: body.note },
      }),
    ]);
    await audit(actor(req), 'approve', 'template', id, body);
    return prisma.template.findUnique({ where: { id } });
  });

  app.post('/admin/templates/:id/reject', { preHandler: requireRole('compliance') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ note: z.string().min(3) }), req.body);
    const updated = await prisma.template.update({ where: { id }, data: { status: 'rejected', reviewedBy: actor(req), reviewNote: body.note } });
    await audit(actor(req), 'reject', 'template', id, body);
    return updated;
  });

  app.post('/admin/templates/:id/retire', { preHandler: requireRole('compliance', 'crm') }, async (req) => {
    const { id } = req.params as { id: string };
    const updated = await prisma.template.update({ where: { id }, data: { status: 'retired' } });
    await audit(actor(req), 'retire', 'template', id);
    return updated;
  });

  app.post('/admin/templates/:id/test-send', { schema: { tags: ['admin'], summary: 'Render and send this template version to a test destination' } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ to: z.string().optional(), clientExternalId: z.string().optional(), vars: z.record(z.string(), z.unknown()).default({}) }),
      req.body,
    );
    const t = await prisma.template.findUniqueOrThrow({ where: { id } });
    const client = body.clientExternalId ? await prisma.client.findUnique({ where: { externalId: body.clientExternalId } }) : null;
    if (!client && !body.to && t.channel !== 'inapp') throw new HttpError(400, 'Provide `to` or `clientExternalId`');
    const msg = await createMessage({
      client,
      to: body.to,
      templateKey: t.key,
      templateId: t.id,
      channel: t.channel as 'email' | 'sms' | 'push' | 'inapp' | 'whatsapp',
      // Test sends are service messages so caps/quiet hours don't block QA.
      kind: 'service' as Kind,
      topic: 'service_notice' as Topic,
      category: t.category as 'A',
      vars: { ...sampleVars(), ...body.vars },
      language: t.language as 'ar' | 'en',
      dedupeKey: `test:${t.id}:${Date.now()}`,
    });
    await audit(actor(req), 'test_send', 'template', id, { to: body.to, client: body.clientExternalId });
    return msg;
  });

  app.post('/admin/templates/:id/preview', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ vars: z.record(z.string(), z.unknown()).default({}) }), req.body ?? {});
    const t = await prisma.template.findUniqueOrThrow({ where: { id } });
    const vars = baseVars(t.language as 'ar' | 'en', { ...sampleVars(), ...body.vars, lang: t.language });
    const text = renderText(t.body, vars);
    return {
      subject: t.subject ? renderText(t.subject, vars) : null,
      title: t.title ? renderText(t.title, vars) : null,
      body: text,
      length: text.length,
      html:
        t.channel === 'email'
          ? emailLayout({
              lang: t.language as 'ar' | 'en',
              subject: t.subject ? renderText(t.subject, vars) : '',
              bodyHtml: t.html ? render(t.html, vars) : textToHtml(text),
              marketing: !['transactional', 'service_notice'].includes(t.topic),
              unsubscribeUrl: '#',
              ctaUrl: config().APP_WEB_BASE,
              ctaLabel: t.language === 'ar' ? 'افتح التطبيق' : 'Open mngm',
            })
          : null,
    };
  });

  // ── Segments ──────────────────────────────────────────────────────────────
  app.get('/admin/segments', async () => prisma.segment.findMany({ orderBy: { updatedAt: 'desc' } }));

  app.post('/admin/segments/preview', async (req) => {
    const body = parse(z.object({ filter: segmentFilterSchema }), req.body);
    const sample = await prisma.client.findMany({
      where: segmentToWhere(body.filter) as object,
      take: 20,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, externalId: true, fullName: true, lifecycleStage: true, valueTier: true, tags: true, language: true },
    });
    return { count: await countAudience(body.filter), sample };
  });

  app.post('/admin/segments', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
    const body = parse(z.object({ name: z.string().min(2), description: z.string().optional(), filter: segmentFilterSchema }), req.body);
    const count = await countAudience(body.filter);
    return prisma.segment.create({
      data: { name: body.name, description: body.description, filter: JSON.stringify(body.filter), lastCount: count, createdBy: actor(req) },
    });
  });

  app.put('/admin/segments/:id', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ name: z.string().min(2), description: z.string().optional(), filter: segmentFilterSchema }), req.body);
    const count = await countAudience(body.filter);
    return prisma.segment.update({ where: { id }, data: { name: body.name, description: body.description, filter: JSON.stringify(body.filter), lastCount: count } });
  });

  app.delete('/admin/segments/:id', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.segment.delete({ where: { id } });
    return { ok: true };
  });

  // ── Banners ───────────────────────────────────────────────────────────────
  const bannerBody = z.object({
    kind: z.enum(['info', 'offer', 'incident', 'price_feed', 'maintenance', 'trading_paused']).default('info'),
    titleEn: z.string().min(1),
    titleAr: z.string().min(1),
    bodyEn: z.string().min(1),
    bodyAr: z.string().min(1),
    deepLink: z.string().nullish(),
    segment: segmentFilterSchema.nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  });

  app.get('/admin/banners', async () => prisma.banner.findMany({ orderBy: { startsAt: 'desc' }, take: 200 }));

  app.post('/admin/banners', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
    const b = parse(bannerBody, req.body);
    if (b.endsAt <= b.startsAt) throw new HttpError(400, 'Banners carry an end date after the start date');
    const created = await prisma.banner.create({ data: { ...b, segment: b.segment ? JSON.stringify(b.segment) : null, createdBy: actor(req) } });
    await audit(actor(req), 'create', 'banner', created.id);
    return created;
  });

  app.post('/admin/banners/:id/deactivate', { preHandler: requireRole('crm', 'marketing') }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.banner.update({ where: { id }, data: { active: false, endsAt: new Date() } });
  });

  // ── Incidents & maintenance (§5.6, §9.3) ──────────────────────────────────
  app.post('/admin/incidents', { preHandler: requireRole('admin', 'compliance', 'crm'), schema: { tags: ['admin'], summary: 'Publish incident / maintenance notice' } }, async (req) => {
    const body = parse(
      z.object({
        type: z.enum(['incident', 'maintenance']),
        stage: z.enum(['start', 'update', 'resolved', 'scheduled']),
        messageEn: z.string().min(5),
        messageAr: z.string().min(5),
        notify: z.boolean().default(true),
        endsAt: z.coerce.date().optional(),
      }),
      req.body,
    );
    const now = new Date();
    const kind = body.type === 'incident' ? 'incident' : 'maintenance';
    if (body.stage === 'resolved') {
      await prisma.banner.updateMany({ where: { kind, active: true }, data: { active: false, endsAt: now } });
    } else {
      await prisma.banner.updateMany({ where: { kind, active: true }, data: { active: false, endsAt: now } });
      await prisma.banner.create({
        data: {
          kind,
          titleEn: body.type === 'incident' ? 'Service disruption' : 'Planned maintenance',
          titleAr: body.type === 'incident' ? 'تعطل في الخدمة' : 'صيانة مجدولة',
          bodyEn: body.messageEn,
          bodyAr: body.messageAr,
          deepLink: `${config().APP_DEEPLINK_BASE}/status`,
          startsAt: now,
          endsAt: body.endsAt ?? new Date(now.getTime() + 24 * 3_600_000),
          createdBy: actor(req),
        },
      });
    }
    if (body.notify) {
      const templateKey = body.stage === 'resolved' ? 'incident_resolved' : body.type === 'incident' ? 'incident_notice' : 'maintenance_notice';
      await startBroadcast(
        { stages: ['S2', 'S3', 'S4', 'S5', 'S6'] },
        {
          templateKey,
          channels: ['push', 'email'],
          kind: 'service',
          topic: 'service_notice',
          category: 'F',
          vars: { message_en: body.messageEn, message_ar: body.messageAr },
          dedupePrefix: `incident:${now.getTime()}`,
        },
      );
    }
    await audit(actor(req), `incident_${body.stage}`, 'incident', null, body);
    return { ok: true };
  });
}

function sampleVars(): Record<string, unknown> {
  return {
    firstName: 'Mona',
    grams: 2.15,
    pricePerGram: 4812,
    price: 4780,
    amount: 10346,
    metal: 'gold',
    orderId: 'ORD-1001',
    planId: 'PLN-77',
    level: 4800,
    changePct: -1.2,
    holdingValue: 14320,
    milestone: 10,
    months: 3,
    remaining: 3,
    code: '482913',
    reason: 'The photo of your ID was not clear',
    topUpNeeded: 1000,
    period: 'September 2026',
    goldPrice: 4812,
    goldChange: 0.4,
    silverPrice: 61.5,
    silverChange: -0.3,
    priceTime: new Date(),
    years: 1,
    slotAt: new Date(Date.now() + 86_400_000),
    courierName: 'Ahmed',
    courierPhone: '01000000000',
    message_en: 'Some payments are delayed. Your balances are safe.',
    message_ar: 'بعض المدفوعات متأخرة. أرصدتك آمنة.',
  };
}
