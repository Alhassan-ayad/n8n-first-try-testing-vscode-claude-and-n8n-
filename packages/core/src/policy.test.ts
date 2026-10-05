import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy, type PolicyClient, type PolicyCounts, type PolicyMessage } from './policy';

const cairo = (iso: string) => DateTime.fromISO(iso, { zone: 'Africa/Cairo' }).toJSDate();
const atCairo = (d: Date) => DateTime.fromJSDate(d, { zone: 'Africa/Cairo' }).toFormat('yyyy-MM-dd HH:mm');

const client = (over: Partial<PolicyClient> = {}): PolicyClient => ({
  consents: new Set(['push:promotions', 'push:lifecycle', 'email:promotions', 'sms:promotions', 'push:price_alerts']),
  suppressedMarketing: false,
  suppressedAll: false,
  hasDestination: true,
  pushReachable: true,
  ...over,
});
const zero: PolicyCounts = { day: 0, week: 0, month: 0, quarter: 0 };
const promo = (over: Partial<PolicyMessage> = {}): PolicyMessage => ({
  channel: 'push',
  kind: 'promotion',
  topic: 'promotions',
  category: 'D',
  capped: true,
  ...over,
});
const tx: PolicyMessage = { channel: 'push', kind: 'transactional', topic: 'transactional', category: 'A', capped: false };

// Wednesday 1 Oct 2026
const NOON = cairo('2026-10-01T12:00');
const NIGHT = cairo('2026-10-01T23:30');
const EARLY = cairo('2026-10-02T06:00');

describe('contact policy (plan §6)', () => {
  it('sends Category A even at night, over caps, without consent and when marketing-suppressed', () => {
    const d = evaluatePolicy(tx, client({ consents: new Set(), suppressedMarketing: true }), { day: 9, week: 9, month: 9, quarter: 9 }, NIGHT);
    expect(d.action).toBe('send');
  });

  it('blocks everything, including Category A, for an invalid destination', () => {
    expect(evaluatePolicy(tx, client({ suppressedAll: true }), zero, NOON)).toEqual({ action: 'suppress', reason: 'invalid_destination' });
    expect(evaluatePolicy(tx, client({ hasDestination: false }), zero, NOON)).toEqual({ action: 'suppress', reason: 'no_destination' });
  });

  it('treats silence as no consent', () => {
    expect(evaluatePolicy(promo(), client({ consents: new Set() }), zero, NOON)).toEqual({ action: 'suppress', reason: 'no_consent' });
  });

  it('applies the single suppression list to marketing', () => {
    expect(evaluatePolicy(promo(), client({ suppressedMarketing: true }), zero, NOON)).toEqual({ action: 'suppress', reason: 'suppressed' });
  });

  it('defers marketing during quiet hours to 09:00 Cairo', () => {
    const late = evaluatePolicy(promo(), client(), zero, NIGHT);
    expect(late.action).toBe('defer');
    if (late.action === 'defer') expect(atCairo(late.until)).toBe('2026-10-02 09:00');
    const early = evaluatePolicy(promo(), client(), zero, EARLY);
    if (early.action === 'defer') expect(atCairo(early.until)).toBe('2026-10-02 09:00');
    expect(early.action).toBe('defer');
  });

  it('caps promotional push at 1 per day and holds (not drops) the next one', () => {
    const d = evaluatePolicy(promo(), client(), { ...zero, day: 1 }, NOON);
    expect(d.action).toBe('hold');
    if (d.action === 'hold') {
      expect(d.reason).toBe('cap_push_day');
      expect(atCairo(d.until)).toBe('2026-10-02 09:00');
    }
  });

  it('caps push at 4 per week, email at 2 per week, SMS at 4 per month', () => {
    expect(evaluatePolicy(promo(), client(), { ...zero, week: 4 }, NOON)).toMatchObject({ action: 'hold', reason: 'cap_push_week' });
    expect(evaluatePolicy(promo({ channel: 'email' }), client(), { ...zero, week: 2 }, NOON)).toMatchObject({ action: 'hold', reason: 'cap_email_week' });
    expect(evaluatePolicy(promo({ channel: 'sms' }), client(), { ...zero, month: 4 }, NOON)).toMatchObject({ action: 'hold', reason: 'cap_sms_month' });
  });

  it('weekly cap releases at the start of the Egyptian week (Sunday 09:00)', () => {
    const d = evaluatePolicy(promo(), client(), { ...zero, week: 4 }, NOON);
    if (d.action === 'hold') expect(atCairo(d.until)).toBe('2026-10-04 09:00'); // Sunday
  });

  it('never sends a marketing SMS when the same content goes by push to a reachable client', () => {
    const d = evaluatePolicy(promo({ channel: 'sms', pushTwin: true }), client(), zero, NOON);
    expect(d).toEqual({ action: 'suppress', reason: 'push_equivalent_available' });
    // …but does when push can't reach them
    expect(evaluatePolicy(promo({ channel: 'sms', pushTwin: true }), client({ pushReachable: false }), zero, NOON).action).toBe('send');
  });

  it('client price alerts follow the client window, not quiet hours, and are not capped', () => {
    const alert: PolicyMessage = { channel: 'push', kind: 'client_alert', topic: 'price_alerts', category: 'B', capped: false };
    expect(evaluatePolicy(alert, client(), { ...zero, day: 5 }, cairo('2026-10-01T22:30')).action).toBe('send'); // inside 08:00–23:00
    const d = evaluatePolicy(alert, client(), zero, cairo('2026-10-01T23:30'));
    expect(d.action).toBe('defer');
    if (d.action === 'defer') expect(atCairo(d.until)).toBe('2026-10-02 08:00');
    const custom = evaluatePolicy(alert, client({ alertWindow: { start: '10:00', end: '18:00' } }), zero, cairo('2026-10-01T09:00'));
    if (custom.action === 'defer') expect(atCairo(custom.until)).toBe('2026-10-01 10:00');
  });

  it('allows only one campaign slot (11:00 or 19:00) per client per day', () => {
    const d = evaluatePolicy(promo({ campaignSlot: '19:00' }), client(), { ...zero, campaignSlotsToday: ['11:00'] }, cairo('2026-10-01T19:00'));
    expect(d.action).toBe('hold');
    if (d.action === 'hold') expect(atCairo(d.until)).toBe('2026-10-02 19:00');
    expect(evaluatePolicy(promo({ campaignSlot: '11:00' }), client(), { ...zero, campaignSlotsToday: ['11:00'] }, NOON).action).toBe('send');
  });

  it('requires WhatsApp opt-in even for service messages', () => {
    const wa: PolicyMessage = { ...tx, channel: 'whatsapp' };
    expect(evaluatePolicy(wa, client(), zero, NOON)).toEqual({ action: 'suppress', reason: 'whatsapp_not_opted_in' });
    expect(evaluatePolicy(wa, client({ consents: new Set(['whatsapp:lifecycle']) }), zero, NOON).action).toBe('send');
  });

  it('outbound calls only 10:00–20:00 Sunday to Thursday', () => {
    const call: PolicyMessage = { channel: 'call', kind: 'lifecycle', topic: 'lifecycle', category: 'C', capped: true };
    const c = client({ consents: new Set(['call:lifecycle']) });
    const fri = evaluatePolicy(call, c, zero, cairo('2026-10-02T12:00')); // Friday
    expect(fri.action).toBe('defer');
    if (fri.action === 'defer') expect(atCairo(fri.until)).toBe('2026-10-04 10:00'); // Sunday
  });
});
