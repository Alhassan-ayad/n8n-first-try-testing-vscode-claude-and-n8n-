// Lifecycle journeys (plan §5.3 and §7). Each journey has entry rules, exit
// rules, a goal event used for holdout measurement, and timed steps. Steps are
// persisted as JourneyStepRun rows and executed by the worker; exit rules are
// re-checked before every step.

import type { EventType, PlatformEvent } from './events';
import { tierAtLeast } from './lifecycle';
import { atCairo } from './time';
import type { Channel, ClientFacts, Kind, Objective, Topic } from './types';

export type JourneyAction =
  | { type: 'message'; channels: Channel[]; template: string; kind?: Kind; topic?: Topic; inbox?: boolean }
  | { type: 'call'; reason: string; priority?: number }
  | { type: 'tag'; add?: string[]; remove?: string[] };

export interface JourneyStep {
  id: string;
  /** Hours after enrolment… */
  afterHours?: number;
  /** …or day offset from enrolment plus Cairo time. */
  day?: number;
  at?: string;
  actions: JourneyAction[];
  /** Step is skipped (not the journey) when this returns false. */
  when?: (c: ClientFacts) => boolean;
  note?: string;
}

export type EntryScan = 'at_risk' | 'dormant' | 'former_instalment' | 'payday';

export interface JourneyDef {
  key: string;
  name: string;
  objective: Objective;
  description: string;
  owner: string;
  entry: {
    events?: EventType[];
    filter?: (c: ClientFacts, e?: PlatformEvent) => boolean;
    /** Nightly scan that enrols matching clients. */
    scan?: EntryScan;
    /** Can be entered by the engine / admin explicitly (enrolByKey). */
    manual?: boolean;
  };
  exitOn: EventType[];
  /** Re-checked before each step. Return a reason string to exit. */
  exitWhen?: (c: ClientFacts) => string | false;
  goalEvent: EventType;
  goalFilter?: (c: ClientFacts, e: PlatformEvent) => boolean;
  holdoutPct: number;
  /** Days before a client may re-enter after leaving. `null` = never. */
  reentryCooldownDays: number | null;
  defaultKind: Kind;
  defaultTopic: Topic;
  steps: JourneyStep[];
  onComplete?: { addTags?: string[] };
}

const isBuy = (e?: PlatformEvent) => (e?.payload.side ?? 'buy') === 'buy';
const premiumPlus = (c: ClientFacts) => tierAtLeast(c.valueTier, 'premium');

