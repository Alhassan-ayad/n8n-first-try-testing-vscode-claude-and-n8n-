import Handlebars from 'handlebars';
import { config } from './config';
import { cairo } from './time';
import type { Language } from './types';

const hb = Handlebars.create();

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function num(value: unknown, decimals: number, lang: Language): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const s = n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // Arabic copy keeps Western digits by default (clearer for amounts); set AR_DIGITS=1 to localise.
  return lang === 'ar' && process.env.AR_DIGITS === '1' ? s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]!) : s;
}

hb.registerHelper('grams', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  return num(v, 3, (opts?.data?.root?.lang as Language) ?? 'en');
});
hb.registerHelper('egp', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  return num(v, 0, (opts?.data?.root?.lang as Language) ?? 'en');
});
hb.registerHelper('money', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  return num(v, 2, (opts?.data?.root?.lang as Language) ?? 'en');
});
hb.registerHelper('pct', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  return num(v, 1, (opts?.data?.root?.lang as Language) ?? 'en');
});
hb.registerHelper('date', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  const lang = (opts?.data?.root?.lang as Language) ?? 'en';
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v ?? '');
  return cairo(d).setLocale(lang === 'ar' ? 'ar-EG' : 'en-GB').toFormat('d MMMM yyyy');
});
hb.registerHelper('time', function (this: unknown, v: unknown) {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v ?? '');
  return cairo(d).toFormat('HH:mm');
});
hb.registerHelper('metal', function (this: unknown, v: unknown, opts: Handlebars.HelperOptions) {
  const lang = (opts?.data?.root?.lang as Language) ?? 'en';
  const m = String(v ?? 'gold');
  if (lang === 'ar') return m === 'silver' ? 'الفضة' : 'الذهب';
  return m === 'silver' ? 'silver' : 'gold';
});
hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);

const cache = new Map<string, Handlebars.TemplateDelegate>();

export function render(source: string | null | undefined, vars: Record<string, unknown>): string {
  if (!source) return '';
  let fn = cache.get(source);
  if (!fn) {
    fn = hb.compile(source, { noEscape: false, strict: false });
    if (cache.size > 2000) cache.clear();
    cache.set(source, fn);
  }
  return fn(vars);
}

/** Text channels (SMS/push) must not HTML-escape. */
export function renderText(source: string | null | undefined, vars: Record<string, unknown>): string {
  if (!source) return '';
  const key = `text::${source}`;
  let fn = cache.get(key);
  if (!fn) {
    fn = hb.compile(source, { noEscape: true, strict: false });
    cache.set(key, fn);
  }
  return fn(vars);
}

/** Variables every template can use. */
export function baseVars(lang: Language, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const c = config();
  return {
    lang,
    rtl: lang === 'ar',
    appLink: c.APP_DEEPLINK_BASE,
    webLink: c.APP_WEB_BASE,
    now: new Date(),
    ...extra,
  };
}

/** Build an absolute deep link from a template path like `/orders/{{orderId}}`. */
export function buildDeepLink(path: string | null | undefined, vars: Record<string, unknown>): string | null {
  if (!path) return null;
  const rendered = renderText(path, vars);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rendered)) return rendered;
  return `${config().APP_DEEPLINK_BASE}${rendered.startsWith('/') ? '' : '/'}${rendered}`;
}

/** Web equivalent of a deep link (for email/SMS where the app may not be installed). */
export function webLinkFor(deepLink: string | null): string | null {
  if (!deepLink) return null;
  const c = config();
  return deepLink.startsWith(c.APP_DEEPLINK_BASE) ? c.APP_WEB_BASE + deepLink.slice(c.APP_DEEPLINK_BASE.length) : deepLink;
}
