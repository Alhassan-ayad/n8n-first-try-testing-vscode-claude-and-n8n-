// Measurement (plan §12): delivery health, engagement, behaviour, objectives
// and the opt-out stop thresholds (0.5% email, 1% push).

import { cairo, OBJECTIVES, STAGE_LABELS } from '@cep/core';
import { prisma } from '@cep/db';
import { journeyStats } from './journeys';

const SENTISH = ['sent', 'delivered', 'opened', 'clicked'];

export async function dashboard(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [byChannel, stages, tiers, totalClients] = await Promise.all([
    prisma.message.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.client.groupBy({ by: ['lifecycleStage'], where: { closedAt: null }, _count: { _all: true } }),
    prisma.client.groupBy({ by: ['valueTier'], where: { closedAt: null }, _count: { _all: true } }),
    prisma.client.count(),
  ]);

  const channels = ['push', 'email', 'sms', 'inapp', 'whatsapp'];
  const delivery = channels.map((ch) => {
    const rows = byChannel.filter((r) => r.channel === ch);
    const n = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
    const sent = n(SENTISH);
    const failed = n(['failed']);
    const delivered = n(['delivered', 'opened', 'clicked']);
    const opened = n(['opened', 'clicked']);
    const clicked = n(['clicked']);
    return {
      channel: ch,
      sent,
      failed,
      suppressed: n(['suppressed']),
      deferred: n(['deferred', 'held']),
      pending: n(['pending', 'sending']),
      deliveryRate: sent + failed ? (ch === 'push' || ch === 'inapp' ? sent : delivered) / (sent + failed) : null,
      openRate: ch === 'email' && sent ? opened / sent : null,
      clickRate: ch === 'email' && sent ? clicked / sent : null,
    };
  });

  // Opt-outs by channel against marketing volume (stop thresholds §12.2).
  const optOutRows = await prisma.consentAudit.groupBy({
    by: ['channel'],
    where: { granted: false, createdAt: { gte: since } },
    _count: { clientId: true },
  });
  const marketingSent = await prisma.message.groupBy({
    by: ['channel'],
    where: { createdAt: { gte: since }, status: { in: SENTISH }, topic: { notIn: ['transactional', 'service_notice'] } },
    _count: { _all: true },
  });
  const thresholds: Record<string, number> = { email: 0.005, push: 0.01, sms: 0.01, whatsapp: 0.01 };
  const optOuts = ['email', 'push', 'sms', 'whatsapp'].map((ch) => {
    const opt = optOutRows.find((r) => r.channel === ch)?._count.clientId ?? 0;
    const sent = marketingSent.find((r) => r.channel === ch)?._count._all ?? 0;
    const rate = sent ? opt / sent : 0;
    return { channel: ch, optOuts: opt, marketingSent: sent, rate, threshold: thresholds[ch]!, breached: sent > 100 && rate > thresholds[ch]! };
  });

  const stageCount = (s: string) => stages.find((r) => r.lifecycleStage === s)?._count._all ?? 0;
  const open = stages.reduce((a, r) => a + r._count._all, 0);
  const registered = await prisma.client.count({ where: { closedAt: null } });
  const neverActivated = await prisma.client.count({ where: { closedAt: null, kycStatus: { not: 'approved' } } });
  const buyers = await prisma.client.count({ where: { closedAt: null, orderCount: { gte: 1 } } });
  const repeat = await prisma.client.count({ where: { closedAt: null, orderCount: { gte: 2 } } });
  const active = stageCount('S3') + stageCount('S4') + stageCount('S5');
  const withPlan = await prisma.client.count({ where: { closedAt: null, hasRecurringPlan: true } });
  const dormant90 = await prisma.client.count({
    where: { closedAt: null, orderCount: { gte: 1 }, lastOrderAt: { lte: new Date(Date.now() - 90 * 86_400_000) } },
  });

  const nps = await prisma.surveyResponse.findMany({
    where: { survey: 'nps_quarterly', createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) }, score: { not: null } },
    select: { score: true },
  });
  const promoters = nps.filter((r) => (r.score ?? 0) >= 9).length;
  const detractors = nps.filter((r) => (r.score ?? 0) <= 6).length;
  const csat = await prisma.surveyResponse.aggregate({
    where: { survey: { in: ['csat_order', 'csat_contact'] }, createdAt: { gte: since } },
    _avg: { score: true },
    _count: { _all: true },
  });

  const objectives = [
    {
      key: 'O1',
      label: OBJECTIVES.O1,
      metric: 'Never-activated share',
      value: registered ? neverActivated / registered : 0,
      target: 0.28,
      better: 'lower' as const,
    },
    {
      key: 'O3',
      label: OBJECTIVES.O3,
      metric: 'Recurring plans on active clients',
      value: active + withPlan ? withPlan / Math.max(1, active) : 0,
      target: 0.2,
      better: 'higher' as const,
    },
    { key: 'O3b', label: OBJECTIVES.O3, metric: 'Second-order rate', value: buyers ? repeat / buyers : 0, target: null, better: 'higher' as const },
    { key: 'O4', label: OBJECTIVES.O4, metric: 'Dormancy at 90 days', value: buyers ? dormant90 / buyers : 0, target: 0.35, better: 'lower' as const },
    {
      key: 'O5',
      label: OBJECTIVES.O5,
      metric: 'NPS (last quarter)',
      value: nps.length ? Math.round(((promoters - detractors) / nps.length) * 100) : null,
      target: 45,
      better: 'higher' as const,
    },
  ];

  // Daily send volume series.
  const series = await prisma.$queryRaw<Array<{ d: Date; channel: string; n: number }>>`
    SELECT CAST(createdAt AS date) AS d, channel, COUNT(*) AS n
      FROM [Message] WHERE createdAt >= ${since} AND status IN ('sent','delivered','opened','clicked')
     GROUP BY CAST(createdAt AS date), channel ORDER BY d`;

  return {
    generatedAt: new Date(),
    periodDays: days,
    totals: { clients: totalClients, open, buyers, withPlan },
    stages: Object.entries(STAGE_LABELS).map(([k, label]) => ({ stage: k, label, count: stageCount(k) })),
    tiers: tiers.map((t) => ({ tier: t.valueTier, count: t._count._all })),
    delivery,
    optOuts,
    objectives,
    csat: { avg: csat._avg.score, responses: csat._count._all },
    series: series.map((r) => ({ day: cairo(new Date(r.d)).toFormat('yyyy-MM-dd'), channel: r.channel, count: Number(r.n) })),
    journeys: await journeyStats(),
  };
}
