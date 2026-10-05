import { DateTime } from 'luxon';
import { config } from './config';

export const ZONE = 'Africa/Cairo';

export function cairo(date: Date = new Date()): DateTime {
  return DateTime.fromJSDate(date, { zone: ZONE });
}

/** YYYY-MM-DD in Cairo. */
export function dayKey(date: Date = new Date()): string {
  return cairo(date).toFormat('yyyy-MM-dd');
}

export function parseHHmm(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
  return { hour: h ?? 0, minute: m ?? 0 };
}

/** The Cairo-local time `hhmm` on the day `dayOffset` days after `base`. */
export function atCairo(base: Date, dayOffset: number, hhmm: string): Date {
  const { hour, minute } = parseHHmm(hhmm);
  return cairo(base).plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

// ── Quiet hours (plan §6.2): 22:00–09:00 Cairo ──────────────────────────────
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 9;

export function isQuietHours(date: Date): boolean {
  const h = cairo(date).hour;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** Next 09:00 Cairo at or after `date` (used to release quiet-hour queues). */
export function quietHoursRelease(date: Date): Date {
  const c = cairo(date);
  const today9 = c.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  return (c.hour >= QUIET_START_HOUR ? today9.plus({ days: 1 }) : today9).toJSDate();
}

// ── Client windows (price alerts) ───────────────────────────────────────────
function minutesOfDay(c: DateTime): number {
  return c.hour * 60 + c.minute;
}

export function isWithinWindow(date: Date, start: string, end: string): boolean {
  const m = minutesOfDay(cairo(date));
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  const sm = s.hour * 60 + s.minute;
  const em = e.hour * 60 + e.minute;
  return sm <= em ? m >= sm && m < em : m >= sm || m < em;
}

/** Next moment the window opens (or `date` itself if inside). */
export function nextWindowOpen(date: Date, start: string, end: string): Date {
  if (isWithinWindow(date, start, end)) return date;
  const s = parseHHmm(start);
  const c = cairo(date);
  let open = c.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });
  if (open <= c) open = open.plus({ days: 1 });
  return open.toJSDate();
}

// ── Calendar windows used by frequency caps (Egypt week starts Sunday) ──────
export function startOfCairoDay(date: Date): Date {
  return cairo(date).startOf('day').toJSDate();
}

export function startOfCairoWeek(date: Date): Date {
  const c = cairo(date).startOf('day');
  const daysSinceSunday = c.weekday % 7; // luxon: Mon=1..Sun=7
  return c.minus({ days: daysSinceSunday }).toJSDate();
}

export function startOfCairoMonth(date: Date): Date {
  return cairo(date).startOf('month').toJSDate();
}

export function startOfCairoQuarter(date: Date): Date {
  return cairo(date).startOf('quarter').toJSDate();
}

export type CapWindow = 'day' | 'week' | 'month' | 'quarter';

export function windowStart(window: CapWindow, date: Date): Date {
  switch (window) {
    case 'day':
      return startOfCairoDay(date);
    case 'week':
      return startOfCairoWeek(date);
    case 'month':
      return startOfCairoMonth(date);
    case 'quarter':
      return startOfCairoQuarter(date);
  }
}

/** 09:00 on the first day of the next window — when a capped message becomes eligible again. */
export function nextWindowRelease(window: CapWindow, date: Date): Date {
  const start = cairo(windowStart(window, date));
  const next =
    window === 'day'
      ? start.plus({ days: 1 })
      : window === 'week'
        ? start.plus({ weeks: 1 })
        : window === 'month'
          ? start.plus({ months: 1 })
          : start.plus({ months: 3 });
  return next.set({ hour: QUIET_END_HOUR }).toJSDate();
}

// ── Business days: Egypt weekend is Friday + Saturday ───────────────────────
function holidays(): Set<string> {
  return new Set(
    config()
      .PUBLIC_HOLIDAYS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isBusinessDay(date: Date): boolean {
  const c = cairo(date);
  if (c.weekday === 5 || c.weekday === 6) return false;
  return !holidays().has(c.toFormat('yyyy-MM-dd'));
}

export function firstBusinessDayOfMonth(date: Date): Date {
  let c = cairo(date).startOf('month').set({ hour: 12 });
  while (!isBusinessDay(c.toJSDate())) c = c.plus({ days: 1 });
  return c.startOf('day').toJSDate();
}

export function isFirstBusinessDayOfMonth(date: Date): boolean {
  return dayKey(firstBusinessDayOfMonth(date)) === dayKey(date);
}

export function addBusinessDays(date: Date, days: number): Date {
  let c = cairo(date);
  let added = 0;
  while (added < days) {
    c = c.plus({ days: 1 });
    if (isBusinessDay(c.toJSDate())) added++;
  }
  return c.toJSDate();
}

// ── Outbound calls (plan §6.1): 10:00–20:00, Sunday to Thursday ─────────────
export function isCallWindow(date: Date): boolean {
  const c = cairo(date);
  return c.weekday !== 5 && c.weekday !== 6 && c.hour >= 10 && c.hour < 20;
}

export function nextCallWindow(date: Date): Date {
  let c = cairo(date);
  if (isCallWindow(c.toJSDate())) return date;
  if (c.hour >= 20) c = c.plus({ days: 1 });
  c = c.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (c.weekday === 5 || c.weekday === 6) c = c.plus({ days: 1 });
  return c.toJSDate();
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
