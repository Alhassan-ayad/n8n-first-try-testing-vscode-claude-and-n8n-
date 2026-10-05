export interface Attachment {
  filename: string;
  contentBase64: string;
  type: string;
}

/** A fully rendered message, ready for a provider. */
export interface OutboundMessage {
  id: string;
  channel: 'sms' | 'email' | 'push' | 'whatsapp';
  language: 'ar' | 'en';
  /** Phone (sms/whatsapp), email address (email). Push uses `tokens`. */
  to?: string;
  tokens?: string[];
  subject?: string | null;
  title?: string | null;
  body: string;
  html?: string | null;
  deepLink?: string | null;
  imageUrl?: string | null;
  category: string;
  topic: string;
  /** Marketing mail goes from the marketing subdomain with unsubscribe group + List-Unsubscribe. */
  marketing: boolean;
  unsubscribeUrl?: string | null;
  attachments?: Attachment[];
  data?: Record<string, string>;
}

export interface SendResult {
  accepted: boolean;
  provider: string;
  providerMessageId?: string;
  /** Push tokens the provider reported as no longer valid. */
  invalidTokens?: string[];
  /** Permanent failure — don't retry (bad number, invalid address…). */
  permanent?: boolean;
  error?: string;
  raw?: unknown;
}

export interface ChannelProvider {
  readonly name: string;
  readonly channel: OutboundMessage['channel'];
  send(msg: OutboundMessage): Promise<SendResult>;
  /** True when credentials are present (live) or provider is a mock. */
  isConfigured(): boolean;
}
