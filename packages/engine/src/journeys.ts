// Journey engine: enrol, exit, convert, and execute due steps. Steps are
// persisted (JourneyStepRun) and executed by a DB-polling tick, so they survive
// restarts and Redis loss. Holdout enrolments are tracked exactly like treated
// ones but their steps are skipped — that's what makes uplift measurable.

import {
  isInHoldout,
  JOURNEY_BY_KEY,
  JOURNEYS,
  type JourneyDef,
  nextCallWindow,
  type PlatformEvent,
  startOfCairoQuarter,
  stepFireAt,
} from '@cep/core';
import { type Client, prisma, splitCsv } from '@cep/db';
import { setTags, toFacts } from './clients';
import { log } from './infra';
import { createMulti } from './messages';

export async function journeyEnabled(key: string): Promise<boolean> {
  const row = await prisma.journey.findUnique({ where: { key } });
  return row ? row.enabled : true;
}

export async function enrol(
  def: JourneyDef,
  client: Client,
  opts: { context?: Record<string, unknown>; now?: Date; actor?: string } = {},
): Promise<string | null> {
  const now = opts.now ?? new Date();
  if (client.closedAt) return null;
  if (!(await journeyEnabled(def.key))) return null;

  const active = await prisma.journeyEnrollment.findFirst({ where: { journeyKey: def.key, clientId: client.id, status: 'active' } });
  if (active) return null;

  const last = await prisma.journeyEnrollment.findFirst({
    where: { journeyKey: def.key, clientId: client.id },
    orderBy: { enteredAt: 'desc' },
  });
  if (last) {
    if (def.reentryCooldownDays === null) return null;
    const since = (now.getTime() - (last.exitedAt ?? last.enteredAt).getTime()) / 86_400_000;
    if (since < def.reentryCooldownDays) return null;
  }

  const scope = `journey:${def.key}`;
  const holdout = isInHoldout(client.id, scope, def.holdoutPct);
  const enrollment = await prisma.journeyEnrollment.create({
    data: {
      journeyKey: def.key,
      clientId: client.id,
      holdout,
      enteredAt: now,
      context: opts.context ? JSON.stringify(opts.context) : null,
    },
  });
  await prisma.holdoutAssignment.upsert({
    where: { scope_clientId: { scope, clientId: client.id } },
    create: { scope, clientId: client.id, holdout },
    update: { holdout, convertedAt: null, assignedAt: now },
  });
  await prisma.journeyStepRun.createMany({
    data: def.steps.map((s) => ({ enrollmentId: enrollment.id, stepId: s.id, fireAt: stepFireAt(now, s) })),
  });
  log.info({ journey: def.key, clientId: client.id, holdout }, 'enrolled');
  return enrollment.id;
}

export async function exitEnrollment(enrollmentId: string, reason: string, status: 'exited' | 'completed' = 'exited') {
  await prisma.journeyEnrollment.update({
    where: { id: enrollmentId },
    data: { status, exitedAt: new Date(), exitReason: reason },
  });
  await prisma.journeyStepRun.updateMany({
    where: { enrollmentId, status: 'scheduled' },
    data: { status: 'cancelled', result: reason },
  });
}

/** React to a client event: goals → conversions, exit rules, then new entries. */
export async function handleJourneyEvent(client: Client, e: PlatformEvent): Promise<void> {
  const facts = toFacts(client);
  const active = await prisma.journeyEnrollment.findMany({ where: { clientId: client.id, status: 'active' } });

  for (const en of active) {
    const def = JOURNEY_BY_KEY.get(en.journeyKey);
    if (!def) continue;
    if (e.type === def.goalEvent && (def.goalFilter?.(facts, e) ?? true) && e.occurredAt >= en.enteredAt) {
      await prisma.journeyEnrollment.update({ where: { id: en.id }, data: { convertedAt: e.occurredAt } });
      await prisma.holdoutAssignment.updateMany({
        where: { scope: `journey:${def.key}`, clientId: client.id, convertedAt: null },
        data: { convertedAt: e.occurredAt },
      });
      await exitEnrollment(en.id, 'goal', 'completed');
      continue;
    }
    if (def.exitOn.includes(e.type)) {
      await exitEnrollment(en.id, `event:${e.type}`);
      continue;
    }
    const reason = def.exitWhen?.(facts);
    if (reason) await exitEnrollment(en.id, reason);
  }

  for (const def of JOURNEYS) {
    if (!def.entry.events?.includes(e.type)) continue;
    if (def.entry.filter && !def.entry.filter(facts, e)) continue;
    await enrol(def, client, { context: { event: e.type, eventId: e.id, ...pickContext(e) }, now: enrolmentTime(e.occurredAt) });
  }
}

