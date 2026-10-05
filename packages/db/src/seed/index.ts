// Seed: first admin user + the full template library (Arabic and English).
// Safe to re-run: existing template versions are never overwritten — if the
// seed copy changed, a new draft version is added for review.
//
//   SEED_APPROVE=true   approve seeded templates immediately (staging/demo only)

import bcrypt from 'bcryptjs';
import { type Channel, config, lintTemplate } from '@cep/core';
import { prisma } from '../index';
import { TEMPLATES } from './templates';

const CHANNELS = ['push', 'email', 'sms', 'inapp', 'whatsapp'] as const;

async function seedAdmin() {
  const c = config();
  const email = c.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return;
  await prisma.adminUser.create({
    data: { email, name: 'Platform admin', passwordHash: await bcrypt.hash(c.ADMIN_PASSWORD, 10), roles: 'admin' },
  });
  console.log(`seed: created admin ${email}`);
}

async function seedTemplates() {
  const approve = process.env.SEED_APPROVE === 'true';
  let created = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const t of TEMPLATES) {
    for (const channel of CHANNELS) {
      const pair = t[channel];
      if (!pair) continue;
      for (const language of ['en', 'ar'] as const) {
        const copy = pair[language];
        const data = {
          key: t.key,
          channel,
          language,
          category: t.category,
          topic: t.topic,
          subject: copy.subject ?? null,
          title: copy.title ?? null,
          body: copy.body,
          deepLink: t.deepLink ?? null,
        };
        const issues = lintTemplate({
          channel: channel as Channel,
          language,
          subject: data.subject,
          title: data.title,
          body: data.body,
          deepLink: data.deepLink ?? (channel === 'push' ? 'default' : null),
          category: t.category,
        });
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length) problems.push(`${t.key}/${channel}/${language}: ${errors.map((i) => i.message).join('; ')}`);

        const latest = await prisma.template.findFirst({
          where: { key: t.key, channel, language },
          orderBy: { version: 'desc' },
        });
        if (latest && latest.body === data.body && latest.subject === data.subject && latest.title === data.title) {
          skipped++;
          continue;
        }
        await prisma.template.create({
          data: {
            ...data,
            version: (latest?.version ?? 0) + 1,
            status: approve && !errors.length ? 'approved' : 'in_review',
            submittedBy: 'seed',
            approvedBy: approve && !errors.length ? 'seed (SEED_APPROVE)' : null,
            approvedAt: approve && !errors.length ? new Date() : null,
            lintReport: JSON.stringify(issues),
            owner: t.category === 'A' ? 'Engineering' : 'CRM',
          },
        });
        created++;
      }
    }
  }
  console.log(`seed: templates created ${created}, unchanged ${skipped}`);
  if (problems.length) console.warn(`seed: lint errors (fix before approval):\n  ${problems.join('\n  ')}`);
}

async function main() {
  await seedAdmin();
  await seedTemplates();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
