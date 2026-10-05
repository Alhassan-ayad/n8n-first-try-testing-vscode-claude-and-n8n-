// Price and market engine (plan §5.2 and §9.3): custom alerts, volatility and
// dip alerts, the daily summary, and price-feed disruption handling.

import { config, dayKey, type PlatformEvent, startOfCairoDay } from '@cep/core';
import { prisma } from '@cep/db';
import { startBroadcast } from './broadcast';
import { bumpDailyMarker, log } from './infra';
import { createMulti } from './messages';

const ACTIVE_STAGES = ['S2', 'S3', 'S4', 'S5', 'S6'];

export async function handlePriceEvent(e: PlatformEvent): Promise<void> {
  const metal = String(e.payload.metal ?? 'gold');
  if (e.type === 'price.feed.stale') return handleStale(metal, Boolean(e.payload.tradingPaused), e.occurredAt);
  if (e.type === 'price.feed.restored') return handleRestored(metal);
  if (e.type !== 'price.tick') return;

  const buy = Number(e.payload.buyPrice);
  const sell = Number(e.payload.sellPrice ?? buy);
  if (!Number.isFinite(buy) || buy <= 0) return;

  const prev = await prisma.priceTick.findFirst({ where: { metal, stale: false }, orderBy: { occurredAt: 'desc' } });
  await prisma.priceTick.create({ data: { metal, buyPrice: buy, sellPrice: sell, occurredAt: e.occurredAt } });

  // A good tick after a stale period restores the feed.
  const staleBanner = await prisma.banner.findFirst({ where: { kind: { in: ['price_feed', 'trading_paused'] }, active: true } });
  if (staleBanner) await handleRestored(metal);

  if (prev) await customAlerts(metal, prev.buyPrice, buy, e.occurredAt);
  await volatility(metal, buy, e.occurredAt);
  await dip(metal, buy, e.occurredAt);
}

async function customAlerts(metal: string, prevPrice: number, price: number, at: Date) {
  const alerts = await prisma.priceAlert.findMany({
    where: {
      metal,
      active: true,
      OR: [
        { direction: 'below', level: { gte: price, lt: prevPrice } },
        { direction: 'above', level: { lte: price, gt: prevPrice } },
      ],
    },
    include: { client: true },
  });
  for (const a of alerts) {
    const changePct = ((price - prevPrice) / prevPrice) * 100;
    await createMulti({
      client: a.client,
      channels: a.smsAlso ? ['push', 'sms'] : ['push'],
      templateKey: 'price_alert',
      kind: 'client_alert',
      topic: 'price_alerts',
      category: 'B',
      vars: { metal, price, level: a.level, direction: a.direction, changePct, priceTime: at },
      dedupeBase: `alert:${a.id}:${at.getTime()}`,
      inbox: true,
    });
    await prisma.priceAlert.update({ where: { id: a.id }, data: { lastTriggeredAt: at, active: a.repeat } });
  }
  if (alerts.length) log.info({ metal, price, n: alerts.length }, 'custom price alerts triggered');
}

async function dayOpen(metal: string, at: Date): Promise<number | null> {
  const t = await prisma.priceTick.findFirst({
    where: { metal, stale: false, occurredAt: { gte: startOfCairoDay(at) } },
    orderBy: { occurredAt: 'asc' },
  });
  return t?.buyPrice ?? null;
}

async function volatility(metal: string, price: number, at: Date) {
  const c = config();
  const open = await dayOpen(metal, at);
  if (!open) return;
  const pct = ((price - open) / open) * 100;
  if (Math.abs(pct) < c.VOLATILITY_THRESHOLD_PCT) return;
  const day = dayKey(at);
  // One alert per threshold band, at most VOLATILITY_MAX_PER_DAY per metal per day.
  const band = Math.floor(Math.abs(pct) / c.VOLATILITY_THRESHOLD_PCT) * Math.sign(pct);
  if (!(await bumpDailyMarker(`volatility_band:${metal}:${band}`, day, 1))) return;
  if (!(await bumpDailyMarker(`volatility:${metal}`, day, c.VOLATILITY_MAX_PER_DAY))) return;

  const vars = { metal, price, changePct: pct, direction: pct > 0 ? 'up' : 'down', priceTime: at };
  await startBroadcast(
    { holdsMetal: metal as 'gold' | 'silver', stages: ACTIVE_STAGES },
    {
      templateKey: 'volatility_alert',
      channels: ['push'],
      kind: 'client_alert',
      topic: 'price_alerts',
      category: 'B',
      vars,
      dedupePrefix: `volatility:${metal}:${day}:${band}`,
    },
  );
  await prisma.banner.create({
    data: {
      kind: 'info',
      titleEn: `${metal === 'silver' ? 'Silver' : 'Gold'} moved ${pct.toFixed(1)}% today`,
      titleAr: `${metal === 'silver' ? 'الفضة' : 'الذهب'}: تغير ${pct.toFixed(1)}% اليوم`,
      bodyEn: `EGP ${price.toLocaleString('en-US')} per gram at ${at.toISOString().slice(11, 16)} UTC. Prices move continuously.`,
      bodyAr: `${price.toLocaleString('en-US')} جنيه للجرام. الأسعار تتغير باستمرار.`,
      deepLink: `${config().APP_DEEPLINK_BASE}/prices/${metal}`,
      startsAt: at,
      endsAt: new Date(at.getTime() + 4 * 3_600_000),
      createdBy: 'price-engine',
    },
  });
  log.info({ metal, pct }, 'volatility alert');
}

