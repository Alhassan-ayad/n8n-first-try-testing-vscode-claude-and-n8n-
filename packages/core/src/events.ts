// Event taxonomy (plan §11, Phase 1). Every platform event the engagement
// platform reacts to. Produced by the CDC mappers (packages/cdc) or the
// client API (POST /v1/events). See docs/event-taxonomy.md.

export const EVENT_TYPES = [
  'client.registered',
  'client.updated',
  'client.closed',
  'client.login',
  'otp.requested',
  'ekyc.submitted',
  'ekyc.approved',
  'ekyc.rejected',
  'cash.in.settled',
  'cash.out.requested',
  'cash.out.executed',
  'order.started',
  'order.placed',
  'order.executed',
  'order.failed',
  'order.cancelled',
  'conversion.accepted',
  'conversion.ready',
  'conversion.dispatched',
  'conversion.delivered',
  'delivery.scheduled',
  'upload.received',
  'upload.assayed',
  'upload.credited',
  'gift.sent',
  'gift.received',
  'plan.created',
  'plan.cancelled',
  'plan.debit.upcoming',
  'plan.debit.succeeded',
  'plan.debit.failed',
  'security.new_device',
  'security.password_changed',
  'security.bank_changed',
  'price.tick',
  'price.feed.stale',
  'price.feed.restored',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface PlatformEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Globally unique and stable: replays are idempotent. */
  id: string;
  type: EventType;
  /** mngm core user id. Absent for market events (price.*). */
  clientExternalId?: string;
  occurredAt: Date;
  payload: P;
  source: 'cdc' | 'api' | 'scheduler';
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** Documented payload fields per event (used for docs and API validation hints). */
export const EVENT_PAYLOADS: Record<EventType, string[]> = {
  'client.registered': ['fullName', 'phone', 'email', 'language', 'source', 'isFormerInstalment'],
  'client.updated': ['fullName', 'phone', 'email', 'language'],
  'client.closed': ['reason'],
  'client.login': ['device'],
  'otp.requested': ['code', 'phone', 'email', 'purpose'],
  'ekyc.submitted': ['applicationId', 'attempt'],
  'ekyc.approved': ['applicationId'],
  'ekyc.rejected': ['applicationId', 'reason', 'attempt'],
  'cash.in.settled': ['transactionId', 'amount', 'method'],
  'cash.out.requested': ['transactionId', 'amount'],
  'cash.out.executed': ['transactionId', 'amount'],
  'order.started': ['orderId', 'side', 'metal', 'amount'],
  'order.placed': ['orderId', 'side', 'metal', 'grams', 'amount'],
  'order.executed': ['orderId', 'side', 'metal', 'grams', 'pricePerGram', 'amount'],
  'order.failed': ['orderId', 'side', 'metal', 'reason'],
  'order.cancelled': ['orderId', 'side', 'metal', 'reason'],
  'conversion.accepted': ['conversionId', 'metal', 'grams'],
  'conversion.ready': ['conversionId', 'metal', 'grams'],
  'conversion.dispatched': ['conversionId', 'courierName', 'courierPhone'],
  'conversion.delivered': ['conversionId'],
  'delivery.scheduled': ['conversionId', 'slotAt', 'courierName', 'courierPhone'],
  'upload.received': ['uploadId', 'metal'],
  'upload.assayed': ['uploadId', 'metal', 'grams', 'purity'],
  'upload.credited': ['uploadId', 'metal', 'grams'],
  'gift.sent': ['giftId', 'metal', 'grams', 'recipientName', 'recipientPhone'],
  'gift.received': ['giftId', 'metal', 'grams', 'senderName'],
  'plan.created': ['planId', 'amount', 'metal', 'dayOfMonth'],
  'plan.cancelled': ['planId'],
  'plan.debit.upcoming': ['planId', 'amount', 'debitDate', 'cashBalance'],
  'plan.debit.succeeded': ['planId', 'debitId', 'amount', 'grams', 'consecutiveMonths'],
  'plan.debit.failed': ['planId', 'debitId', 'amount', 'reason', 'attemptNo'],
  'security.new_device': ['device'],
  'security.password_changed': [],
  'security.bank_changed': [],
  'price.tick': ['metal', 'buyPrice', 'sellPrice'],
  'price.feed.stale': ['metal', 'tradingPaused'],
  'price.feed.restored': ['metal'],
};
