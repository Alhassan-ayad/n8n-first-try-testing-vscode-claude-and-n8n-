// SendGrid email. Transactional and marketing mail go from separate
// subdomains (plan §4, §11) and marketing carries the unsubscribe group plus
// RFC 8058 one-click List-Unsubscribe.

import sgMail from '@sendgrid/mail';
import { EventWebhook } from '@sendgrid/eventwebhook';
import { config } from '@cep/core';
import type { ChannelProvider, OutboundMessage, SendResult } from './types';

function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2]! } : { email: from.trim() };
}

/** Pure payload builder (unit-tested). */
export function buildSendGridMail(msg: OutboundMessage) {
  const c = config();
  const from = parseFrom(msg.marketing ? c.SENDGRID_FROM_MARKETING : c.SENDGRID_FROM_TRANSACTIONAL);
  const headers: Record<string, string> = {};
  if (msg.marketing && msg.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${msg.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const groupId = Number.parseInt(c.SENDGRID_UNSUB_GROUP_ID, 10);
  const ipPool = msg.marketing ? c.SENDGRID_IP_POOL_MARKETING : c.SENDGRID_IP_POOL_TRANSACTIONAL;

  return {
    to: msg.to!,
    from,
    replyTo: c.SENDGRID_REPLY_TO || undefined,
    subject: msg.subject ?? '',
    text: msg.body,
    html: msg.html ?? undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    categories: [msg.marketing ? 'marketing' : 'transactional', `cat_${msg.category}`, msg.topic].slice(0, 10),
    customArgs: { messageId: msg.id, topic: msg.topic, category: msg.category },
    asm: msg.marketing && Number.isFinite(groupId) ? { groupId } : undefined,
    ipPoolName: ipPool || undefined,
    attachments: msg.attachments?.map((a) => ({
      content: a.contentBase64,
      filename: a.filename,
      type: a.type,
      disposition: 'attachment' as const,
    })),
    trackingSettings: {
      clickTracking: { enable: msg.marketing, enableText: false },
      openTracking: { enable: true },
    },
    // Category A must reach clients who unsubscribed from marketing; bounce/spam lists still apply.
    mailSettings: msg.marketing ? undefined : { bypassUnsubscribeManagement: { enable: true } },
  };
}

export class SendGridEmailProvider implements ChannelProvider {
  readonly name = 'sendgrid';
  readonly channel = 'email' as const;
  private initialised = false;

  isConfigured(): boolean {
    return Boolean(config().SENDGRID_API_KEY);
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) return { accepted: false, provider: this.name, error: 'SENDGRID_API_KEY is not set' };
    if (!msg.to) return { accepted: false, provider: this.name, error: 'No email address', permanent: true };
    if (!this.initialised) {
      sgMail.setApiKey(config().SENDGRID_API_KEY);
      this.initialised = true;
    }
    try {
      const [res] = await sgMail.send(buildSendGridMail(msg) as Parameters<typeof sgMail.send>[0]);
      const header = res.headers['x-message-id'];
      return {
        accepted: res.statusCode >= 200 && res.statusCode < 300,
        provider: this.name,
        providerMessageId: Array.isArray(header) ? header[0] : (header as string | undefined),
      };
    } catch (err) {
      const e = err as { code?: number; response?: { body?: unknown }; message?: string };
      const status = e.code ?? 0;
      return {
        accepted: false,
        provider: this.name,
        permanent: status === 400 || status === 403,
        error: `SendGrid ${status}: ${JSON.stringify(e.response?.body ?? e.message).slice(0, 500)}`,
      };
    }
  }
}

/** Verify a signed Event Webhook request (ECDSA). Returns true if no key is configured in mock mode. */
export function verifySendGridSignature(rawBody: string, signature?: string, timestamp?: string): boolean {
  const key = config().SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (!key) return config().PROVIDER_MODE === 'mock';
  if (!signature || !timestamp) return false;
  try {
    const ew = new EventWebhook();
    const ecKey = ew.convertPublicKeyToECDSA(key);
    return ew.verifySignature(ecKey, rawBody, signature, timestamp);
  } catch {
    return false;
  }
}

export interface SendGridEvent {
  event: string;
  email: string;
  timestamp: number;
  sg_message_id?: string;
  messageId?: string;
  type?: string; // bounce | blocked
  reason?: string;
  url?: string;
  asm_group_id?: number;
  [k: string]: unknown;
}
