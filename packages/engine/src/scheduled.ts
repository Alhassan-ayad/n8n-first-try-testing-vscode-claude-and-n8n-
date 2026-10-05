// Scheduled communications (plan §5, §6.1, §6.5). Each job is idempotent per
// day via DailyMarker, so a restart or double trigger never double-sends.

import { addBusinessDays, cairo, computeTier, config, dayKey, isFirstBusinessDayOfMonth, JOURNEY_BY_KEY } from '@cep/core';
import { getAllHoldings, getDebitsDueOn, getRecentBuys } from '@cep/cdc';
import { prisma, splitCsv } from '@cep/db';
import { startBroadcast } from './broadcast';
import { latestPrice, recomputeStage, setTags } from './clients';
import { ingestEvents } from './events';
import { bumpDailyMarker, log } from './infra';
import { enrol, scanEntries } from './journeys';
import { createMessage, createMulti } from './messages';
import { buildStatementData, renderStatementPdf } from './statements';

/** 12:00 — reminder two days before each recurring debit (plan §5.1, §7.3). */
export async function debitReminders(now = new Date()): Promise<number> {
  const day = dayKey(now);
  if (!(await bumpDailyMarker('debit_reminders', day))) return 0;
  const target = cairo(now).plus({ days: 2 }).toFormat('yyyy-MM-dd');
  let debits;
  try {
    debits = await getDebitsDueOn(target);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'debit reminder source query failed');
    return 0;
  }
  await ingestEvents(
    debits.map((d) => ({
      id: `debit_upcoming:${d.PlanId}:${target}`,
      type: 'plan.debit.upcoming',
      clientExternalId: d.UserId,
      payload: {
        planId: d.PlanId,
        amount: Number(d.Amount),
        metal: d.Metal,
        debitDate: target,
        cashBalance: d.CashBalance === null ? null : Number(d.CashBalance),
        topUpNeeded: Math.max(0, Number(d.Amount) - Number(d.CashBalance ?? 0)),
      },
    })),
    'scheduler',
  );
  return debits.length;
}

