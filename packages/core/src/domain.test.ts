import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { isInHoldout } from './holdout';
import { computeStage, computeTier, crossedMilestones } from './lifecycle';
import { lintTemplate, lintText } from './lint';
import { JOURNEYS, stepFireAt } from './journeys';
import { approvalRoute, offerEconomics, offerReadiness } from './offers';
import { firstBusinessDayOfMonth, isBusinessDay, dayKey } from './time';
import { matchesSegment, segmentToWhere } from './segments';
import type { ClientFacts } from './types';
import { requiredTemplates } from './registry';

const cairo = (iso: string) => DateTime.fromISO(iso, { zone: 'Africa/Cairo' }).toJSDate();
const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: 'Africa/Cairo' }).toFormat('yyyy-MM-dd HH:mm');

describe('holdout', () => {
  it('is deterministic and close to the requested share', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `client-${i}`);
    const held = ids.filter((id) => isInHoldout(id, 'journey:activation', 10)).length;
    expect(held / ids.length).toBeGreaterThan(0.09);
    expect(held / ids.length).toBeLessThan(0.11);
    expect(isInHoldout('client-1', 'x', 10)).toBe(isInHoldout('client-1', 'x', 10));
    expect(isInHoldout('client-1', 'x', 0)).toBe(false);
  });
});

describe('lifecycle stages (§3.1) and tiers (§3.2)', () => {
  const now = cairo('2026-10-01T12:00');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const base = { kycStatus: 'approved', orderCount: 0, hasRecurringPlan: false, lastOrderAt: null, lastLoginAt: null, closedAt: null };
  it('maps facts to stages', () => {
    expect(computeStage({ ...base, kycStatus: 'submitted' }, now)).toBe('S1');
    expect(computeStage(base, now)).toBe('S2');
    expect(computeStage({ ...base, orderCount: 1, lastOrderAt: daysAgo(3) }, now)).toBe('S3');
    expect(computeStage({ ...base, orderCount: 3, lastOrderAt: daysAgo(3) }, now)).toBe('S4');
    expect(computeStage({ ...base, orderCount: 3, lastOrderAt: daysAgo(3), hasRecurringPlan: true }, now)).toBe('S5');
    expect(computeStage({ ...base, orderCount: 3, lastOrderAt: daysAgo(70), lastLoginAt: daysAgo(65) }, now)).toBe('S6');
    expect(computeStage({ ...base, orderCount: 3, lastOrderAt: daysAgo(70), lastLoginAt: daysAgo(5) }, now)).toBe('S4');
    expect(computeStage({ ...base, orderCount: 3, lastOrderAt: daysAgo(200) }, now)).toBe('S7');
    expect(computeStage({ ...base, closedAt: now }, now)).toBe('S8');
  });
  it('maps holding value to tiers', () => {
    expect(computeTier(10_000)).toBe('entry');
    expect(computeTier(25_000)).toBe('core');
    expect(computeTier(300_000)).toBe('premium');
    expect(computeTier(2_500_000)).toBe('private');
  });
  it('detects gram milestones crossed', () => {
    expect(crossedMilestones(0.5, 1.2)).toEqual([1]);
    expect(crossedMilestones(9, 55)).toEqual([10, 50]);
    expect(crossedMilestones(10, 11)).toEqual([]);
  });
});

describe('compliance lint (§9.1, Appendix A)', () => {
  it('flags prohibited English and Arabic language', () => {
    expect(lintText('A guaranteed return, risk-free').length).toBeGreaterThanOrEqual(2);
    expect(lintText('Buy now, pay later in easy instalments').some((i) => i.rule === 'prohibited_language')).toBe(true);
    expect(lintText('اشترِ الذهب بالتقسيط').length).toBeGreaterThan(0);
    expect(lintText('عائد مضمون').length).toBeGreaterThan(0);
  });
  it('does not flag ordinary words that contain prohibited stems', () => {
    expect(lintText('{{grams grams}} g credited to your holding')).toEqual([]);
  });
  it('enforces push length and deep link', () => {
    const long = lintTemplate({ channel: 'push', language: 'en', body: 'x'.repeat(95), deepLink: '/x' });
    expect(long.some((i) => i.rule === 'push_length')).toBe(true);
    const noLink = lintTemplate({ channel: 'push', language: 'en', body: 'Short', deepLink: null });
    expect(noLink.some((i) => i.rule === 'push_deeplink')).toBe(true);
  });
});

