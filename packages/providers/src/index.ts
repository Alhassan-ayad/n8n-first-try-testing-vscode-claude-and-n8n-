import { channelMode, type ProviderChannel } from '@cep/core';
import { EzagelSmsProvider } from './ezagel';
import { FcmPushProvider } from './fcm';
import { SendGridEmailProvider } from './sendgrid';
import type { ChannelProvider, OutboundMessage, SendResult } from './types';

export * from './types';
export * from './ezagel';
export * from './sendgrid';
export * from './fcm';

/**
 * Mock provider: accepts everything, logs it, and returns a fake id. Lets the
 * whole platform run end-to-end before credentials arrive.
 */
export class MockProvider implements ChannelProvider {
  readonly name: string;
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: OutboundMessage['channel']) {
    this.name = `mock-${channel}`;
  }

  isConfigured(): boolean {
    return true;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    this.sent.push(msg);
    if (this.sent.length > 1000) this.sent.shift();
    const to = msg.channel === 'push' ? `${msg.tokens?.length ?? 0} token(s)` : msg.to;
    console.log(`[mock:${msg.channel}] → ${to} :: ${(msg.subject ?? msg.title ?? '').slice(0, 60)} ${msg.body.slice(0, 120).replace(/\s+/g, ' ')}`);
    return { accepted: true, provider: this.name, providerMessageId: `mock-${msg.id}` };
  }
}

const live: Record<ProviderChannel, () => ChannelProvider> = {
  sms: () => new EzagelSmsProvider(),
  email: () => new SendGridEmailProvider(),
  push: () => new FcmPushProvider(),
  whatsapp: () => new MockProvider('whatsapp'), // Phase 2 — no BSP chosen yet
};

const instances = new Map<string, ChannelProvider>();

export function getProvider(channel: ProviderChannel): ChannelProvider {
  const mode = channelMode(channel);
  const key = `${channel}:${mode}`;
  let p = instances.get(key);
  if (!p) {
    p = mode === 'live' ? live[channel]() : new MockProvider(channel);
    instances.set(key, p);
  }
  return p;
}

export function providerStatus() {
  return (['sms', 'email', 'push', 'whatsapp'] as const).map((channel) => {
    const mode = channelMode(channel);
    const liveProvider = live[channel]();
    return {
      channel,
      mode,
      provider: mode === 'live' ? liveProvider.name : `mock-${channel}`,
      liveProvider: liveProvider.name,
      credentialsPresent: liveProvider.isConfigured(),
    };
  });
}