async function dip(metal: string, price: number, at: Date) {
  const since = new Date(at.getTime() - 7 * 86_400_000);
  const agg = await prisma.priceTick.aggregate({
    where: { metal, stale: false, occurredAt: { gte: since } },
    _avg: { buyPrice: true },
    _count: { _all: true },
  });
  const avg = agg._avg.buyPrice;
  if (!avg || agg._count._all < 10) return;
  const pct = ((price - avg) / avg) * 100;
  if (pct > -config().DIP_THRESHOLD_PCT) return;
  const day = dayKey(at);
  if (!(await bumpDailyMarker(`dip:${metal}`, day, 1))) return;
  await startBroadcast(
    { tagsAny: ['price_sensitive'], stages: ACTIVE_STAGES },
    {
      templateKey: 'dip_alert',
      channels: ['push'],
      kind: 'client_alert',
      topic: 'price_alerts',
      category: 'B',
      vars: { metal, price, avg7d: avg, changePct: pct, priceTime: at },
      inbox: true,
      dedupePrefix: `dip:${metal}:${day}`,
    },
  );
  log.info({ metal, pct }, 'dip alert');
}

/** §9.3 — banner immediately; push + email within 15 minutes if trading is paused. */
async function handleStale(metal: string, tradingPaused: boolean, at: Date) {
  await prisma.priceTick.create({ data: { metal, buyPrice: 0, sellPrice: 0, stale: true, occurredAt: at } });
  const kind = tradingPaused ? 'trading_paused' : 'price_feed';
  const existing = await prisma.banner.findFirst({ where: { kind, active: true } });
  if (existing) return;
  await prisma.banner.create({
    data: {
      kind,
      titleEn: tradingPaused ? 'Trading is paused while we verify prices' : 'Prices are being verified',
      titleAr: tradingPaused ? 'التداول متوقف مؤقتًا أثناء التحقق من الأسعار' : 'جارٍ التحقق من الأسعار',
      bodyEn: tradingPaused
        ? 'You cannot buy or sell right now. Your holdings and cash are safe. We will update you as soon as trading resumes.'
        : 'Quotes may be delayed for a few minutes. Your holdings and cash are not affected.',
      bodyAr: tradingPaused
        ? 'لا يمكنك الشراء أو البيع الآن. أرصدتك ونقودك آمنة. سنبلغك فور استئناف التداول.'
        : 'قد تتأخر الأسعار لبضع دقائق. أرصدتك ونقودك غير متأثرة.',
      deepLink: `${config().APP_DEEPLINK_BASE}/status`,
      startsAt: at,
      endsAt: new Date(at.getTime() + 24 * 3_600_000),
      createdBy: 'price-engine',
    },
  });
  if (tradingPaused) {
    await startBroadcast(
      { stages: ACTIVE_STAGES },
      {
        templateKey: 'trading_paused',
        channels: ['push', 'email'],
        kind: 'service',
        topic: 'service_notice',
        category: 'F',
        vars: { metal, at },
        dedupePrefix: `trading_paused:${at.getTime()}`,
      },
    );
  }
  log.warn({ metal, tradingPaused }, 'price feed stale');
}

async function handleRestored(metal: string) {
  const banners = await prisma.banner.findMany({ where: { kind: { in: ['price_feed', 'trading_paused'] }, active: true } });
  if (!banners.length) return;
  await prisma.banner.updateMany({
    where: { id: { in: banners.map((b) => b.id) } },
    data: { active: false, endsAt: new Date() },
  });
  if (banners.some((b) => b.kind === 'trading_paused')) {
    await startBroadcast(
      { stages: ACTIVE_STAGES },
      {
        templateKey: 'price_feed_restored',
        channels: ['push'],
        kind: 'service',
        topic: 'service_notice',
        category: 'F',
        vars: { metal },
        dedupePrefix: `restored:${banners[0]!.id}`,
      },
    );
  }
  log.info({ metal }, 'price feed restored');
}

/** Daily 10:00 summary: gold and silver per gram with day change (plan §5.2). */
export async function dailyPriceSummary(now = new Date()): Promise<void> {
  const day = dayKey(now);
  if (!(await bumpDailyMarker('daily_price_summary', day, 1))) return;
  const vars: Record<string, unknown> = { priceTime: now };
  for (const metal of ['gold', 'silver']) {
    const latest = await prisma.priceTick.findFirst({ where: { metal, stale: false }, orderBy: { occurredAt: 'desc' } });
    const prevClose = await prisma.priceTick.findFirst({
      where: { metal, stale: false, occurredAt: { lt: startOfCairoDay(now) } },
      orderBy: { occurredAt: 'desc' },
    });
    if (!latest) continue;
    vars[`${metal}Price`] = latest.buyPrice;
    vars[`${metal}Change`] = prevClose ? ((latest.buyPrice - prevClose.buyPrice) / prevClose.buyPrice) * 100 : 0;
  }
  if (vars.goldPrice === undefined) {
    log.warn('daily price summary skipped: no price ticks');
    return;
  }
  await startBroadcast(
    { stages: ['S2', 'S3', 'S4', 'S5', 'S6', 'S7'] },
    {
      templateKey: 'daily_price',
      channels: ['push', 'whatsapp'],
      kind: 'research',
      topic: 'price_daily',
      category: 'B',
      vars,
      dedupePrefix: `daily_price:${day}`,
    },
  );
}
