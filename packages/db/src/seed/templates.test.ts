import { describe, expect, it } from 'vitest';
import { type Channel, lintTemplate, render, renderText, requiredTemplates } from '@cep/core';
import { TEMPLATES } from './templates';

describe('seed template library', () => {
  const byKey = new Map(TEMPLATES.map((t) => [t.key, t]));

  it('covers every template the platform can send, in Arabic and English', () => {
    const missing: string[] = [];
    for (const [key, channels] of requiredTemplates()) {
      for (const ch of channels) {
        const t = byKey.get(key);
        const pair = t?.[ch as 'push'];
        if (!pair?.en?.body || !pair?.ar?.body) missing.push(`${key}/${ch}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('passes the compliance linter (no blocking issues)', () => {
    const errors: string[] = [];
    for (const t of TEMPLATES) {
      for (const ch of ['push', 'email', 'sms', 'inapp', 'whatsapp'] as const) {
        const pair = t[ch];
        if (!pair) continue;
        for (const lang of ['en', 'ar'] as const) {
          const issues = lintTemplate({ channel: ch as Channel, language: lang, ...pair[lang], deepLink: t.deepLink ?? '/default', category: t.category });
          for (const i of issues.filter((x) => x.level === 'error')) errors.push(`${t.key}/${ch}/${lang}: ${i.message} ${i.match ?? ''}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('renders with sample variables', () => {
    const t = byKey.get('order_executed')!;
    const out = renderText(t.push!.en.body, { lang: 'en', grams: 2.15, metal: 'gold', pricePerGram: 4812 });
    expect(out).toBe('You bought 2.150 g of gold at EGP 4,812/g.');
    const ar = renderText(t.push!.ar.body, { lang: 'ar', grams: 2.15, metal: 'gold', pricePerGram: 4812 });
    expect(ar).toContain('الذهب');
    expect(render('<b>{{name}}</b>', { name: '<x>' })).toBe('<b>&lt;x&gt;</b>');
  });
});
