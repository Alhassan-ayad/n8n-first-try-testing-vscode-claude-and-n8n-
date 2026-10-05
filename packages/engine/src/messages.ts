// Message creation: template resolution, rendering, outbox insert, inbox
// mirror and dispatch enqueue. Every outbound communication goes through here.

import { randomUUID } from 'node:crypto';
import {
  baseVars,
  buildDeepLink,
  CAPPED_KINDS,
  type Category,
  type Channel,
  config,
  DEFAULT_DEEPLINKS,
  isMandatory,
  KIND_PRIORITY,
  type Kind,
  type Language,
  renderText,
  render,
  type Topic,
  webLinkFor,
} from '@cep/core';
import { type Client, type Message, Prisma, prisma, type Template } from '@cep/db';
import { consentSet, unsubscribeUrl } from './consent';
import { enqueueDispatch, log } from './infra';
import { emailLayout, textToHtml } from './layout';

export interface MessageInput {
  client?: Client | null;
  /** Destination override (non-client recipient, test send). */
  to?: string | null;
  templateKey: string;
  channel: Exclude<Channel, 'call'>;
  kind: Kind;
  topic: Topic;
  category: Category;
  vars?: Record<string, unknown>;
  language?: Language;
  campaignId?: string;
  campaignSlot?: string;
  enrollmentId?: string;
  stepId?: string;
  dedupeKey?: string;
  notBefore?: Date | null;
  guardKey?: string;
  pushTwin?: boolean;
  /** Mirror into the in-app inbox. */
  inbox?: boolean;
  attachments?: Array<{ filename: string; contentBase64: string; type: string }>;
  /** Skip the approval requirement (admin test sends of drafts). */
  allowUnapproved?: boolean;
  /** Use this exact template version (admin test sends). */
  templateId?: string;
}

const TEMPLATE_REQUIRE_APPROVAL = () => (process.env.TEMPLATE_REQUIRE_APPROVAL ?? 'true') !== 'false';

export async function resolveTemplate(
  key: string,
  channel: string,
  lang: Language,
  allowUnapproved = false,
): Promise<Template | null> {
  const statuses = allowUnapproved || !TEMPLATE_REQUIRE_APPROVAL() ? ['approved', 'in_review', 'draft'] : ['approved'];
  for (const language of [lang, lang === 'ar' ? 'en' : 'ar']) {
    const rows = await prisma.template.findMany({
      where: { key, channel, language, status: { in: statuses } },
      orderBy: { version: 'desc' },
    });
    // Prefer approved, then the newest.
    const t = rows.find((r) => r.status === 'approved') ?? rows[0];
    if (t) return t;
  }
  return null;
}

function firstName(c?: Client | null): string {
  return c?.fullName?.trim().split(/\s+/)[0] ?? '';
}

export function clientVars(c?: Client | null): Record<string, unknown> {
  if (!c) return {};
  return {
    firstName: firstName(c),
    fullName: c.fullName,
    goldGrams: c.goldGrams,
    silverGrams: c.silverGrams,
    holdingValue: c.holdingValueEgp,
    tier: c.valueTier,
    stage: c.lifecycleStage,
  };
}

function destination(channel: Channel, client?: Client | null, to?: string | null): string | null {
  if (to) return to;
  if (!client) return null;
  if (channel === 'email') return client.email;
  if (channel === 'sms' || channel === 'whatsapp') return client.phone;
  if (channel === 'push' || channel === 'inapp') return client.id;
  return null;
}

