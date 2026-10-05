// Provider callbacks: SendGrid Event Webhook (signed), eZagel delivery
// receipts and inbound SMS (opt-out keywords), plus the public one-click
// unsubscribe page.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, CONSENTABLE_TOPICS, type Topic } from '@cep/core';
import { isOptOutKeyword, mapEzagelDlrStatus, normalizeEgyptMobile, pick, type SendGridEvent, verifySendGridSignature } from '@cep/providers';
import { prisma } from '@cep/db';
import { log, optOutChannel, parseUnsubscribeToken, setConsents, suppress } from '@cep/engine';
import { HttpError } from '../http';

const STATUS_RANK: Record<string, number> = { sending: 1, sent: 2, delivered: 3, opened: 4, clicked: 5, failed: 6 };

async function advance(messageId: string, status: string, extra: Record<string, unknown> = {}) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { status: true } });
  if (!m) return;
  const next = (STATUS_RANK[status] ?? 0) > (STATUS_RANK[m.status] ?? 0) ? status : m.status;
  await prisma.message.update({ where: { id: messageId }, data: { status: next, ...extra } });
}

export async function webhookRoutes(app: FastifyInstance) {
  // ── SendGrid Event Webhook ────────────────────────────────────────────────
  app.post('/webhooks/sendgrid', { schema: { tags: ['webhooks'], summary: 'SendGrid signed Event Webhook' } }, async (req) => {
    const ok = verifySendGridSignature(
      req.rawBody ?? '',
      req.headers['x-twilio-email-event-webhook-signature'] as string | undefined,
      req.headers['x-twilio-email-event-webhook-timestamp'] as string | undefined,
    );
    if (!ok) throw new HttpError(401, 'Invalid SendGrid signature');
    const events = (Array.isArray(req.body) ? req.body : []) as SendGridEvent[];

    for (const ev of events) {
      const messageId = typeof ev.messageId === 'string' ? ev.messageId : undefined;
      const at = new Date((ev.timestamp ?? Date.now() / 1000) * 1000);
      if (messageId) {
        await prisma.deliveryEvent.create({
          data: { messageId: (await prisma.message.findUnique({ where: { id: messageId }, select: { id: true } })) ? messageId : null, provider: 'sendgrid', event: ev.event, payload: JSON.stringify(ev), occurredAt: at },
        });
      }
      const message = messageId ? await prisma.message.findUnique({ where: { id: messageId } }) : null;

      switch (ev.event) {
        case 'delivered':
          if (message) await advance(message.id, 'delivered', { deliveredAt: at });
          break;
        case 'open':
          if (message) await advance(message.id, 'opened', { openedAt: message.openedAt ?? at });
          break;
        case 'click':
          if (message) await advance(message.id, 'clicked', { clickedAt: message.clickedAt ?? at, openedAt: message.openedAt ?? at });
          break;
        case 'bounce':
        case 'dropped':
          if (message) await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', failedAt: at, statusReason: `${ev.event}: ${ev.reason ?? ''}`.slice(0, 1000) } });
          // Hard bounces make the address invalid for everything, including Category A.
          if (ev.event === 'bounce' && ev.type !== 'blocked') {
            await suppress({ channel: 'email', value: ev.email, scope: 'all', reason: 'bounce', source: 'sendgrid', clientId: message?.clientId, note: ev.reason });
          }
          break;
        case 'spamreport':
          await suppress({ channel: 'email', value: ev.email, scope: 'marketing', reason: 'spam_report', source: 'sendgrid', clientId: message?.clientId });
          if (message?.clientId) await optOutChannel(message.clientId, 'email', 'email_spam_report');
          break;
        case 'unsubscribe':
        case 'group_unsubscribe':
          await suppress({ channel: 'email', value: ev.email, scope: 'marketing', reason: 'unsubscribe', source: 'sendgrid', clientId: message?.clientId });
          if (message?.clientId) await optOutChannel(message.clientId, 'email', 'email_unsubscribe');
          break;
        default:
          break;
      }
    }
    return { received: events.length };
  });

  // ── eZagel delivery receipts ──────────────────────────────────────────────
  const checkToken = (req: FastifyRequest) => {
    const expected = config().EZAGEL_WEBHOOK_TOKEN;
    const token = (req.query as Record<string, string>).token;
    if (expected && token !== expected) throw new HttpError(401, 'Invalid token');
  };
  const fields = (req: FastifyRequest): Record<string, unknown> => ({
    ...((req.query as Record<string, unknown>) ?? {}),
    ...(typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : {}),
  });

  const dlr = async (req: FastifyRequest, reply: FastifyReply) => {
    checkToken(req);
    const f = fields(req);
    const ref = pick(f, 'msg_id', 'msgid', 'messageId', 'message_id', 'smsid', 'id', 'ref');
    const status = mapEzagelDlrStatus(pick(f, 'status', 'dlr', 'state', 'stat'));
    if (!ref) return reply.send('OK');
    const message = await prisma.message.findFirst({ where: { OR: [{ id: ref }, { providerMessageId: ref }], channel: 'sms' } });
    await prisma.deliveryEvent.create({ data: { messageId: message?.id ?? null, provider: 'ezagel', event: status, payload: JSON.stringify(f) } });
    if (message) {
      if (status === 'delivered') await advance(message.id, 'delivered', { deliveredAt: new Date() });
      if (status === 'failed') {
        await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', failedAt: new Date(), statusReason: `dlr: ${pick(f, 'status', 'dlr') ?? ''}` } });
      }
    }
    return reply.send('OK');
  };
  app.get('/webhooks/ezagel/dlr', { schema: { tags: ['webhooks'] } }, dlr);
  app.post('/webhooks/ezagel/dlr', { schema: { tags: ['webhooks'] } }, dlr);

  // ── eZagel inbound SMS: opt-out keywords in Arabic and English ────────────
  const inbound = async (req: FastifyRequest, reply: FastifyReply) => {
    checkToken(req);
    const f = fields(req);
    const from = pick(f, 'from', 'mobile', 'sender', 'msisdn', 'mobile_no');
    const text = pick(f, 'text', 'message', 'body', 'msg', 'content') ?? '';
    if (!from) return reply.send('OK');
    await prisma.deliveryEvent.create({ data: { provider: 'ezagel', event: 'inbound', payload: JSON.stringify(f) } });
    if (isOptOutKeyword(text)) {
      const phone = normalizeEgyptMobile(from) ?? from;
      await suppress({ channel: 'sms', value: phone, scope: 'marketing', reason: 'sms_keyword', source: 'ezagel_inbound', note: text.slice(0, 100) });
      const local = phone.startsWith('20') ? `0${phone.slice(2)}` : phone;
      const clients = await prisma.client.findMany({ where: { phone: { in: [phone, `+${phone}`, local] } } });
      for (const c of clients) await optOutChannel(c.id, 'sms', 'sms_keyword');
      log.info({ phone, clients: clients.length }, 'SMS opt-out keyword processed');
    }
    return reply.send('OK');
  };
  app.get('/webhooks/ezagel/inbound', { schema: { tags: ['webhooks'] } }, inbound);
  app.post('/webhooks/ezagel/inbound', { schema: { tags: ['webhooks'] } }, inbound);

  // ── One-click unsubscribe (RFC 8058) + landing page ───────────────────────
  app.post('/u/:token', { schema: { tags: ['public'], summary: 'One-click unsubscribe' } }, async (req, reply) => {
    const parsed = parseUnsubscribeToken((req.params as { token: string }).token);
    if (!parsed) throw new HttpError(400, 'Invalid link');
    const all = (req.body as Record<string, string> | undefined)?.scope === 'all' || (req.body as Record<string, string> | undefined)?.['List-Unsubscribe'] === 'One-Click';
    await unsubscribe(parsed.clientId, parsed.topic, all);
    return reply.type('text/html').send(page(parsed.clientId, true, all));
  });

  app.get('/u/:token', { schema: { tags: ['public'] } }, async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const parsed = parseUnsubscribeToken(token);
    if (!parsed) return reply.code(400).type('text/html').send('<p>This link is not valid.</p>');
    return reply.type('text/html').send(confirmPage(token));
  });
}