/** 1st business day 09:00 — monthly holdings and cash statement. */
export async function monthlyStatements(now = new Date()): Promise<number> {
  if (!isFirstBusinessDayOfMonth(now)) return 0;
  const day = dayKey(now);
  if (!(await bumpDailyMarker('monthly_statements', day))) return 0;
  const monthStart = cairo(now).minus({ months: 1 }).startOf('month').toJSDate();
  const monthEnd = cairo(now).startOf('month').toJSDate();
  const period = cairo(monthStart).toFormat('yyyy-MM');

  let cursor: string | undefined;
  let n = 0;
  for (;;) {
    const page = await prisma.client.findMany({
      where: { closedAt: null, kycStatus: 'approved', email: { not: null } },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    for (const client of page) {
      try {
        const data = await buildStatementData(client, monthStart, monthEnd);
        if (data.gold + data.silver + data.cash === 0 && !data.orders.length) continue;
        const pdf = await renderStatementPdf(data);
        await createMessage({
          client,
          channel: 'email',
          templateKey: 'monthly_statement',
          kind: 'transactional',
          topic: 'transactional',
          category: 'A',
          vars: { period: data.periodLabel, gold: data.gold, silver: data.silver, cash: data.cash },
          attachments: [{ filename: `mngm-statement-${period}.pdf`, contentBase64: pdf.toString('base64'), type: 'application/pdf' }],
          inbox: true,
          dedupeKey: `statement:${period}:${client.id}`,
        });
        n++;
      } catch (err) {
        log.error({ err: (err as Error).message, clientId: client.id }, 'statement failed');
      }
    }
    cursor = page[page.length - 1]!.id;
  }
  log.info({ n, period }, 'monthly statements queued');
  return n;
}

/** Monthly recurring-plan statement: grams accumulated, average cost, value (plan §7.3). */
export async function planStatements(now = new Date()): Promise<number> {
  if (!isFirstBusinessDayOfMonth(now)) return 0;
  const day = dayKey(now);
  if (!(await bumpDailyMarker('plan_statements', day))) return 0;
  const period = cairo(now).minus({ months: 1 }).toFormat('yyyy-MM');
  await startBroadcast(
    { hasRecurringPlan: true },
    {
      templateKey: 'plan_statement',
      channels: ['push', 'inapp'],
      kind: 'transactional',
      topic: 'transactional',
      category: 'A',
      vars: { period },
      dedupePrefix: `plan_statement:${period}`,
      notBefore: cairo(now).set({ hour: 9, minute: 30 }).toJSDate().toISOString(),
    },
  );
  return 1;
}

/** 02:00 — refresh holdings & tiers, recompute stages, detect behaviour, run entry scans. */
export async function nightly(now = new Date()): Promise<Record<string, number>> {
  const day = dayKey(now);
  if (!(await bumpDailyMarker('nightly', day))) return {};
  const stats: Record<string, number> = {};

  // Holdings and value tiers from mngm core.
  try {
    const all = await getAllHoldings();
    const [gp, sp] = await Promise.all([latestPrice('gold'), latestPrice('silver')]);
    let updated = 0;
    for (const [externalId, h] of all) {
      const value = h.gold * (gp ?? 0) + h.silver * (sp ?? 0);
      const res = await prisma.client.updateMany({
        where: { externalId },
        data: {
          goldGrams: h.gold,
          silverGrams: h.silver,
          cashBalanceEgp: h.cash,
          holdingValueEgp: Math.round(value),
          valueTier: computeTier(value + h.cash),
        },
      });
      updated += res.count;
    }
    stats.holdingsUpdated = updated;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'nightly holdings refresh failed');
  }

  // Stages.
  let cursor: string | undefined;
  let changed = 0;
  for (;;) {
    const page = await prisma.client.findMany({
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    for (const c of page) {
      const after = await recomputeStage(c, now);
      if (after.lifecycleStage !== c.lifecycleStage) changed++;
    }
    cursor = page[page.length - 1]!.id;
  }
  stats.stageChanges = changed;

  // Behaviour tags: pay-day buyers (calendar-driven) and small regular buyers (accumulators).
  try {
    const buys = await getRecentBuys(120);
    const byUser = new Map<string, Array<{ amount: number; at: Date }>>();
    for (const b of buys) {
      const arr = byUser.get(b.UserId) ?? [];
      arr.push({ amount: Number(b.Amount), at: new Date(b.UpdatedAt) });
      byUser.set(b.UserId, arr);
    }
    let payday = 0;
    for (const [externalId, list] of byUser) {
      const paydayMonths = new Set(
        list.filter((o) => {
          const d = cairo(o.at).day;
          return d >= 25 || d <= 3;
        }).map((o) => cairo(o.at).toFormat('yyyy-MM')),
      );
      const client = await prisma.client.findUnique({ where: { externalId } });
      if (!client) continue;
      const add: string[] = [];
      if (paydayMonths.size >= 2) add.push('calendar_driven');
      if (list.length >= 4 && list.every((o) => o.amount <= 2000)) add.push('accumulator');
      const tags = splitCsv(client.tags);
      if (add.some((t) => !tags.includes(t))) await setTags(client.id, add);
      if (paydayMonths.size >= 2 && !client.hasRecurringPlan) {
        if (await enrol(JOURNEY_BY_KEY.get('recurring_xsell')!, client, { context: { trigger: 'payday_pattern' } })) payday++;
      }
    }
    stats.paydayXsell = payday;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'behaviour tagging failed');
  }

  Object.assign(stats, await scanEntries(now));
  await anniversaries(now);
  log.info(stats, 'nightly done');
  return stats;
}

/** Account anniversary with a year in review (plan §5.3). */
export async function anniversaries(now = new Date()): Promise<number> {
  const c = cairo(now);
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM [Client]
     WHERE closedAt IS NULL AND kycStatus = 'approved'
       AND MONTH(registeredAt) = ${c.month} AND DAY(registeredAt) = ${c.day} AND YEAR(registeredAt) < ${c.year}`;
  let n = 0;
  for (const { id } of candidates) {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) continue;
    const years = c.year - cairo(client.registeredAt).year;
    await createMulti({
      client,
      channels: ['email', 'push'],
      templateKey: 'anniversary',
      kind: 'lifecycle',
      topic: 'lifecycle',
      category: 'C',
      vars: { years, grams: client.goldGrams, holdingValue: client.holdingValueEgp },
      notBefore: c.set({ hour: 11, minute: 0 }).toJSDate(),
      dedupeBase: `anniversary:${client.id}:${c.year}`,
    });
    n++;
  }
  return n;
}

/** First Sunday of the quarter, 11:00 — NPS (plan §5.6). */
export async function quarterlyNps(now = new Date()): Promise<boolean> {
  const c = cairo(now);
  const quarterStart = c.startOf('quarter');
  if (c.diff(quarterStart, 'days').days >= 7 || c.weekday !== 7) return false;
  const q = `${c.year}-Q${c.quarter}`;
  if (!(await bumpDailyMarker(`nps:${q}`, q))) return false;
  await startBroadcast(
    { stages: ['S3', 'S4', 'S5', 'S6'] },
    { templateKey: 'nps_quarterly', channels: ['email'], kind: 'feedback', topic: 'feedback', category: 'F', dedupePrefix: `nps:${q}` },
  );
  return true;
}

/** Annual tax and zakat summary on the configured date (plan §5.1). */
export async function zakatSummary(now = new Date()): Promise<boolean> {
  const c = cairo(now);
  if (c.toFormat('MM-dd') !== config().ZAKAT_SUMMARY_DATE) return false;
  if (!(await bumpDailyMarker(`zakat:${c.year}`, String(c.year)))) return false;
  await startBroadcast(
    { stages: ['S3', 'S4', 'S5', 'S6', 'S7'], holdsMetal: 'any' },
    {
      templateKey: 'zakat_summary',
      channels: ['email', 'inapp'],
      kind: 'transactional',
      topic: 'transactional',
      category: 'A',
      vars: { year: c.year },
      dedupePrefix: `zakat:${c.year}`,
    },
  );
  return true;
}

/** Post-campaign review due within 10 working days — flag overdue offers (plan §8.2). */
export async function offerHousekeeping(now = new Date()): Promise<void> {
  const ended = await prisma.offer.findMany({ where: { status: 'live', endDate: { lte: now } } });
  for (const o of ended) {
    await prisma.offer.update({ where: { id: o.id }, data: { status: 'ended', reviewDueAt: addBusinessDays(o.endDate!, 10) } });
  }
  const started = await prisma.offer.findMany({ where: { status: 'approved', startDate: { lte: now } } });
  for (const o of started) await prisma.offer.update({ where: { id: o.id }, data: { status: 'live' } });
}
