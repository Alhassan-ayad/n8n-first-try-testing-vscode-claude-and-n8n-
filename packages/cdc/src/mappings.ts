// Table → event mappers. Each mapper receives one CDC change (before/after
// row images) and returns the platform events it implies.
//
// Table and column names follow the mngm core schema as documented in
// docs/event-taxonomy.md (and simulated by docker/mssql/02-source-sim.sql).
// If the production schema differs, adjust the `table` and the column reads
// here — the rest of the platform only sees the normalised events.

import type { EventType } from '@cep/core';

export type Row = Record<string, unknown>;

export interface Change {
  op: 'insert' | 'update' | 'delete';
  before?: Row;
  after?: Row;
  occurredAt: Date;
}

export interface MappedEvent {
  type: EventType;
  clientExternalId?: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

export interface TableMapping {
  /** CDC capture instance, by default `<schema>_<table>`. */
  captureInstance: string;
  table: string;
  map(change: Change): MappedEvent[];
}

const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
const changed = (c: Change, col: string) => c.op === 'update' && s(c.before?.[col]) !== s(c.after?.[col]);
const lower = (v: unknown) => s(v)?.toLowerCase();
const date = (v: unknown, fallback: Date) => (v instanceof Date ? v : v ? new Date(String(v)) : fallback);

/** Status column transitioned to a new value (insert with that status counts). */
function statusTo(c: Change, col = 'Status'): string | undefined {
  if (c.op === 'insert') return lower(c.after?.[col]);
  if (c.op === 'update' && changed(c, col)) return lower(c.after?.[col]);
  return undefined;
}

export const MAPPINGS: TableMapping[] = [
  {
    captureInstance: 'dbo_Users',
    table: 'dbo.Users',
    map(c) {
      const r = c.after ?? c.before!;
      const uid = s(r.Id)!;
      const profile = {
        fullName: s(r.FullName),
        phone: s(r.Phone),
        email: s(r.Email),
        language: lower(r.Language) === 'en' ? 'en' : 'ar',
        source: s(r.Source) ?? 'organic',
        isFormerInstalment: Boolean(r.IsFormerInstalment),
      };
      if (c.op === 'insert') return [{ type: 'client.registered', clientExternalId: uid, payload: profile, occurredAt: date(r.CreatedAt, c.occurredAt) }];
      if (c.op !== 'update') return [];
      const out: MappedEvent[] = [];
      if (statusTo(c) === 'closed') out.push({ type: 'client.closed', clientExternalId: uid, payload: { reason: s(r.CloseReason) } });
      if (['FullName', 'Phone', 'Email', 'Language', 'IsFormerInstalment'].some((col) => changed(c, col))) {
        out.push({ type: 'client.updated', clientExternalId: uid, payload: profile });
      }
      return out;
    },
  },
  {
    captureInstance: 'dbo_KycApplications',
    table: 'dbo.KycApplications',
    map(c) {
      const r = c.after!;
      const st = statusTo(c);
      if (!st) return [];
      const base = { applicationId: s(r.Id), attempt: n(r.Attempt) ?? 1 };
      const uid = s(r.UserId);
      if (st === 'submitted') return [{ type: 'ekyc.submitted', clientExternalId: uid, payload: base }];
      if (st === 'approved') return [{ type: 'ekyc.approved', clientExternalId: uid, payload: base }];
      if (st === 'rejected') return [{ type: 'ekyc.rejected', clientExternalId: uid, payload: { ...base, reason: s(r.RejectionReason) } }];
      return [];
    },
  },
  {
    captureInstance: 'dbo_CashTransactions',
    table: 'dbo.CashTransactions',
    map(c) {
      const r = c.after!;
      const st = statusTo(c);
      if (!st) return [];
      const dir = lower(r.Direction);
      const payload = { transactionId: s(r.Id), amount: n(r.Amount), method: s(r.Method) };
      const uid = s(r.UserId);
      if (dir === 'in' && st === 'settled') return [{ type: 'cash.in.settled', clientExternalId: uid, payload }];
      if (dir === 'out' && st === 'requested') return [{ type: 'cash.out.requested', clientExternalId: uid, payload }];
      if (dir === 'out' && st === 'executed') return [{ type: 'cash.out.executed', clientExternalId: uid, payload }];
      return [];
    },
  },
  {
    captureInstance: 'dbo_Orders',
    table: 'dbo.Orders',
    map(c) {
      const r = c.after!;
      const st = statusTo(c);
      if (!st) return [];
      const payload = {
        orderId: s(r.Id),
        side: lower(r.Side) ?? 'buy',
        metal: lower(r.Metal) ?? 'gold',
        grams: n(r.Grams),
        pricePerGram: n(r.PricePerGram),
        amount: n(r.Amount),
        reason: s(r.FailureReason),
      };
      const map: Record<string, EventType> = {
        started: 'order.started',
        placed: 'order.placed',
        executed: 'order.executed',
        failed: 'order.failed',
        cancelled: 'order.cancelled',
      };
      const type = map[st];
      return type ? [{ type, clientExternalId: s(r.UserId), payload }] : [];
    },
  },
  {
    captureInstance: 'dbo_Conversions',
    table: 'dbo.Conversions',
    map(c) {
      const r = c.after!;
      const out: MappedEvent[] = [];
      const st = statusTo(c);
      const payload = {
        conversionId: s(r.Id),
        metal: lower(r.Metal) ?? 'gold',
        grams: n(r.Grams),
        courierName: s(r.CourierName),
        courierPhone: s(r.CourierPhone),
        slotAt: r.DeliverySlotAt instanceof Date ? r.DeliverySlotAt.toISOString() : s(r.DeliverySlotAt),
      };
      const uid = s(r.UserId);
      const map: Record<string, EventType> = {
        accepted: 'conversion.accepted',
        ready: 'conversion.ready',
        dispatched: 'conversion.dispatched',
        delivered: 'conversion.delivered',
      };
      if (st && map[st]) out.push({ type: map[st]!, clientExternalId: uid, payload });
      const slotSet = c.op === 'insert' ? Boolean(r.DeliverySlotAt) : changed(c, 'DeliverySlotAt') && Boolean(r.DeliverySlotAt);
      if (slotSet) out.push({ type: 'delivery.scheduled', clientExternalId: uid, payload });
      return out;
    },
  },
  {
    captureInstance: 'dbo_Uploads',
    table: 'dbo.Uploads',
    map(c) {
      const r = c.after!;
      const st = statusTo(c);
      const map: Record<string, EventType> = { received: 'upload.received', assayed: 'upload.assayed', credited: 'upload.credited' };
      if (!st || !map[st]) return [];
      return [
        {
          type: map[st]!,
          clientExternalId: s(r.UserId),
          payload: { uploadId: s(r.Id), metal: lower(r.Metal) ?? 'gold', grams: n(r.Grams), purity: n(r.Purity) },
        },
      ];
    },
  },
  {
    captureInstance: 'dbo_Gifts',
    table: 'dbo.Gifts',
    map(c) {
      if (c.op !== 'insert') return [];
      const r = c.after!;
      const payload = {
        giftId: s(r.Id),
        metal: lower(r.Metal) ?? 'gold',
        grams: n(r.Grams),
        recipientName: s(r.RecipientName),
        recipientPhone: s(r.RecipientPhone),
        recipientExternalId: s(r.RecipientUserId),
        senderExternalId: s(r.SenderUserId),
        senderName: s(r.SenderName),
      };
      const out: MappedEvent[] = [{ type: 'gift.sent', clientExternalId: s(r.SenderUserId), payload }];
      // Recipient may not be a client yet — the engine then sends SMS to recipientPhone.
      out.push({ type: 'gift.received', clientExternalId: s(r.RecipientUserId), payload });
      return out;
    },
  },
  {
    captureInstance: 'dbo_RecurringPlans',
    table: 'dbo.RecurringPlans',
    map(c) {
      const r = c.after!;
      const payload = { planId: s(r.Id), amount: n(r.Amount), metal: lower(r.Metal) ?? 'gold', dayOfMonth: n(r.DayOfMonth) };
      const uid = s(r.UserId);
      if (c.op === 'insert' && lower(r.Status) !== 'cancelled') return [{ type: 'plan.created', clientExternalId: uid, payload }];
      if (statusTo(c) === 'cancelled') return [{ type: 'plan.cancelled', clientExternalId: uid, payload }];
      return [];
    },
  },
  {
    captureInstance: 'dbo_PlanDebits',
    table: 'dbo.PlanDebits',
    map(c) {
      const r = c.after!;
      const st = statusTo(c);
      const payload = {
        planId: s(r.PlanId),
        debitId: s(r.Id),
        amount: n(r.Amount),
        grams: n(r.Grams),
        reason: s(r.FailureReason),
        attemptNo: n(r.AttemptNo) ?? 1,
        consecutiveMonths: n(r.ConsecutiveMonths),
      };
      if (st === 'succeeded') return [{ type: 'plan.debit.succeeded', clientExternalId: s(r.UserId), payload }];
      if (st === 'failed') return [{ type: 'plan.debit.failed', clientExternalId: s(r.UserId), payload }];
      return [];
    },
  },
  {
    captureInstance: 'dbo_SecurityEvents',
    table: 'dbo.SecurityEvents',
    map(c) {
      if (c.op !== 'insert') return [];
      const r = c.after!;
      const map: Record<string, EventType> = {
        new_device: 'security.new_device',
        password_changed: 'security.password_changed',
        bank_changed: 'security.bank_changed',
      };
      const type = map[lower(r.Type) ?? ''];
      return type ? [{ type, clientExternalId: s(r.UserId), payload: { device: s(r.Device) } }] : [];
    },
  },
  {
    captureInstance: 'dbo_Logins',
    table: 'dbo.Logins',
    map(c) {
      if (c.op !== 'insert') return [];
      const r = c.after!;
      return [{ type: 'client.login', clientExternalId: s(r.UserId), payload: { device: s(r.Device) }, occurredAt: date(r.CreatedAt, c.occurredAt) }];
    },
  },
  {
    captureInstance: 'dbo_Prices',
    table: 'dbo.Prices',
    map(c) {
      if (c.op !== 'insert') return [];
      const r = c.after!;
      const metal = lower(r.Metal) ?? 'gold';
      const at = date(r.CreatedAt, c.occurredAt);
      if (r.IsStale) return [{ type: 'price.feed.stale', payload: { metal, tradingPaused: Boolean(r.TradingPaused) }, occurredAt: at }];
      return [{ type: 'price.tick', payload: { metal, buyPrice: n(r.BuyPrice), sellPrice: n(r.SellPrice) }, occurredAt: at }];
    },
  },
  {
    captureInstance: 'dbo_OtpRequests',
    table: 'dbo.OtpRequests',
    map(c) {
      if (c.op !== 'insert') return [];
      const r = c.after!;
      return [
        {
          type: 'otp.requested',
          clientExternalId: s(r.UserId),
          payload: { code: s(r.Code), phone: s(r.Phone), email: s(r.Email), purpose: s(r.Purpose) },
        },
      ];
    },
  },
];
