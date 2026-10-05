import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
  SMS_MODE: z.string().optional(),
  EMAIL_MODE: z.string().optional(),
  PUSH_MODE: z.string().optional(),
  WHATSAPP_MODE: z.string().default('mock'),

  DATABASE_URL: z.string().optional(),
  SOURCE_MSSQL_URL: z.string().optional(),
  CDC_START: z.enum(['latest', 'earliest']).default('latest'),
  CDC_POLL_MS: z.coerce.number().default(2000),
  CDC_DISABLED_INSTANCES: z.string().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  APP_DEEPLINK_BASE: z.string().default('mngm://app'),
  APP_WEB_BASE: z.string().default('https://mngm.com/app'),

  ADMIN_JWT_SECRET: z.string().default('dev-admin-secret'),
  CLIENT_API_HMAC_SECRET: z.string().default('dev-client-secret'),
  UNSUBSCRIBE_SECRET: z.string().default('dev-unsub-secret'),
  ADMIN_EMAIL: z.string().default('admin@mngm.local'),
  ADMIN_PASSWORD: z.string().default('ChangeMe!2026'),

  EZAGEL_BASE_URL: z.string().default(''),
  EZAGEL_USERNAME: z.string().default(''),
  EZAGEL_PASSWORD: z.string().default(''),
  EZAGEL_SENDER_ID: z.string().default('mngm'),
  EZAGEL_SERVICE: z.string().default(''),
  EZAGEL_WEBHOOK_TOKEN: z.string().default(''),
  SMS_OPTOUT_KEYWORDS: z.string().default('STOP,UNSUBSCRIBE,إلغاء,الغاء,توقف'),
  SMS_OPTOUT_FOOTER_EN: z.string().default('Reply STOP to opt out'),
  SMS_OPTOUT_FOOTER_AR: z.string().default('للإلغاء أرسل إلغاء'),

  SENDGRID_API_KEY: z.string().default(''),
  SENDGRID_FROM_TRANSACTIONAL: z.string().default('mngm <no-reply@tx.mngm.com>'),
  SENDGRID_FROM_MARKETING: z.string().default('mngm <news@mail.mngm.com>'),
  SENDGRID_REPLY_TO: z.string().default(''),
  SENDGRID_UNSUB_GROUP_ID: z.string().default(''),
  SENDGRID_IP_POOL_TRANSACTIONAL: z.string().default(''),
  SENDGRID_IP_POOL_MARKETING: z.string().default(''),
  SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().default(''),

  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default(''),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),

  VOLATILITY_THRESHOLD_PCT: z.coerce.number().default(2),
  VOLATILITY_MAX_PER_DAY: z.coerce.number().default(2),
  DIP_THRESHOLD_PCT: z.coerce.number().default(3),
  PRICE_ALERT_WINDOW_START: z.string().default('08:00'),
  PRICE_ALERT_WINDOW_END: z.string().default('23:00'),

  ZAKAT_SUMMARY_DATE: z.string().default('03-01'),
  PUBLIC_HOLIDAYS: z.string().default(''),
  API_PORT: z.coerce.number().default(3000),
  DISABLE_SCHEDULES: bool,
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** For tests. */
export function resetConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  cached = schema.parse({ ...process.env, ...overrides });
  return cached;
}

export type ProviderChannel = 'sms' | 'email' | 'push' | 'whatsapp';

/** Resolves mock|live per channel (per-channel override wins). */
export function channelMode(channel: ProviderChannel): 'mock' | 'live' {
  const c = config();
  const override = { sms: c.SMS_MODE, email: c.EMAIL_MODE, push: c.PUSH_MODE, whatsapp: c.WHATSAPP_MODE }[channel];
  if (override === 'mock' || override === 'live') return override;
  if (channel === 'whatsapp') return 'mock';
  return c.PROVIDER_MODE;
}