/** Steps are timed from the event, unless it is old (replays, backfills) — then from now. */
function enrolmentTime(occurredAt: Date): Date {
  const now = Date.now();
  const t = occurredAt.getTime();
  return t <= now && now - t < 6 * 3_600_000 ? occurredAt : new Date(now);
}

export function categoryForKind(kind: string): 'C' | 'D' | 'E' | 'F' {
  if (kind === 'promotion') return 'D';
  if (kind === 'education') return 'E';
  if (kind === 'feedback') return 'F';
  return 'C';
}

function pickContext(e: PlatformEvent): Record<string, unknown> {
  const keep = ['orderId', 'metal', 'grams', 'amount', 'side'];
  return Object.fromEntries(Object.entries(e.payload).filter(([k]) => keep.includes(k)));
}

/** Execute due steps. Called every minute by the worker. */
export async function journeyTick(now = new Date(), limit = 500): Promise<number> {
  const due = await prisma.journeyStepRun.findMany({
    where: { status: 'scheduled', fireAt: { lte: now } },
    orderBy: { fireAt: 'asc' },
    take: limit,
    include: { enrollment: { include: { client: true } } },
  });

  for (const run of due) {
    try {
      await executeStep(run.id, run.stepId, run.enrollment, run.enrollment.client, now);
    } catch (err) {
      log.error({ err: (err as Error).message, runId: run.id }, 'journey step failed');
      await prisma.journeyStepRun.update({
        where: { id: run.id },
        data: { status: 'failed', result: (err as Error).message.slice(0, 2000), executedAt: now },
      });
    }
    await maybeComplete(run.enrollmentId);
  }
  return due.length;
}

async function executeStep(
  runId: string,
  stepId: string,
  en: { id: string; journeyKey: string; status: string; holdout: boolean; context: string | null },
  client: Client,
  now: Date,
) {
  const finish = (status: string, result: string) =>
    prisma.journeyStepRun.update({ where: { id: runId }, data: { status, result, executedAt: now } });

  const def = JOURNEY_BY_KEY.get(en.journeyKey);
  const step = def?.steps.find((s) => s.id === stepId);
  if (!def || !step) return finish('cancelled', 'unknown_step');
  if (en.status !== 'active') return finish('cancelled', `enrollment_${en.status}`);
  if (!(await journeyEnabled(def.key))) return finish('skipped', 'journey_disabled');

  const facts = toFacts(client);
  const exit = def.exitWhen?.(facts);
  if (exit || client.closedAt) {
    await exitEnrollment(en.id, exit || 'closed');
    return;
  }
  if (en.holdout) return finish('skipped', 'holdout');
  if (step.when && !step.when(facts)) return finish('skipped', 'condition_false');

  const ctx = en.context ? (JSON.parse(en.context) as Record<string, unknown>) : {};
  const results: string[] = [];
  for (const action of step.actions) {
    if (action.type === 'message') {
      const msgs = await createMulti({
        client,
        channels: action.channels.filter((c): c is Exclude<typeof c, 'call'> => c !== 'call'),
        templateKey: action.template,
        kind: action.kind ?? def.defaultKind,
        topic: action.topic ?? def.defaultTopic,
        category: categoryForKind(action.kind ?? def.defaultKind),
        vars: { ...ctx, journey: def.key, step: step.id },
        enrollmentId: en.id,
        stepId: step.id,
        dedupeBase: `j:${en.id}:${step.id}:${action.template}`,
        inbox: action.inbox,
      });
      results.push(`${action.template}:${msgs.length}`);
    } else if (action.type === 'call') {
      results.push(await createCallTask(client, action.reason, action.priority ?? 5, def.key, now));
    } else if (action.type === 'tag') {
      await setTags(client.id, action.add, action.remove);
      results.push('tagged');
    }
  }
  return finish('done', results.join(', '));
}

/** Outbound call cap: 2 per quarter unless the client asked (plan §6.3). */
export async function createCallTask(client: Client, reason: string, priority: number, journeyKey: string | null, now = new Date()) {
  const exempt = ['complaint_recovery', 'callback_requested', 'manual_kyc', 'compliance'];
  if (!exempt.includes(reason)) {
    const n = await prisma.callTask.count({
      where: { clientId: client.id, createdAt: { gte: startOfCairoQuarter(now) }, reason: { notIn: exempt } },
    });
    if (n >= 2) return 'call:cap_reached';
    const dnc = await prisma.suppression.findFirst({ where: { channel: { in: ['call', 'all'] }, value: { in: [client.id, client.phone ?? '-'] } } });
    if (dnc) return 'call:suppressed';
  }
  await prisma.callTask.create({
    data: { clientId: client.id, reason, priority, journeyKey, dueAt: nextCallWindow(now) },
  });
  return `call:${reason}`;
}