export const JOURNEYS: JourneyDef[] = [
  // ── 7.1 Activation (S1 → S2) ─────────────────────────────────────────────
  {
    key: 'activation',
    name: 'Activation — registered, not activated',
    objective: 'O1',
    owner: 'CRM, Call Centre',
    description: 'Moves registrations through eKYC. Touches at 2h, D1, D2, D4, D7, D14, D21 survey, D30.',
    entry: {
      events: ['client.registered'],
      filter: (c) => c.kycStatus !== 'approved' && !c.tags.includes('manual_kyc_queue'),
      manual: true,
    },
    exitOn: ['ekyc.approved', 'client.closed'],
    exitWhen: (c) =>
      c.kycStatus === 'approved' ? 'activated' : c.kycRejectCount >= 2 ? 'rejected_twice_manual_queue' : false,
    goalEvent: 'ekyc.approved',
    holdoutPct: 10,
    reentryCooldownDays: null,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'T1', afterHours: 2, actions: [{ type: 'message', channels: ['push', 'email'], template: 'act_t1', inbox: true }], note: 'One step left — what is needed, how long it takes' },
      { id: 'T2', day: 1, at: '12:00', actions: [{ type: 'message', channels: ['sms'], template: 'act_t2' }], note: 'Short link straight into eKYC' },
      { id: 'T3', day: 2, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'act_t3', inbox: true }], note: 'Security and trust' },
      {
        id: 'T4',
        day: 4,
        at: '11:00',
        actions: [{ type: 'call', reason: 'activation_help', priority: 3 }],
        when: (c) => tierAtLeast(c.valueTier, 'core') || c.tags.includes('high_intent') || c.source !== 'organic',
        note: 'Outbound call for Core value signals and above',
      },
      { id: 'T5', day: 7, at: '12:00', actions: [{ type: 'message', channels: ['whatsapp'], template: 'act_t5' }], note: 'Guided help with human handover' },
      {
        id: 'T7a',
        day: 14,
        at: '11:00',
        actions: [{ type: 'message', channels: ['push', 'sms'], template: 'act_offer', kind: 'promotion', topic: 'promotions', inbox: true }],
        note: 'Activation offer — bonus grams, time-limited',
      },
      {
        id: 'T6',
        day: 21,
        at: '12:00',
        actions: [{ type: 'message', channels: ['sms', 'email'], template: 'act_survey', kind: 'feedback', topic: 'feedback' }],
        note: 'Drop-off survey: four fixed reasons + free text',
      },
      {
        id: 'T7b',
        day: 30,
        at: '11:00',
        actions: [{ type: 'message', channels: ['push', 'sms'], template: 'act_offer_last', kind: 'promotion', topic: 'promotions', inbox: true }],
        note: 'Activation offer — last reminder',
      },
    ],
  },

  // ── 7.2 First purchase (S2 → S3) ─────────────────────────────────────────
  {
    key: 'first_purchase',
    name: 'First purchase',
    objective: 'O1',
    owner: 'CRM',
    description: 'From eKYC approval. Shows fractional entry from 0.001 g. Touches at D0, D2, D5, D10 with the 3-part education pack.',
    entry: { events: ['ekyc.approved'], filter: (c) => c.orderCount === 0, manual: true },
    exitOn: ['order.executed', 'client.closed'],
    exitWhen: (c) => (c.orderCount > 0 ? 'purchased' : false),
    goalEvent: 'order.executed',
    holdoutPct: 10,
    reentryCooldownDays: null,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'D0', afterHours: 1, actions: [{ type: 'message', channels: ['push'], template: 'fp_d0', inbox: true }, { type: 'message', channels: ['email'], template: 'edu_1', kind: 'education', topic: 'education' }] },
      { id: 'D2', day: 2, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'fp_d2' }] },
      { id: 'D5', day: 5, at: '11:00', actions: [{ type: 'message', channels: ['email'], template: 'edu_2', kind: 'education', topic: 'education' }] },
      { id: 'D10', day: 10, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'fp_d10', inbox: true }, { type: 'message', channels: ['email'], template: 'edu_3', kind: 'education', topic: 'education' }] },
    ],
  },

  // ── 7.2 Second purchase (S3 → S4) ────────────────────────────────────────
  {
    key: 'second_purchase',
    name: 'Second purchase',
    objective: 'O3',
    owner: 'CRM',
    description: 'From first order. D7 market context, D21 education tied to what they bought, D45 recurring plan invitation.',
    entry: { events: ['order.executed'], filter: (c, e) => c.orderCount === 1 && isBuy(e) },
    exitOn: ['client.closed'],
    exitWhen: (c) => (c.orderCount >= 2 ? 'second_order' : false),
    goalEvent: 'order.executed',
    goalFilter: (c) => c.orderCount >= 2,
    holdoutPct: 10,
    reentryCooldownDays: null,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'D7', day: 7, at: '11:00', actions: [{ type: 'message', channels: ['push'], template: 'sp_d7', inbox: true }] },
      { id: 'D21', day: 21, at: '11:00', actions: [{ type: 'message', channels: ['email'], template: 'sp_d21', kind: 'education', topic: 'education' }] },
      { id: 'D45', day: 45, at: '19:00', actions: [{ type: 'message', channels: ['push', 'email'], template: 'sp_d45', inbox: true }] },
    ],
  },

  // ── 7.3 Recurring plan cross-sell ────────────────────────────────────────
  {
    key: 'recurring_xsell',
    name: 'Recurring plan cross-sell',
    objective: 'O2',
    owner: 'CRM',
    description: 'On second order, a pay-day buying pattern, or a manual buy above average. Saving habit, never credit.',
    entry: {
      events: ['order.executed'],
      filter: (c, e) =>
        !c.hasRecurringPlan &&
        isBuy(e) &&
        (c.orderCount === 2 || (c.orderCount > 2 && Number(e?.payload.amount ?? 0) > c.avgOrderAmount * 1.5)),
      scan: 'payday',
      manual: true,
    },
    exitOn: ['plan.created', 'client.closed'],
    exitWhen: (c) => (c.hasRecurringPlan ? 'plan_created' : false),
    goalEvent: 'plan.created',
    holdoutPct: 10,
    reentryCooldownDays: 90,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'X1', day: 1, at: '19:00', actions: [{ type: 'message', channels: ['push', 'email'], template: 'rp_x1', inbox: true }] },
      { id: 'X2', day: 7, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'rp_x2' }] },
      { id: 'X3', day: 10, at: '11:00', actions: [{ type: 'call', reason: 'recurring_xsell', priority: 4 }], when: premiumPlus, note: 'Call for Premium and above' },
    ],
  },

  // ── 7.4 Former instalment-finance clients ────────────────────────────────
  {
    key: 'former_instalment',
    name: 'Former instalment-finance clients',
    objective: 'O2',
    owner: 'CRM, Call Centre',
    description: 'Two weeks after the FRA notice: alternatives. Then months 1, 2, 3: offer, education, call (Premium/Private).',
    entry: { scan: 'former_instalment', filter: (c) => c.tags.includes('former_instalment'), manual: true },
    exitOn: ['client.closed'],
    goalEvent: 'plan.created',
    holdoutPct: 10,
    reentryCooldownDays: null,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'W2', day: 14, at: '12:00', actions: [{ type: 'message', channels: ['push', 'email', 'sms'], template: 'fi_alternatives', inbox: true }], note: 'What you can do instead — one message, one clear option' },
      { id: 'M1', day: 44, at: '19:00', actions: [{ type: 'message', channels: ['push', 'email'], template: 'fi_m1_offer', kind: 'promotion', topic: 'promotions', inbox: true }] },
      { id: 'M2', day: 74, at: '11:00', actions: [{ type: 'message', channels: ['email'], template: 'fi_m2_education', kind: 'education', topic: 'education' }] },
      { id: 'M3call', day: 104, at: '11:00', actions: [{ type: 'call', reason: 'former_instalment', priority: 3 }], when: premiumPlus },
      { id: 'M3', day: 104, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'fi_m3', inbox: true }], when: (c) => !premiumPlus(c) },
    ],
  },

  // ── 7.5 At-risk (S6) ─────────────────────────────────────────────────────
  {
    key: 'at_risk',
    name: 'At-risk re-engagement',
    objective: 'O4',
    owner: 'CRM',
    description: 'Entry at 60 days inactive. D60 relevance only, D75, D90 value reminder plus a reason to act (SMS at D90).',
    entry: { scan: 'at_risk' },
    exitOn: ['order.executed', 'client.closed'],
    goalEvent: 'order.executed',
    holdoutPct: 10,
    reentryCooldownDays: 120,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'D60', day: 0, at: '11:00', actions: [{ type: 'message', channels: ['push', 'email'], template: 'ar_d60', inbox: true }] },
      { id: 'D75', day: 15, at: '19:00', actions: [{ type: 'message', channels: ['push'], template: 'ar_d75' }] },
      { id: 'D90', day: 30, at: '11:00', actions: [{ type: 'message', channels: ['push', 'email', 'sms'], template: 'ar_d90', inbox: true }] },
    ],
  },

  // ── 7.5 Dormant win-back (S7) ────────────────────────────────────────────
  {
    key: 'winback',
    name: 'Dormant win-back',
    objective: 'O4',
    owner: 'CRM, Call Centre',
    description: 'Entry at 180 days. Real offer with expiry, call for Premium/Private. After D240 with no response: quarterly-only list.',
    entry: { scan: 'dormant' },
    exitOn: ['order.executed', 'client.closed'],
    goalEvent: 'order.executed',
    holdoutPct: 10,
    reentryCooldownDays: 365,
    defaultKind: 'promotion',
    defaultTopic: 'promotions',
    steps: [
      { id: 'D180', day: 0, at: '11:00', actions: [{ type: 'message', channels: ['email', 'sms'], template: 'wb_d180' }] },
      { id: 'D180call', day: 2, at: '11:00', actions: [{ type: 'call', reason: 'winback', priority: 3 }], when: premiumPlus },
      { id: 'D210', day: 30, at: '11:00', actions: [{ type: 'message', channels: ['email'], template: 'wb_d210', kind: 'lifecycle', topic: 'lifecycle' }] },
      { id: 'D240', day: 60, at: '11:00', actions: [{ type: 'message', channels: ['email', 'sms'], template: 'wb_d240' }] },
    ],
    onComplete: { addTags: ['quarterly_only'] },
  },

  // ── Abandoned order recovery ─────────────────────────────────────────────
  {
    key: 'abandoned_order',
    name: 'Abandoned order recovery',
    objective: 'O3',
    owner: 'CRM',
    description: 'Order started and not completed. Touches at 1h and 24h.',
    entry: { events: ['order.started'] },
    exitOn: ['order.placed', 'order.executed', 'client.closed'],
    goalEvent: 'order.executed',
    holdoutPct: 10,
    reentryCooldownDays: 3,
    defaultKind: 'lifecycle',
    defaultTopic: 'lifecycle',
    steps: [
      { id: 'H1', afterHours: 1, actions: [{ type: 'message', channels: ['push'], template: 'abandoned_1h' }] },
      { id: 'H24', afterHours: 24, actions: [{ type: 'message', channels: ['push', 'email'], template: 'abandoned_24h', inbox: true }] },
    ],
  },

  // ── Referral invitation ──────────────────────────────────────────────────
  {
    key: 'referral_invite',
    name: 'Referral invitation',
    objective: 'O3',
    owner: 'CRM',
    description: 'After a positive CSAT (4–5) or a gram milestone.',
    entry: { manual: true },
    exitOn: ['client.closed'],
    goalEvent: 'client.registered',
    holdoutPct: 10,
    reentryCooldownDays: 90,
    defaultKind: 'promotion',
    defaultTopic: 'promotions',
    steps: [{ id: 'R1', afterHours: 2, actions: [{ type: 'message', channels: ['push'], template: 'referral_invite', inbox: true }] }],
  },
];

export const JOURNEY_BY_KEY = new Map(JOURNEYS.map((j) => [j.key, j]));

export function stepFireAt(enrolledAt: Date, step: JourneyStep): Date {
  if (step.afterHours !== undefined) return new Date(enrolledAt.getTime() + step.afterHours * 3_600_000);
  if (step.day !== undefined && step.at) {
    const t = atCairo(enrolledAt, step.day, step.at);
    // A day-0 time already in the past fires as soon as possible.
    return t < enrolledAt ? enrolledAt : t;
  }
  return new Date(enrolledAt.getTime() + (step.day ?? 0) * 86_400_000);
}
