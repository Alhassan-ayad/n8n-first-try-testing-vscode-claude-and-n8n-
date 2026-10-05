import { describe, expect, it } from 'vitest';
import { type Change, MAPPINGS } from './mappings';
import { pairChanges } from './poller';

const map = (instance: string, change: Partial<Change>) =>
  MAPPINGS.find((m) => m.captureInstance === instance)!.map({ occurredAt: new Date('2026-10-01T10:00:00Z'), op: 'insert', ...change } as Change);

describe('CDC row pairing', () => {
  it('pairs update before/after images and keeps inserts/deletes', () => {
    const lsn = Buffer.from('00000025000004a80003', 'hex');
    const seq = Buffer.from('00000025000004a80002', 'hex');
    const rows = [
      { __$start_lsn: lsn, __$seqval: seq, __$operation: 3, Id: 1, Status: 'submitted' },
      { __$start_lsn: lsn, __$seqval: seq, __$operation: 4, Id: 1, Status: 'approved' },
      { __$start_lsn: lsn, __$seqval: Buffer.from('00000025000004a80009', 'hex'), __$operation: 2, Id: 2, Status: 'submitted' },
    ];
    const out = pairChanges(rows, new Map());
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ op: 'update', before: { Status: 'submitted' }, after: { Status: 'approved' } });
    expect(out[1]).toMatchObject({ op: 'insert', after: { Id: 2 } });
    expect(out[0]!.after).not.toHaveProperty('__$operation');
  });
});

describe('table → event mappers', () => {
  it('Users insert → client.registered with profile', () => {
    const e = map('dbo_Users', { after: { Id: 'u1', FullName: 'Mona Ali', Phone: '01012345678', Email: 'M@X.COM', Language: 'EN', Source: 'referral', IsFormerInstalment: true } });
    expect(e).toEqual([
      expect.objectContaining({ type: 'client.registered', clientExternalId: 'u1', payload: expect.objectContaining({ language: 'en', isFormerInstalment: true, source: 'referral' }) }),
    ]);
  });

  it('KYC status transitions', () => {
    expect(map('dbo_KycApplications', { op: 'update', before: { Id: 5, UserId: 'u1', Status: 'submitted' }, after: { Id: 5, UserId: 'u1', Status: 'approved' } })[0]!.type).toBe('ekyc.approved');
    expect(map('dbo_KycApplications', { op: 'update', before: { Id: 5, UserId: 'u1', Status: 'submitted' }, after: { Id: 5, UserId: 'u1', Status: 'rejected', RejectionReason: 'blurry' } })[0]).toMatchObject({ type: 'ekyc.rejected', payload: { reason: 'blurry' } });
    // Unchanged status on update → nothing
    expect(map('dbo_KycApplications', { op: 'update', before: { Id: 5, UserId: 'u1', Status: 'approved' }, after: { Id: 5, UserId: 'u1', Status: 'approved' } })).toEqual([]);
  });

  it('Orders lifecycle', () => {
    const e = map('dbo_Orders', { op: 'update', before: { Id: 9, UserId: 'u1', Status: 'placed' }, after: { Id: 9, UserId: 'u1', Status: 'executed', Side: 'buy', Metal: 'gold', Grams: 2.15, PricePerGram: 4812, Amount: 10345.8 } });
    expect(e[0]).toMatchObject({ type: 'order.executed', payload: { orderId: '9', grams: 2.15, pricePerGram: 4812, side: 'buy' } });
  });

  it('Cash direction and status', () => {
    expect(map('dbo_CashTransactions', { after: { Id: 1, UserId: 'u1', Direction: 'in', Status: 'settled', Amount: 500 } })[0]!.type).toBe('cash.in.settled');
    expect(map('dbo_CashTransactions', { after: { Id: 2, UserId: 'u1', Direction: 'out', Status: 'requested', Amount: 500 } })[0]!.type).toBe('cash.out.requested');
    expect(map('dbo_CashTransactions', { after: { Id: 3, UserId: 'u1', Direction: 'in', Status: 'pending', Amount: 500 } })).toEqual([]);
  });

  it('Conversions emit state change and delivery scheduling', () => {
    const e = map('dbo_Conversions', {
      op: 'update',
      before: { Id: 1, UserId: 'u1', Status: 'ready', DeliverySlotAt: null },
      after: { Id: 1, UserId: 'u1', Status: 'dispatched', DeliverySlotAt: new Date('2026-10-02T10:00:00Z'), CourierName: 'Ahmed' },
    });
    expect(e.map((x) => x.type)).toEqual(['conversion.dispatched', 'delivery.scheduled']);
  });

  it('Gifts notify sender and recipient', () => {
    const e = map('dbo_Gifts', { after: { Id: 1, SenderUserId: 'u1', RecipientUserId: null, RecipientPhone: '01000000000', Metal: 'gold', Grams: 1 } });
    expect(e.map((x) => x.type)).toEqual(['gift.sent', 'gift.received']);
    expect(e[1]!.clientExternalId).toBeUndefined();
  });

  it('Prices → tick or stale', () => {
    expect(map('dbo_Prices', { after: { Metal: 'gold', BuyPrice: 4800, SellPrice: 4750, IsStale: false } })[0]!.type).toBe('price.tick');
    expect(map('dbo_Prices', { after: { Metal: 'gold', IsStale: true, TradingPaused: true } })[0]).toMatchObject({ type: 'price.feed.stale', payload: { tradingPaused: true } });
  });

  it('Plan debits', () => {
    expect(map('dbo_PlanDebits', { after: { Id: 1, PlanId: 7, UserId: 'u1', Status: 'failed', AttemptNo: 2, Amount: 1000 } })[0]).toMatchObject({ type: 'plan.debit.failed', payload: { attemptNo: 2, planId: '7' } });
  });
});
