// Branded email wrapper. Arabic renders right-to-left. Marketing mail carries
// a working one-click unsubscribe; transactional mail states it is a service message.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export interface LayoutInput {
  lang: 'ar' | 'en';
  subject: string;
  bodyHtml: string;
  marketing: boolean;
  unsubscribeUrl?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  preferencesUrl?: string | null;
}

export function emailLayout(i: LayoutInput): string {
  const rtl = i.lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? "'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif" : "'Segoe UI', Helvetica, Arial, sans-serif";
  const cta =
    i.ctaUrl && i.ctaLabel
      ? `<p style="margin:22px 0"><a href="${esc(i.ctaUrl)}" style="background:#8a6d1f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block;font-weight:600">${esc(i.ctaLabel)}</a></p>`
      : '';
  const footer = i.marketing
    ? rtl
      ? `تصلك هذه الرسالة لأنك وافقت على تلقي رسائل mngm. <a href="${esc(i.unsubscribeUrl ?? '#')}" style="color:#6b6b6b">إلغاء الاشتراك</a>`
      : `You receive this because you opted in to mngm updates. <a href="${esc(i.unsubscribeUrl ?? '#')}" style="color:#6b6b6b">Unsubscribe</a>`
    : rtl
      ? 'هذه رسالة خدمة تتعلق بحسابك في mngm.'
      : 'This is a service message about your mngm account.';

  return `<!doctype html>
<html lang="${i.lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#1d1a14;padding:18px 28px;text-align:${align}">
<span style="color:#d9b65d;font:700 22px ${font};letter-spacing:1px">mngm</span>
</td></tr>
<tr><td dir="${dir}" style="padding:28px;text-align:${align};font:15px/1.65 ${font};color:#1d1a14">
${i.bodyHtml}
${cta}
</td></tr>
<tr><td dir="${dir}" style="padding:18px 28px;background:#faf8f3;text-align:${align};font:12px/1.6 ${font};color:#6b6b6b">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
