// Firebase Cloud Messaging. Deep link on every push, rich image support,
// per-category Android channels, and token hygiene (unregistered tokens are
// reported back so the engine can invalidate them).

import { readFileSync } from 'node:fs';
import { type App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { config } from '@cep/core';
import type { ChannelProvider, OutboundMessage, SendResult } from './types';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Android notification channel per consent topic — lets the app expose per-category switches. */
export function androidChannelFor(topic: string, category: string): string {
  if (category === 'A') return 'transactional';
  if (topic === 'price_alerts' || topic === 'price_daily') return 'prices';
  if (topic === 'service_notice') return 'service';
  return 'offers_and_news';
}

export function buildFcmMessage(msg: OutboundMessage, tokens: string[]): MulticastMessage {
  const data: Record<string, string> = {
    messageId: msg.id,
    category: msg.category,
    topic: msg.topic,
    ...(msg.deepLink ? { deepLink: msg.deepLink } : {}),
    ...(msg.data ?? {}),
  };
  return {
    tokens,
    notification: {
      title: msg.title ?? undefined,
      body: msg.body,
      imageUrl: msg.imageUrl ?? undefined,
    },
    data,
    android: {
      priority: msg.category === 'A' ? 'high' : 'normal',
      notification: {
        channelId: androidChannelFor(msg.topic, msg.category),
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        imageUrl: msg.imageUrl ?? undefined,
      },
    },
    apns: {
      headers: { 'apns-priority': msg.category === 'A' ? '10' : '5' },
      payload: {
        aps: {
          'mutable-content': msg.imageUrl ? 1 : 0,
          'thread-id': msg.topic,
          sound: msg.category === 'A' ? 'default' : undefined,
        },
      },
      fcmOptions: msg.imageUrl ? { imageUrl: msg.imageUrl } : undefined,
    },
  };
}

function loadServiceAccount(): Record<string, string> | null {
  const c = config();
  if (c.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(c.FIREBASE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
  if (c.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      return JSON.parse(readFileSync(c.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')) as Record<string, string>;
    } catch {
      return null;
    }
  }
  return null;
}

export class FcmPushProvider implements ChannelProvider {
  readonly name = 'fcm';
  readonly channel = 'push' as const;
  private app?: App;

  isConfigured(): boolean {
    return loadServiceAccount() !== null;
  }

  private getApp(): App {
    if (this.app) return this.app;
    const existing = getApps().find((a) => a.name === 'cep');
    if (existing) return (this.app = existing);
    const sa = loadServiceAccount();
    if (!sa) throw new Error('Firebase service account not found (FIREBASE_SERVICE_ACCOUNT_PATH / _JSON)');
    this.app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) }, 'cep');
    return this.app;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const tokens = msg.tokens ?? [];
    if (!tokens.length) return { accepted: false, provider: this.name, error: 'No push tokens', permanent: true };
    if (!this.isConfigured()) return { accepted: false, provider: this.name, error: 'Firebase service account is not configured' };

    const messaging = getMessaging(this.getApp());
    const invalidTokens: string[] = [];
    const ids: string[] = [];
    const errors: string[] = [];

    // FCM multicast limit is 500 tokens per call.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast(buildFcmMessage(msg, batch));
      res.responses.forEach((r, idx) => {
        if (r.success && r.messageId) ids.push(r.messageId);
        else if (r.error) {
          if (INVALID_TOKEN_CODES.has(r.error.code)) invalidTokens.push(batch[idx]!);
          else errors.push(r.error.code);
        }
      });
    }

    return {
      accepted: ids.length > 0,
      provider: this.name,
      providerMessageId: ids[0],
      invalidTokens,
      permanent: ids.length === 0 && errors.length === 0, // every token was invalid
      error: ids.length ? undefined : `FCM: no token accepted (${[...new Set(errors)].join(', ') || 'all tokens invalid'})`,
    };
  }
}
