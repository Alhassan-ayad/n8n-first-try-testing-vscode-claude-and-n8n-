// eZagel SMS gateway.
//
// Request/response shapes differ between eZagel account types, so the whole
// mapping is isolated in `buildEzagelRequest` / `parseEzagelResponse` and can
// be tuned from .env without code changes:
//   EZAGEL_BASE_URL        full send endpoint URL
//   EZAGEL_REQUEST_FORMAT  form | json | query      (default: form)
//   EZAGEL_PARAM_MAP       JSON renaming our logical fields to eZagel's names,
//                          e.g. {"username":"User","password":"Password","sender":"Sender",
//                                "mobile":"Mobile_NO","message":"Msg","msgId":"Msg_ID"}
//   EZAGEL_PHONE_FORMAT    intl (201xxxxxxxxx) | local (01xxxxxxxxx)  (default: intl)
//   EZAGEL_SUCCESS_PATTERN regex the response body must match to count as accepted (optional)
// Confirm these against the eZagel API document that comes with the credentials.

import { config } from '@cep/core';
import type { ChannelProvider, OutboundMessage, SendResult } from './types';

const ARABIC = /[؀-ۿ]/;

export function isUnicode(text: string): boolean {
  return ARABIC.test(text) || /[^\x00-\x7F]/.test(text);
}

/** Normalise an Egyptian mobile number. Returns null if it isn't one we can send to. */
export function normalizeEgyptMobile(input: string, format: 'intl' | 'local' = 'intl'): string | null {
  let d = input.replace(/[^\d]/g, '');
  if (d.startsWith('0020')) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) d = d.slice(2); // 20 1x xxxx xxxx
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (!/^1[0125]\d{8}$/.test(d)) {
    // Not an Egyptian mobile — pass through international numbers as-is (12–15 digits).
    const raw = input.replace(/[^\d]/g, '');
    return raw.length >= 11 && raw.length <= 15 && !raw.startsWith('0') ? raw : null;
  }
  return format === 'local' ? `0${d}` : `20${d}`;
}

/** Number of SMS parts (GSM-7: 160/153, UCS-2: 70/67). */
export function smsParts(text: string): number {
  const uni = isUnicode(text);
  const single = uni ? 70 : 160;
  const multi = uni ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

const DEFAULT_PARAM_MAP: Record<string, string> = {
  username: 'username',
  password: 'password',
  sender: 'sender',
  mobile: 'mobile',
  message: 'message',
  msgId: 'msg_id',
  language: 'language',
  service: 'service',
};

export interface EzagelRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

function env(name: string): string {
  return process.env[name] ?? '';
}

export function buildEzagelRequest(to: string, text: string, msgId: string): EzagelRequest {
  const c = config();
  let map = DEFAULT_PARAM_MAP;
  if (env('EZAGEL_PARAM_MAP')) {
    try {
      map = { ...DEFAULT_PARAM_MAP, ...(JSON.parse(env('EZAGEL_PARAM_MAP')) as Record<string, string>) };
    } catch {
      throw new Error('EZAGEL_PARAM_MAP is not valid JSON');
    }
  }
  const logical: Record<string, string> = {
    username: c.EZAGEL_USERNAME,
    password: c.EZAGEL_PASSWORD,
    sender: c.EZAGEL_SENDER_ID,
    mobile: to,
    message: text,
    msgId,
    language: isUnicode(text) ? '2' : '1', // 1 = English/GSM, 2 = Arabic/Unicode (common Egyptian gateway convention)
    service: c.EZAGEL_SERVICE,
  };
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(logical)) {
    const name = map[k];
    if (name && v !== '') params[name] = v;
  }

  const format = (env('EZAGEL_REQUEST_FORMAT') || 'form') as 'form' | 'json' | 'query';
  if (format === 'json') {
    return { url: c.EZAGEL_BASE_URL, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) };
  }
  if (format === 'query') {
    const u = new URL(c.EZAGEL_BASE_URL);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return { url: u.toString(), method: 'GET', headers: {} };
  }
  return {
    url: c.EZAGEL_BASE_URL,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  };
}

export function parseEzagelResponse(status: number, body: string, fallbackId: string): SendResult {
  const ok2xx = status >= 200 && status < 300;
  const pattern = env('EZAGEL_SUCCESS_PATTERN');
  const looksFailed = /error|fail|invalid|denied|unauthori[sz]ed|insufficient|not allowed|rejected/i.test(body);
  const accepted = ok2xx && (pattern ? new RegExp(pattern, 'i').test(body) : !looksFailed);

  let providerMessageId: string | undefined;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const id = j.id ?? j.messageId ?? j.message_id ?? j.msg_id ?? j.MsgID ?? j.SMSID ?? j.smsId;
    if (id !== undefined && id !== null) providerMessageId = String(id);
  } catch {
    const m = body.match(/\b\d{6,}\b/);
    if (m) providerMessageId = m[0];
  }

  return {
    accepted,
    provider: 'ezagel',
    providerMessageId: providerMessageId ?? fallbackId,
    permanent: !accepted && status >= 400 && status < 500 && status !== 429,
    error: accepted ? undefined : `eZagel HTTP ${status}: ${body.slice(0, 500)}`,
    raw: body.slice(0, 2000),
  };
}

export class EzagelSmsProvider implements ChannelProvider {
  readonly name = 'ezagel';
  readonly channel = 'sms' as const;

  isConfigured(): boolean {
    const c = config();
    return Boolean(c.EZAGEL_BASE_URL && c.EZAGEL_USERNAME && c.EZAGEL_PASSWORD && c.EZAGEL_SENDER_ID);
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { accepted: false, provider: this.name, error: 'eZagel is not configured (EZAGEL_* env vars)', permanent: false };
    }
    const format = (env('EZAGEL_PHONE_FORMAT') || 'intl') as 'intl' | 'local';
    const to = msg.to ? normalizeEgyptMobile(msg.to, format) : null;
    if (!to) return { accepted: false, provider: this.name, error: `Invalid mobile number: ${msg.to}`, permanent: true };

    const req = buildEzagelRequest(to, msg.body, msg.id);
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return parseEzagelResponse(res.status, text, msg.id);
  }
}

// ── Callbacks ───────────────────────────────────────────────────────────────

export type SmsDeliveryStatus = 'delivered' | 'failed' | 'sent' | 'unknown';

/** Map a DLR status string from eZagel to our status. */
export function mapEzagelDlrStatus(raw: string | undefined | null): SmsDeliveryStatus {
  const s = String(raw ?? '').toLowerCase();
  if (/fail|undeliv|reject|expired|error|^3$|^5$/.test(s)) return 'failed';
  if (/deliv|^2$|success|^ok$/.test(s)) return 'delivered';
  if (/sent|submit|accepted|enroute|^1$/.test(s)) return 'sent';
  return 'unknown';
}

/** Pull fields out of a DLR / inbound callback regardless of naming. */
export function pick(obj: Record<string, unknown>, ...names: string[]): string | undefined {
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return undefined;
}

export function isOptOutKeyword(text: string): boolean {
  const words = config()
    .SMS_OPTOUT_KEYWORDS.split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const t = text.trim().toLowerCase();
  return words.some((w) => t === w || t.startsWith(`${w} `));
}