async function maybeComplete(enrollmentId: string) {
  const remaining = await prisma.journeyStepRun.count({ where: { enrollmentId, status: 'scheduled' } });
  if (remaining > 0) return;
  const en = await prisma.journeyEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!en || en.status !== 'active') return;
  await prisma.journeyEnrollment.update({ where: { id: en.id }, data: { status: 'completed', exitedAt: new Date(), exitReason: 'all_steps_done' } });
  const def = JOURNEY_BY_KEY.get(en.journeyKey);
  if (def?.onComplete?.addTags?.length && !en.holdout) await setTags(en.clientId, def.onComplete.addTags);
}

/** Admin / engine entry for manual journeys and segment enrolment. */
export async function enrolByKey(key: string, client: Client, context?: Record<string, unknown>) {
  const def = JOURNEY_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown journey ${key}`);
  if (def.entry.filter && !def.entry.filter(toFacts(client))) return null;
  return enrol(def, client, { context });
}

export async function journeyStats() {
  const rows = await prisma.journeyEnrollment.groupBy({
    by: ['journeyKey', 'holdout', 'status'],
    _count: { _all: true },
  });
  const converted = await prisma.journeyEnrollment.groupBy({
    by: ['journeyKey', 'holdout'],
    where: { convertedAt: { not: null } },
    _count: { _all: true },
  });
  const flags = await prisma.journey.findMany();
  return JOURNEYS.map((j) => {
    const mine = rows.filter((r) => r.journeyKey === j.key);
    const total = (h: boolean) => mine.filter((r) => r.holdout === h).reduce((a, r) => a + r._count._all, 0);
    const active = mine.filter((r) => r.status === 'active').reduce((a, r) => a + r._count._all, 0);
    const conv = (h: boolean) => converted.find((c) => c.journeyKey === j.key && c.holdout === h)?._count._all ?? 0;
    const tT = total(false);
    const tH = total(true);
    const rT = tT ? conv(false) / tT : 0;
    const rH = tH ? conv(true) / tH : 0;
    return {
      key: j.key,
      name: j.name,
      objective: j.objective,
      owner: j.owner,
      description: j.description,
      enabled: flags.find((f) => f.key === j.key)?.enabled ?? true,
      holdoutPct: j.holdoutPct,
      steps: j.steps.map((s) => ({
        id: s.id,
        when: s.afterHours !== undefined ? `+${s.afterHours}h` : `D${s.day} ${s.at ?? ''}`.trim(),
        actions: s.actions.map((a) => (a.type === 'message' ? `${a.channels.join('+')}: ${a.template}` : a.type === 'call' ? `call: ${a.reason}` : 'tag')),
        note: s.note,
        conditional: Boolean(s.when),
      })),
      enrolled: tT + tH,
      active,
      treated: tT,
      holdout: tH,
      convertedTreated: conv(false),
      convertedHoldout: conv(true),
      conversionTreated: rT,
      conversionHoldout: rH,
      uplift: rT - rH,
    };
  });
}

/** Nightly scans that enrol by state rather than by event. */
export async function scanEntries(now = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const enrolMany = async (key: string, clients: Client[]) => {
    const def = JOURNEY_BY_KEY.get(key)!;
    let n = 0;
    for (const c of clients) if (await enrol(def, c, { context: { scan: true }, now })) n++;
    out[key] = n;
  };

  await enrolMany('at_risk', await prisma.client.findMany({ where: { lifecycleStage: 'S6', closedAt: null } }));
  const dormant = await prisma.client.findMany({ where: { lifecycleStage: 'S7', closedAt: null } });
  await enrolMany(
    'winback',
    dormant.filter((c) => !splitCsv(c.tags).includes('quarterly_only')),
  );
  const former = await prisma.client.findMany({ where: { closedAt: null, tags: { contains: 'former_instalment' } } });
  await enrolMany('former_instalment', former.filter((c) => splitCsv(c.tags).includes('former_instalment')));

  // Registered but never activated and not yet in the activation journey (e.g. imported base).
  const neverActivated = await prisma.client.findMany({
    where: { kycStatus: { not: 'approved' }, closedAt: null, enrollments: { none: { journeyKey: 'activation' } } },
    take: 5000,
  });
  await enrolMany(
    'activation',
    neverActivated.filter((c) => !splitCsv(c.tags).includes('manual_kyc_queue') && c.kycRejectCount < 2),
  );
  return out;
}

