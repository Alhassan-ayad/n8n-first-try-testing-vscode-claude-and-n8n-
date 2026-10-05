// Client-facing API, called by the mngm app backend (HMAC-signed):
// device tokens, preference centre, inbox, banners, price alerts, surveys,
// OTP and direct event ingestion.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONSENT_CHANNELS, CONSENTABLE_TOPICS, EVENT_TYPES, matchesSegment, segmentFilterSchema } from '@cep/core';
import { prisma } from '@cep/db';
import {
  createMessage,
  enrolByKey,
  ensureClient,
  ingestEvents,
  preferences,
  registrationConsentChanges,
  setConsents,
  toFacts,
} from '@cep/engine';
import { HttpError, parse, requireClientHmac } from '../http';

const ext = z.object({ externalId: z.string().min(1).max(64) });

export async function clientRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireClientHmac);

  const client = async (externalId: string) => ensureClient(externalId);

  // ── Devices (FCM tokens) ──────────────────────────────────────────────────
  app.post('/v1/clients/:externalId/devices', { schema: { tags: ['client'], summary: 'Register or refresh a push token' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const body = parse(z.object({ token: z.string().min(10), platform: z.enum(['android', 'ios', 'web']).default('android'), appVersion: z.string().optional() }), req.body);
    const c = await client(externalId);
    await prisma.device.upsert({
      where: { token: body.token },
      create: { clientId: c.id, token: body.token, platform: body.platform, appVersion: body.appVersion },
      update: { clientId: c.id, platform: body.platform, appVersion: body.appVersion, lastSeenAt: new Date(), invalidatedAt: null },
    });
    return { ok: true };
  });

  app.delete('/v1/clients/:externalId/devices/:token', { schema: { tags: ['client'], summary: 'Remove a push token (logout)' } }, async (req) => {
    const { token } = req.params as { token: string };
    await prisma.device.updateMany({ where: { token }, data: { invalidatedAt: new Date() } });
    return { ok: true };
  });

  // ── Consent & preference centre ───────────────────────────────────────────
  app.post('/v1/clients/:externalId/consents/registration', { schema: { tags: ['client'], summary: 'Capture registration consent (unticked by default)' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const body = parse(
      z.object({
        emailMarketing: z.boolean().optional(),
        smsMarketing: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        pushPromotions: z.boolean().optional(),
        priceDailyPush: z.boolean().optional(),
        marketResearchEmail: z.boolean().optional(),
        feedback: z.boolean().optional(),
        wordingVersion: z.string(),
        wordingText: z.string().optional(),
        ip: z.string().optional(),
      }),
      req.body,
    );
    const c = await client(externalId);
    await setConsents(c.id, registrationConsentChanges(body), {
      source: 'registration',
      wordingVersion: body.wordingVersion,
      wordingText: body.wordingText,
      ip: body.ip,
    });
    return preferences(c.id);
  });

  app.get('/v1/clients/:externalId/preferences', { schema: { tags: ['client'], summary: 'Preference centre state' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const c = await client(externalId);
    const alerts = await prisma.priceAlert.findMany({ where: { clientId: c.id, active: true } });
    return { ...(await preferences(c.id)), language: c.language, priceAlerts: alerts };
  });

  app.put('/v1/clients/:externalId/preferences', { schema: { tags: ['client'], summary: 'Update preference centre (per topic × channel)' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const body = parse(
      z.object({
        changes: z.array(z.object({ channel: z.enum(CONSENT_CHANNELS), topic: z.enum(CONSENTABLE_TOPICS as [string, ...string[]]), granted: z.boolean() })),
        language: z.enum(['ar', 'en']).optional(),
        wordingVersion: z.string().optional(),
        ip: z.string().optional(),
      }),
      req.body,
    );
    const c = await client(externalId);
    await setConsents(c.id, body.changes as Parameters<typeof setConsents>[1], {
      source: 'preference_centre',
      wordingVersion: body.wordingVersion,
      ip: body.ip,
    });
    if (body.language) await prisma.client.update({ where: { id: c.id }, data: { language: body.language } });
    return preferences(c.id);
  });

  // ── Inbox & banners ───────────────────────────────────────────────────────
  app.get('/v1/clients/:externalId/inbox', { schema: { tags: ['client'], summary: 'In-app inbox' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const q = req.query as { before?: string; limit?: string };
    const c = await client(externalId);
    const items = await prisma.inboxItem.findMany({
      where: {
        clientId: c.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Number(q.limit ?? 30)),
    });
    const unread = await prisma.inboxItem.count({ where: { clientId: c.id, readAt: null } });
    return { unread, items };
  });

  app.post('/v1/clients/:externalId/inbox/:id/read', { schema: { tags: ['client'], summary: 'Mark an inbox item read' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const { id } = req.params as { id: string };
    const c = await client(externalId);
    await prisma.inboxItem.updateMany({ where: { id, clientId: c.id, readAt: null }, data: { readAt: new Date() } });
    const item = await prisma.inboxItem.findUnique({ where: { id } });
    if (item?.messageId) {
      await prisma.message.updateMany({ where: { id: item.messageId, openedAt: null }, data: { openedAt: new Date() } });
    }
    return { ok: true };
  });

  app.get('/v1/clients/:externalId/banners', { schema: { tags: ['client'], summary: 'Active banners for this client' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const c = await client(externalId);
    const now = new Date();
    const banners = await prisma.banner.findMany({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: 'desc' } });
    const facts = toFacts(c);
    return banners
      .filter((b) => {
        if (!b.segment) return true;
        const f = segmentFilterSchema.safeParse(JSON.parse(b.segment));
        return f.success ? matchesSegment(facts, f.data) : false;
      })
      .map((b) => ({
        id: b.id,
        kind: b.kind,
        title: c.language === 'en' ? b.titleEn : b.titleAr,
        body: c.language === 'en' ? b.bodyEn : b.bodyAr,
        deepLink: b.deepLink,
        endsAt: b.endsAt,
      }));
  });

  // ── Price alerts (client-configured, Category B) ──────────────────────────
  const alertBody = z.object({
    metal: z.enum(['gold', 'silver']),
    direction: z.enum(['above', 'below']),
    level: z.number().positive(),
    repeat: z.boolean().default(false),
    smsAlso: z.boolean().default(false),
    windowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    windowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  });

  app.get('/v1/clients/:externalId/price-alerts', { schema: { tags: ['client'] } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const c = await client(externalId);
    return prisma.priceAlert.findMany({ where: { clientId: c.id, active: true }, orderBy: { createdAt: 'desc' } });
  });

  app.post('/v1/clients/:externalId/price-alerts', { schema: { tags: ['client'], summary: 'Create a price alert (implies push consent for price alerts)' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const body = parse(alertBody, req.body);
    const c = await client(externalId);
    const count = await prisma.priceAlert.count({ where: { clientId: c.id, active: true } });
    if (count >= 20) throw new HttpError(409, 'Maximum of 20 active alerts');
    // Setting an alert is an explicit request to be told — recorded as consent with its source.
    const changes: Parameters<typeof setConsents>[1] = [{ channel: 'push', topic: 'price_alerts', granted: true }];
    if (body.smsAlso) changes.push({ channel: 'sms', topic: 'price_alerts', granted: true });
    await setConsents(c.id, changes, { source: 'price_alert_created' });
    return prisma.priceAlert.create({ data: { clientId: c.id, ...body } });
  });

  app.delete('/v1/clients/:externalId/price-alerts/:id', { schema: { tags: ['client'] } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const { id } = req.params as { id: string };
    const c = await client(externalId);
    await prisma.priceAlert.updateMany({ where: { id, clientId: c.id }, data: { active: false } });
    return { ok: true };
  });

  // ── Surveys ───────────────────────────────────────────────────────────────
  app.post('/v1/clients/:externalId/surveys/:survey', { schema: { tags: ['client'], summary: 'Submit CSAT / NPS / drop-off survey' } }, async (req) => {
    const { externalId } = parse(ext, req.params);
    const { survey } = parse(z.object({ survey: z.enum(['csat_order', 'csat_contact', 'nps_quarterly', 'activation_dropoff', 'exit']) }), req.params);
    const body = parse(
      z.object({
        score: z.number().int().min(0).max(10).optional(),
        reason: z.enum(['documents_reluctance', 'process_too_long', 'trust_concerns', 'not_ready_to_invest', 'other']).or(z.string().max(100)).optional(),
        text: z.string().max(4000).optional(),
        messageId: z.string().optional(),
      }),
      req.body,
    );
    const c = await client(externalId);
    const row = await prisma.surveyResponse.create({ data: { clientId: c.id, survey, ...body } });
    // Positive CSAT (4–5 on a 5-point scale) → referral invitation (plan §5.3).
    if (survey === 'csat_order' && (body.score ?? 0) >= 4) await enrolByKey('referral_invite', c, { trigger: 'csat' });
    return row;
  });

  // ── OTP (preferred over CDC for latency: within 15 seconds) ───────────────
  app.post('/v1/otp', { schema: { tags: ['client'], summary: 'Send a verification code by SMS (email fallback)' } }, async (req) => {
    const body = parse(
      z.object({
        externalId: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        code: z.string().min(4).max(10),
        purpose: z.string().default('login'),
        language: z.enum(['ar', 'en']).optional(),
      }),
      req.body,
    );
    if (!body.phone && !body.email && !body.externalId) throw new HttpError(400, 'phone, email or externalId required');
    const c = body.externalId ? await prisma.client.findUnique({ where: { externalId: body.externalId } }) : null;
    const channel = body.phone || c?.phone ? 'sms' : 'email';
    const msg = await createMessage({
      client: c,
      to: channel === 'sms' ? (body.phone ?? c?.phone) : (body.email ?? c?.email),
      channel,
      templateKey: 'otp',
      kind: 'otp',
      topic: 'transactional',
      category: 'A',
      vars: { code: body.code, purpose: body.purpose },
      language: body.language,
      dedupeKey: `otp:${randomUUID()}`,
    });
    return { messageId: msg?.id, channel, status: msg?.status };
  });

  // ── Direct event ingestion (alternative to CDC) ───────────────────────────
  app.post('/v1/events', { schema: { tags: ['client'], summary: 'Post platform events (same taxonomy as CDC)' } }, async (req) => {
    const body = parse(
      z.object({
        events: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              type: z.enum(EVENT_TYPES),
              clientExternalId: z.string().optional(),
              occurredAt: z.string().datetime().optional(),
              payload: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .max(500),
      }),
      req.body,
    );
    const n = await ingestEvents(body.events.map((e) => ({ ...e, id: `api:${e.id}` })), 'api');
    return { accepted: body.events.length, processed: n };
  });
}