async function unsubscribe(clientId: string, topic: string, all: boolean) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return;
  if (all) {
    await optOutChannel(clientId, 'email', 'email_unsubscribe');
    if (client.email) await suppress({ channel: 'email', value: client.email, scope: 'marketing', reason: 'unsubscribe', source: 'unsubscribe_link', clientId });
  } else if ((CONSENTABLE_TOPICS as readonly string[]).includes(topic)) {
    await setConsents(clientId, [{ channel: 'email', topic: topic as Topic, granted: false }], { source: 'email_unsubscribe' });
  }
}

const shell = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mngm email preferences</title>
<style>body{font:16px/1.6 system-ui,'Segoe UI',Tahoma,sans-serif;background:#f4f1ea;color:#1d1a14;margin:0;padding:24px}main{max-width:520px;margin:40px auto;background:#fff;border-radius:10px;padding:28px}h1{font-size:20px;margin:0 0 12px}.ar{direction:rtl;text-align:right;border-top:1px solid #eee;margin-top:20px;padding-top:16px}button{background:#8a6d1f;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:15px;cursor:pointer;margin:6px 6px 0 0}button.secondary{background:#eee;color:#1d1a14}</style></head><body><main>${body}</main></body></html>`;

function confirmPage(token: string) {
  return shell(`<h1>Email preferences</h1>
<p>Choose what to stop. Account, security and transaction emails are part of the service and will still be sent.</p>
<form method="post" action="/u/${token}"><button name="scope" value="topic">Unsubscribe from this type of email</button><button class="secondary" name="scope" value="all">Unsubscribe from all marketing email</button></form>
<div class="ar"><h1>تفضيلات البريد</h1><p>اختر ما تريد إيقافه. رسائل الحساب والأمان والمعاملات جزء من الخدمة وستستمر.</p></div>`);
}

function page(_clientId: string, _ok: boolean, all: boolean) {
  return shell(`<h1>You're unsubscribed</h1>
<p>${all ? 'You will no longer receive marketing email from mngm.' : 'You will no longer receive this type of email.'} Account, security and transaction messages will still be sent. You can change this any time in the app under Settings → Notifications.</p>
<div class="ar"><h1>تم إلغاء الاشتراك</h1><p>${all ? 'لن تصلك رسائل تسويقية بالبريد من mngm.' : 'لن يصلك هذا النوع من الرسائل.'} ستستمر رسائل الحساب والأمان والمعاملات. يمكنك تغيير ذلك من الإعدادات ← الإشعارات في التطبيق.</p></div>`);
}
