// Communication catalogue (plan §5.1 Category A + §5.6 service notices +
// event-triggered §5.6 feedback). Maps a platform event to the messages it
// produces. Journeys (§5.3) live in ./journeys, price/market (§5.2) in the
// engine's price module, campaigns (§5.4) in the campaign register.

import type { EventType, PlatformEvent } from './events';
import type { Category, Channel, Kind, Topic } from './types';

export interface MessageSpec {
  template: string;
  /** Channels always used. */
  channels: Channel[];
  /** Used only when push cannot reach the client (no valid token / disabled). */
  fallbackIfNoPush?: Channel[];
  kind: Kind;
  category: Category;
  topic: Topic;
  /** Mirror into the in-app inbox (plan §4: every push/SMS campaign has an inbox entry). */
  inbox?: boolean;
  /** Who receives it. `recipient` = gift recipient (payload.recipientExternalId / recipientPhone). */
  audience?: 'client' | 'recipient';
  /** Delay relative to the event. */
  delayMinutes?: number;
  /** Absolute send time from a payload field, plus offset (e.g. delivery slot − 2h). */
  notBeforeField?: { field: string; offsetMinutes: number };
  /** Pending messages sharing a guard key are cancelled by `cancelGuards` events. */
  guardKey?: (e: PlatformEvent) => string;
  when?: (e: PlatformEvent) => boolean;
  owner: string;
}

export interface CatalogEntry {
  messages: MessageSpec[];
  /** Guard keys whose pending messages this event cancels. */
  cancelGuards?: (e: PlatformEvent) => string[];
}

const A = { category: 'A' as const, topic: 'transactional' as const, kind: 'transactional' as const };
const SEC = { category: 'A' as const, topic: 'transactional' as const, kind: 'security' as const };

const planGuard = (e: PlatformEvent) => `plan:${String(e.payload.planId ?? '')}:debit_failed`;

export const CATALOG: Partial<Record<EventType, CatalogEntry>> = {
  'otp.requested': {
    messages: [{ ...SEC, kind: 'otp', template: 'otp', channels: ['sms'], owner: 'Engineering' }],
  },
  'client.registered': {
    messages: [{ ...A, template: 'welcome', channels: ['email', 'push'], inbox: true, owner: 'CRM' }],
  },
  'ekyc.submitted': {
    messages: [{ ...A, template: 'ekyc_submitted', channels: ['push', 'email'], owner: 'Engineering' }],
  },
  'ekyc.approved': {
    messages: [
      {
        ...A,
        template: 'ekyc_approved',
        channels: ['push', 'email'],
        fallbackIfNoPush: ['sms'],
        inbox: true,
        owner: 'Engineering',
      },
    ],
  },
  'ekyc.rejected': {
    messages: [
      {
        ...A,
        template: 'ekyc_rejected',
        channels: ['push', 'email', 'whatsapp'],
        fallbackIfNoPush: ['sms'],
        owner: 'Engineering, Ops',
      },
    ],
  },
  'cash.in.settled': {
    messages: [{ ...A, template: 'cash_in_received', channels: ['push', 'email'], owner: 'Engineering' }],
  },
  'cash.out.requested': {
    messages: [{ ...A, template: 'cash_out_requested', channels: ['push', 'sms', 'email'], owner: 'Engineering' }],
  },
  'cash.out.executed': {
    messages: [{ ...A, template: 'cash_out_executed', channels: ['push', 'sms', 'email'], owner: 'Engineering' }],
  },
  'order.placed': {
    messages: [{ ...A, template: 'order_placed', channels: ['push'], inbox: true, owner: 'Engineering' }],
  },
  'order.executed': {
    messages: [
      { ...A, template: 'order_executed', channels: ['push', 'email'], owner: 'Engineering' },
      {
        category: 'F',
        topic: 'feedback',
        kind: 'feedback',
        template: 'csat_order',
        channels: ['push'],
        inbox: true,
        delayMinutes: 24 * 60,
        owner: 'CX',
      },
    ],
    cancelGuards: (e) => [`order:${String(e.payload.orderId ?? '')}:abandoned`],
  },
  'order.failed': {
    messages: [{ ...A, template: 'order_failed', channels: ['push', 'sms', 'email'], owner: 'Engineering' }],
  },
  'order.cancelled': {
    messages: [{ ...A, template: 'order_cancelled', channels: ['push', 'sms', 'email'], owner: 'Engineering' }],
  },
  'conversion.accepted': {
    messages: [{ ...A, template: 'conversion_accepted', channels: ['push'], inbox: true, owner: 'Ops' }],
  },
  'conversion.ready': {
    messages: [{ ...A, template: 'conversion_ready', channels: ['push'], inbox: true, owner: 'Ops' }],
  },
  'conversion.dispatched': {
    messages: [{ ...A, template: 'conversion_dispatched', channels: ['push', 'sms'], inbox: true, owner: 'Ops' }],
  },
  'conversion.delivered': {
    messages: [
      { ...A, template: 'conversion_delivered', channels: ['push'], inbox: true, owner: 'Ops' },
      {
        category: 'F',
        topic: 'feedback',
        kind: 'feedback',
        template: 'csat_order',
        channels: ['push'],
        inbox: true,
        delayMinutes: 24 * 60,
        owner: 'CX',
      },
    ],
  },
  'delivery.scheduled': {
    messages: [
      { ...A, template: 'delivery_scheduled', channels: ['sms', 'push', 'whatsapp'], owner: 'Ops' },
      {
        ...A,
        template: 'delivery_reminder',
        channels: ['sms'],
        notBeforeField: { field: 'slotAt', offsetMinutes: -120 },
        owner: 'Ops',
      },
    ],
  },
  'upload.received': {
    messages: [{ ...A, template: 'upload_received', channels: ['push', 'email'], owner: 'Ops' }],
  },
  'upload.assayed': {
    messages: [{ ...A, template: 'upload_assayed', channels: ['push', 'email'], owner: 'Ops' }],
  },
  'upload.credited': {
    messages: [{ ...A, template: 'upload_credited', channels: ['push', 'email'], owner: 'Ops' }],
  },
  'gift.sent': {
    messages: [{ ...A, template: 'gift_sent', channels: ['push', 'email'], owner: 'Engineering' }],
  },
  'gift.received': {
    messages: [{ ...A, template: 'gift_received', channels: ['push', 'sms', 'email'], owner: 'Engineering' }],
  },
  'plan.created': {
    messages: [{ ...A, template: 'plan_created', channels: ['push', 'email'], inbox: true, owner: 'Engineering' }],
  },
  'plan.cancelled': {
    messages: [{ ...A, template: 'plan_cancelled', channels: ['push', 'email'], owner: 'Engineering' }],
    cancelGuards: (e) => [planGuard(e)],
  },
  'plan.debit.upcoming': {
    messages: [
      { ...A, template: 'plan_debit_reminder', channels: ['push'], fallbackIfNoPush: ['sms'], inbox: true, owner: 'CRM' },
    ],
  },
  'plan.debit.succeeded': {
    messages: [{ ...A, template: 'plan_debit_succeeded', channels: ['push', 'email'], owner: 'Engineering' }],
    cancelGuards: (e) => [planGuard(e)],
  },
  'plan.debit.failed': {
    // Immediate notice, repeated at T+1 and T+3 unless the plan is funded first.
    // SMS joins from the second failure (attemptNo >= 2) — plan §5.1.
    messages: [
      {
        ...A,
        template: 'plan_debit_failed',
        channels: ['push', 'email'],
        inbox: true,
        owner: 'Engineering',
      },
      {
        ...A,
        template: 'plan_debit_failed',
        channels: ['sms'],
        when: (e) => Number(e.payload.attemptNo ?? 1) >= 2,
        owner: 'Engineering',
      },
      {
        ...A,
        template: 'plan_debit_failed_followup',
        channels: ['push'],
        delayMinutes: 24 * 60,
        guardKey: planGuard,
        when: (e) => Number(e.payload.attemptNo ?? 1) === 1,
        owner: 'Engineering',
      },
      {
        ...A,
        template: 'plan_debit_failed_followup',
        channels: ['push', 'sms'],
        delayMinutes: 3 * 24 * 60,
        guardKey: planGuard,
        when: (e) => Number(e.payload.attemptNo ?? 1) === 1,
        owner: 'Engineering',
      },
    ],
  },
  'security.new_device': {
    messages: [{ ...SEC, template: 'security_new_device', channels: ['sms', 'push', 'email'], owner: 'Engineering' }],
  },
  'security.password_changed': {
    messages: [
      { ...SEC, template: 'security_password_changed', channels: ['sms', 'push', 'email'], owner: 'Engineering' },
    ],
  },
  'security.bank_changed': {
    messages: [{ ...SEC, template: 'security_bank_changed', channels: ['sms', 'push', 'email'], owner: 'Engineering' }],
  },
  'client.closed': {
    messages: [
      {
        category: 'F',
        topic: 'feedback',
        kind: 'feedback',
        template: 'exit_survey',
        channels: ['email'],
        owner: 'CX',
      },
    ],
  },
};