/** Create one outbox message. Idempotent on `dedupeKey`. */
export async function createMessage(input: MessageInput): Promise<Message | null> {
  const { client, channel, kind, topic, category } = input;
  const lang: Language = input.language ?? (client?.language === 'en' ? 'en' : 'ar');
  const dedupeKey = input.dedupeKey ?? randomUUID();
  const now = new Date();
  const marketing = !isMandatory(kind, topic);

  const existing = await prisma.message.findUnique({ where: { dedupeKey } });
  if (existing) return existing;

  const template = input.templateId
    ? await prisma.template.findUnique({ where: { id: input.templateId } })
    : await resolveTemplate(input.templateKey, channel, lang, input.allowUnapproved);
  const vars = baseVars(lang, { ...clientVars(client), ...(input.vars ?? {}) });
  const deepLinkPath = template?.deepLink ?? DEFAULT_DEEPLINKS[input.templateKey] ?? null;
  const deepLink = buildDeepLink(deepLinkPath, vars);
  vars.deepLink = deepLink;
  vars.link = webLinkFor(deepLink);
  const unsub = client && marketing && channel === 'email' ? unsubscribeUrl(client.id, 'email', topic) : null;
  vars.unsubscribeUrl = unsub;

  const base = {
    clientId: client?.id ?? null,
    dedupeKey,
    templateKey: input.templateKey,
    templateId: template?.id ?? null,
    channel,
    category,
    topic,
    kind,
    priority: KIND_PRIORITY[kind],
    capped: CAPPED_KINDS.has(kind),
    pushTwin: Boolean(input.pushTwin),
    language: template?.language ?? lang,
    toAddress: destination(channel, client, input.to),
    campaignId: input.campaignId ?? null,
    campaignSlot: input.campaignSlot ?? null,
    journeyEnrollmentId: input.enrollmentId ?? null,
    journeyStepId: input.stepId ?? null,
    guardKey: input.guardKey ?? null,
    notBefore: input.notBefore ?? null,
    vars: JSON.stringify(input.vars ?? {}),
  };

  if (!template) {
    log.warn({ key: input.templateKey, channel, lang }, 'no usable template');
    return insert({ ...base, body: '', status: 'failed', statusReason: 'no_approved_template', failedAt: now });
  }

  const tlang = (template.language === 'en' ? 'en' : 'ar') as Language;
  vars.lang = tlang;
  const subject = template.subject ? renderText(template.subject, vars) : null;
  const title = template.title ? renderText(template.title, vars) : null;
  let body = renderText(template.body, vars);
  let html: string | null = null;

  if (channel === 'sms' && marketing) {
    const c = config();
    body = `${body}\n${tlang === 'ar' ? c.SMS_OPTOUT_FOOTER_AR : c.SMS_OPTOUT_FOOTER_EN}`;
  }
  if (channel === 'email') {
    const inner = template.html ? render(template.html, vars) : textToHtml(body);
    html = emailLayout({
      lang: tlang,
      subject: subject ?? '',
      bodyHtml: inner,
      marketing,
      unsubscribeUrl: unsub,
      ctaUrl: (vars.link as string | null) ?? null,
      ctaLabel: deepLink ? (tlang === 'ar' ? 'افتح التطبيق' : 'Open mngm') : null,
    });
  }

  if (channel === 'inapp') {
    if (!client) return null;
    const msg = await insert({ ...base, subject, title, body, deepLink, status: 'sent', sentAt: now, provider: 'inapp' });
    if (msg && msg.dedupeKey === dedupeKey) {
      await prisma.inboxItem.create({
        data: { clientId: client.id, messageId: msg.id, category, title: title ?? subject ?? '', body, deepLink },
      });
    }
    return msg;
  }

  const deferred = input.notBefore && input.notBefore > now;
  const msg = await insert({
    ...base,
    subject,
    title,
    body,
    html,
    deepLink,
    imageUrl: template.imageUrl ? renderText(template.imageUrl, vars) : null,
    attachments: input.attachments ? JSON.stringify(input.attachments) : null,
    status: deferred ? 'deferred' : 'pending',
    statusReason: deferred ? 'scheduled' : null,
    releaseAt: deferred ? input.notBefore! : null,
  });
  if (!msg) return null;

  if (input.inbox && client && msg.status !== 'failed') {
    await prisma.inboxItem.create({
      data: { clientId: client.id, messageId: msg.id, category, title: title ?? subject ?? '', body: stripFooter(body), deepLink },
    });
  }
  if (msg.status === 'pending') await enqueueDispatch(msg.id, msg.priority);
  return msg;
}

function stripFooter(body: string): string {
  const c = config();
  return body.replace(`\n${c.SMS_OPTOUT_FOOTER_AR}`, '').replace(`\n${c.SMS_OPTOUT_FOOTER_EN}`, '');
}

async function insert(data: Prisma.MessageUncheckedCreateInput): Promise<Message | null> {
  try {
    return await prisma.message.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.message.findUnique({ where: { dedupeKey: data.dedupeKey } });
    }
    throw err;
  }
}

export async function hasValidPushToken(clientId: string): Promise<boolean> {
  const n = await prisma.device.count({ where: { clientId, invalidatedAt: null } });
  return n > 0;
}

export interface MultiInput extends Omit<MessageInput, 'channel' | 'pushTwin' | 'dedupeKey'> {
  channels: Array<Exclude<Channel, 'call'>>;
  fallbackIfNoPush?: Array<Exclude<Channel, 'call'>>;
  /** Base for per-channel dedupe keys: `${dedupeBase}:${channel}`. */
  dedupeBase?: string;
  /** Don't create rows for channels the client hasn't consented to (bulk sends). */
  skipUnconsented?: boolean;
}

/** Same content over several channels; inbox mirrored once; SMS knows when push carries the same content. */
export async function createMulti(input: MultiInput): Promise<Message[]> {
  const channels = [...input.channels];
  if (input.fallbackIfNoPush?.length && input.client && channels.includes('push')) {
    const reachable = await hasValidPushToken(input.client.id);
    const pushOk = reachable && (isMandatory(input.kind, input.topic) || (await consentSet(input.client.id)).has(`push:${input.topic}`));
    if (!pushOk) for (const ch of input.fallbackIfNoPush) if (!channels.includes(ch)) channels.push(ch);
  }

  let consents: Set<string> | null = null;
  if (input.skipUnconsented && input.client && !isMandatory(input.kind, input.topic)) {
    consents = await consentSet(input.client.id);
  }

  const out: Message[] = [];
  let inboxDone = !input.inbox;
  for (const channel of channels) {
    if (consents && channel !== 'inapp' && !consents.has(`${channel}:${input.topic}`)) continue;
    const mirror = !inboxDone && (channel === 'push' || channel === 'sms' || channel === 'email');
    const m = await createMessage({
      ...input,
      channel,
      pushTwin: channel === 'sms' && channels.includes('push'),
      dedupeKey: input.dedupeBase ? `${input.dedupeBase}:${channel}` : undefined,
      inbox: mirror,
    });
    if (mirror && m) inboxDone = true;
    if (m) out.push(m);
  }
  return out;
}

/** Cancel pending/deferred messages that share a guard key (e.g. failed-debit follow-ups once funded). */
export async function cancelGuards(clientId: string | null, guardKeys: string[]): Promise<number> {
  if (!guardKeys.length) return 0;
  const res = await prisma.message.updateMany({
    where: {
      guardKey: { in: guardKeys },
      status: { in: ['pending', 'deferred', 'held'] },
      ...(clientId ? { clientId } : {}),
    },
    data: { status: 'cancelled', statusReason: 'guard_cleared' },
  });
  return res.count;
}
