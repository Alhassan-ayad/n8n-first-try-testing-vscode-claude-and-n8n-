// Shared vocabulary for the engagement platform (plan §3–§6).

export const CHANNELS = ['push', 'email', 'sms', 'inapp', 'whatsapp', 'call'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Channels a client can grant/withhold consent for. In-app is part of the service. */
export const CONSENT_CHANNELS = ['push', 'email', 'sms', 'whatsapp', 'call'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** Plan §5 categories. A is mandatory. */
export const CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Consent topics shown in the preference centre. `transactional` and
 * `service_notice` are mandatory (no consent needed, cannot be switched off).
 */
export const TOPICS = [
  'transactional',
  'service_notice',
  'price_daily',
  'price_alerts',
  'market_research',
  'lifecycle',
  'promotions',
  'education',
  'feedback',
] as const;
export type Topic = (typeof TOPICS)[number];
export const MANDATORY_TOPICS: ReadonlySet<Topic> = new Set(['transactional', 'service_notice']);
export const CONSENTABLE_TOPICS = TOPICS.filter((t) => !MANDATORY_TOPICS.has(t));

/** Topics that count as "marketing" for registration-time consent capture. */
export const MARKETING_TOPICS: Topic[] = ['lifecycle', 'promotions', 'education'];

/** Message kind drives priority (plan §6.3 priority order). */
export const KINDS = [
  'otp',
  'transactional',
  'service',
  'security',
  'client_alert',
  'research',
  'lifecycle',
  'promotion',
  'education',
  'feedback',
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_PRIORITY: Record<Kind, number> = {
  otp: 1,
  transactional: 1,
  service: 1,
  security: 2,
  client_alert: 3,
  research: 3,
  lifecycle: 4,
  promotion: 5,
  feedback: 5,
  education: 6,
};

/** Kinds that bypass consent, suppression(marketing), quiet hours and caps. */
export const MANDATORY_KINDS: ReadonlySet<Kind> = new Set(['otp', 'transactional', 'service', 'security']);

/** Kinds that count against marketing frequency caps (Categories C, D, E). */
export const CAPPED_KINDS: ReadonlySet<Kind> = new Set(['lifecycle', 'promotion', 'education']);

export const LIFECYCLE_STAGES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const STAGE_LABELS: Record<LifecycleStage, string> = {
  S1: 'Registered',
  S2: 'Activated',
  S3: 'First-time buyer',
  S4: 'Active investor',
  S5: 'Recurring investor',
  S6: 'At risk',
  S7: 'Dormant',
  S8: 'Churned / closed',
};

export const VALUE_TIERS = ['entry', 'core', 'premium', 'private'] as const;
export type ValueTier = (typeof VALUE_TIERS)[number];

export type Language = 'ar' | 'en';

export const OBJECTIVES = {
  O1: 'Activate registered clients',
  O2: 'Replace lost instalment volume',
  O3: 'Raise purchase frequency',
  O4: 'Retain and reactivate',
  O5: 'Build trust and understanding',
} as const;
export type Objective = keyof typeof OBJECTIVES;

/** Overlay tags (plan §3.2). Free-form tags are allowed too. */
export const KNOWN_TAGS = [
  'gold_only',
  'silver_only',
  'gold_and_silver',
  'physical_delivery',
  'storage_only',
  'recurring_plan',
  'gift_sender',
  'gold_uploader',
  'price_sensitive',
  'calendar_driven',
  'event_driven',
  'accumulator',
  'former_instalment',
  'partner_moneyfellows',
  'b2b2c',
  'referral',
  'quarterly_only',
  'manual_kyc_queue',
] as const;

export interface ClientFacts {
  id: string;
  externalId: string;
  language: Language;
  lifecycleStage: LifecycleStage;
  valueTier: ValueTier;
  tags: string[];
  kycStatus: string;
  kycRejectCount: number;
  orderCount: number;
  avgOrderAmount: number;
  goldGrams: number;
  silverGrams: number;
  holdingValueEgp: number;
  hasRecurringPlan: boolean;
  registeredAt: Date;
  activatedAt?: Date | null;
  firstOrderAt?: Date | null;
  lastOrderAt?: Date | null;
  lastLoginAt?: Date | null;
  closedAt?: Date | null;
  phone?: string | null;
  email?: string | null;
  fullName?: string | null;
  source: string;
}