describe('journeys (§7)', () => {
  it('times steps from enrolment in Cairo time', () => {
    const act = JOURNEYS.find((j) => j.key === 'activation')!;
    const enrolled = cairo('2026-10-01T15:20');
    const times = Object.fromEntries(act.steps.map((s) => [s.id, fmt(stepFireAt(enrolled, s))]));
    expect(times.T1).toBe('2026-10-01 17:20');
    expect(times.T2).toBe('2026-10-02 12:00');
    expect(times.T3).toBe('2026-10-03 19:00');
    expect(times.T7b).toBe('2026-10-31 11:00');
  });
  it('fires a day-0 step immediately when its time already passed', () => {
    const ar = JOURNEYS.find((j) => j.key === 'at_risk')!;
    const enrolled = cairo('2026-10-01T15:00');
    expect(stepFireAt(enrolled, ar.steps[0]!).getTime()).toBe(enrolled.getTime());
  });
  it('every journey has a 10% holdout and a goal', () => {
    for (const j of JOURNEYS) {
      expect(j.holdoutPct).toBeGreaterThanOrEqual(10);
      expect(j.goalEvent).toBeTruthy();
    }
  });
  it('activation exits after two rejections (manual queue)', () => {
    const act = JOURNEYS.find((j) => j.key === 'activation')!;
    expect(act.exitWhen!({ kycStatus: 'rejected', kycRejectCount: 2 } as ClientFacts)).toBe('rejected_twice_manual_queue');
  });
});

describe('offers (§8)', () => {
  it('computes economics net of holdout', () => {
    expect(offerEconomics({ costPerRedemption: 100, expectedRedemption: 0.2, eligibleCount: 1000, holdoutPct: 10 })).toEqual({ treated: 900, worstCaseCost: 90_000, expectedCost: 18_000 });
  });
  it('routes approvals by cost and mechanic', () => {
    expect(approvalRoute(50_000, false, false).requiredRoles).toEqual(['head_of_marketing', 'compliance']);
    expect(approvalRoute(200_000, false, false).requiredRoles).toEqual(['head_of_marketing', 'cfo', 'compliance']);
    expect(approvalRoute(600_000, false, false).tier).toBe('above_500k');
    expect(approvalRoute(10_000, true, false).tier).toBe('above_500k');
    expect(approvalRoute(10_000, false, true).requiredRoles).toContain('treasury');
  });
  it('blocks go-live until every rule is satisfied', () => {
    const problems = offerReadiness({ holdoutPct: 5, metalDenominated: true, approvedRoles: [], requiredRoles: ['ceo'] });
    expect(problems.join(' ')).toMatch(/Holdout/);
    expect(problems.join(' ')).toMatch(/hedge/i);
    expect(problems.join(' ')).toMatch(/Missing approvals: ceo/);
  });
});

describe('calendar', () => {
  it('treats Friday and Saturday as the weekend', () => {
    expect(isBusinessDay(cairo('2026-10-02T12:00'))).toBe(false); // Fri
    expect(isBusinessDay(cairo('2026-10-04T12:00'))).toBe(true); // Sun
  });
  it('finds the first business day of the month', () => {
    expect(dayKey(firstBusinessDayOfMonth(cairo('2026-08-15T12:00')))).toBe('2026-08-02'); // Aug 1 2026 is a Saturday
  });
});

describe('segments', () => {
  const facts: ClientFacts = {
    id: '1', externalId: 'u1', language: 'ar', lifecycleStage: 'S3', valueTier: 'core', tags: ['former_instalment', 'gold_only'], kycStatus: 'approved', kycRejectCount: 0,
    orderCount: 1, avgOrderAmount: 1000, goldGrams: 1, silverGrams: 0, holdingValueEgp: 5000, hasRecurringPlan: false, registeredAt: new Date('2026-01-01'), source: 'organic',
  };
  it('matches in memory', () => {
    expect(matchesSegment(facts, { stages: ['S3'], tagsAny: ['former_instalment'] })).toBe(true);
    expect(matchesSegment(facts, { tagsNone: ['former_instalment'] })).toBe(false);
    expect(matchesSegment(facts, { holdsMetal: 'silver' })).toBe(false);
  });
  it('always excludes closed accounts in the DB filter', () => {
    expect(JSON.stringify(segmentToWhere({}))).toContain('closedAt');
  });
});

describe('template registry', () => {
  it('lists every template the platform sends', () => {
    const req = requiredTemplates();
    expect(req.get('order_executed')).toEqual(new Set(['push', 'email']));
    expect(req.get('act_t2')).toEqual(new Set(['sms']));
    expect(req.has('daily_price')).toBe(true);
  });
});
