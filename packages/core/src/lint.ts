// Compliance linter (plan §9.1 and Appendix A). Runs on template submission,
// approval and campaign release. Errors block approval; warnings are shown to
// the Compliance reviewer.

import { PUSH_MAX_CHARS } from './policy';
import type { Channel } from './types';

export interface LintIssue {
  level: 'error' | 'warning';
  rule: string;
  message: string;
  match?: string;
}

/** Appendix A prohibited list, plus §9.1 standing rules (instalments, credit, forecasts, guarantees). */
const PROHIBITED_EN: Array<[RegExp, string]> = [
  [/\bguarantee(d|s)?\b/i, 'No guarantees'],
  [/\brisk[-\s]?free\b/i, 'Nothing is risk-free'],
  [/\bbest investment\b/i, 'No "best investment" claims'],
  [/\bprices? (will|are going to|is going to) (rise|go up|increase|climb)\b/i, 'No price forecasts'],
  [/\bgold (will|can ?not|cannot|never) (rise|fall|go down|lose)\b/i, 'No forecasts / implying gold cannot fall'],
  [/\bdouble your money\b/i, 'No return promises'],
  [/\binstal(l)?ments?\b/i, 'No instalment language (FRA circular)'],
  [/\bpay later\b/i, 'No deferred payment language'],
  [/\bbuy now,? pay later\b/i, 'No deferred payment language'],
  [/\bcredit\b/i, 'No credit language'],
  [/\bfinanc(ing|e)\b/i, 'No consumer finance language'],
  [/\bdeferred payment\b/i, 'No deferred payment language'],
  [/\b(expected|guaranteed|fixed) (return|yield|profit)s?\b/i, 'No expected returns / fixed yield'],
  [/\byou should (buy|sell)\b/i, 'No investment advice'],
  [/\bwe recommend (buying|selling)\b/i, 'No investment advice'],
  [/\bcan'?t lose\b/i, 'No language implying gold cannot fall'],
];

const PROHIBITED_AR: Array<[RegExp, string]> = [
  [/مضمون|مضمونة|نضمن|ضمان/, 'No guarantees'],
  [/بدون مخاطر|خالي من المخاطر|بلا مخاطر/, 'Nothing is risk-free'],
  [/أفضل استثمار|افضل استثمار/, 'No "best investment" claims'],
  [/الأسعار (ستر|سوف تر)تفع|الاسعار (ستر|سوف تر)تفع|سيرتفع (سعر )?الذهب/, 'No price forecasts'],
  [/ضاعف (أموالك|فلوسك)|اضاعف/, 'No return promises'],
  [/تقسيط|أقساط|اقساط|قسط/, 'No instalment language (FRA circular)'],
  [/ادفع لاحق|اشتر الآن وادفع/, 'No deferred payment language'],
  [/ائتمان|قرض|تمويل/, 'No credit / finance language'],
  [/عائد (ثابت|مضمون|متوقع)/, 'No expected returns / fixed yield'],
  [/ننصحك (بالشراء|بالبيع)|يجب أن تشتري/, 'No investment advice'],
];

export interface LintInput {
  channel: Channel;
  language: 'ar' | 'en';
  subject?: string | null;
  title?: string | null;
  body: string;
  html?: string | null;
  deepLink?: string | null;
  category?: string;
}

/** Remove Handlebars expressions so variable names don't trigger rules. */
function stripVars(text: string): string {
  return text.replace(/\{\{\{?[^}]*\}?\}\}/g, ' ');
}

/** Approximate rendered length: each variable counts as 8 characters. */
export function estimatedLength(text: string): number {
  const vars = text.match(/\{\{\{?[^}]*\}?\}\}/g) ?? [];
  return stripVars(text).replace(/\s+/g, ' ').trim().length + vars.length * 8;
}

export function lintText(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const clean = stripVars(text);
  for (const [re, message] of [...PROHIBITED_EN, ...PROHIBITED_AR]) {
    const m = clean.match(re);
    if (m) issues.push({ level: 'error', rule: 'prohibited_language', message, match: m[0] });
  }
  if (/\bprice\b|سعر/i.test(clean) && /\b(will|forecast|predict)\b|توقع/i.test(clean)) {
    issues.push({ level: 'warning', rule: 'forecast_risk', message: 'Check this does not read as a price forecast' });
  }
  return issues;
}

export function lintTemplate(t: LintInput): LintIssue[] {
  const all = [t.subject, t.title, t.body, t.html].filter(Boolean).join('\n');
  const issues = lintText(all);

  if (t.channel === 'push') {
    const len = estimatedLength(t.body);
    if (len > PUSH_MAX_CHARS) {
      issues.push({ level: 'error', rule: 'push_length', message: `Push must be under ${PUSH_MAX_CHARS} characters (≈${len})` });
    }
    if (!t.deepLink) issues.push({ level: 'error', rule: 'push_deeplink', message: 'Push must deep-link to the exact screen' });
  }
  if (t.channel === 'sms') {
    const len = estimatedLength(t.body);
    const limit = t.language === 'ar' ? 268 : 612; // 4 Unicode parts / 4 GSM parts
    if (len > limit) issues.push({ level: 'warning', rule: 'sms_length', message: `Long SMS (≈${len} chars) costs multiple parts` });
  }
  if (t.channel === 'email' && !t.subject) {
    issues.push({ level: 'error', rule: 'email_subject', message: 'Email needs a subject' });
  }
  if (t.category === 'A' && /!/.test(stripVars(t.body))) {
    issues.push({ level: 'warning', rule: 'tone', message: 'No exclamation marks in transactional messages (Appendix A)' });
  }
  if (/\b(EGP|ج\.م|جنيه)\b.*\{\{\s*price/i.test(all) && !/\{\{\s*priceTime|as of|حتى|الساعة/i.test(all) && t.category !== 'A') {
    issues.push({
      level: 'warning',
      rule: 'price_timestamp',
      message: 'Marketing prices must show the time taken and that prices move continuously (§9.1)',
    });
  }
  return issues;
}

export function hasBlockingIssues(issues: LintIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