/** Deep-link paths per template key (relative to APP_DEEPLINK_BASE). */
export const DEFAULT_DEEPLINKS: Record<string, string> = {
  welcome: '/kyc',
  ekyc_submitted: '/kyc/status',
  ekyc_approved: '/buy',
  ekyc_rejected: '/kyc',
  cash_in_received: '/wallet',
  cash_out_requested: '/wallet',
  cash_out_executed: '/wallet',
  order_placed: '/orders/{{orderId}}',
  order_executed: '/orders/{{orderId}}',
  order_failed: '/orders/{{orderId}}',
  order_cancelled: '/orders/{{orderId}}',
  conversion_accepted: '/physical/{{conversionId}}',
  conversion_ready: '/physical/{{conversionId}}',
  conversion_dispatched: '/physical/{{conversionId}}',
  conversion_delivered: '/physical/{{conversionId}}',
  delivery_scheduled: '/physical/{{conversionId}}',
  upload_received: '/uploads/{{uploadId}}',
  upload_assayed: '/uploads/{{uploadId}}',
  upload_credited: '/uploads/{{uploadId}}',
  gift_sent: '/gifts',
  gift_received: '/gifts',
  plan_created: '/plans/{{planId}}',
  plan_cancelled: '/plans',
  plan_debit_reminder: '/wallet/topup',
  plan_debit_succeeded: '/plans/{{planId}}',
  plan_debit_failed: '/wallet/topup',
  plan_debit_failed_followup: '/wallet/topup',
  security_new_device: '/security',
  security_password_changed: '/security',
  security_bank_changed: '/security',
  csat_order: '/survey/csat_order',
  daily_price: '/prices',
  price_alert: '/prices/{{metal}}',
  volatility_alert: '/prices/{{metal}}',
  dip_alert: '/buy/{{metal}}',
  price_feed_disruption: '/status',
  price_feed_restored: '/prices',
  monthly_statement: '/statements',
};
