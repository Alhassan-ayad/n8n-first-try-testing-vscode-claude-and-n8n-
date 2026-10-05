// Worker: CDC ingestion, message dispatch, segment fan-out, journey timers
// and the scheduled communication calendar (Cairo time).

process.env.CEP_SERVICE ??= 'worker';

import { Worker } from 'bullmq';
import { config, ZONE } from '@cep/core';
import { CdcPoller, closeSource } from '@cep/cdc';
import { prisma } from '@cep/db';
import {
  closeInfra,
  dailyPriceSummary,
  debitReminders,
  dispatchMessage,
  type FanoutJob,
  ingestEvents,
  journeyTick,
  launchDueCampaigns,
  log,
  monthlyStatements,
  nightly,
  offerHousekeeping,
  planStatements,
  processFanoutPage,
  QUEUE,
  quarterlyNps,
  queue,
  recoverEvents,
  redis,
  releaseDue,
  zakatSummary,
} from '@cep/engine';

type CronName =
  | 'release'
  | 'journeyTick'
  | 'campaigns'
  | 'recoverEvents'
  | 'dailyPrice'
  | 'debitReminders'
  | 'statements'
  | 'planStatements'
  | 'nightly'
  | 'nps'
  | 'zakat'
  | 'offers';

/** Plan §6.1 / §6.5 send-time framework. Patterns are evaluated in Africa/Cairo. */
const SCHEDULE: Array<{ name: CronName; every?: number; pattern?: string }> = [
  { name: 'release', every: 60_000 },
  { name: 'journeyTick', every: 60_000 },
  { name: 'campaigns', every: 60_000 },
  { name: 'recoverEvents', every: 5 * 60_000 },
  { name: 'dailyPrice', pattern: '0 10 * * *' },
  { name: 'debitReminders', pattern: '0 12 * * *' },
  { name: 'statements', pattern: '0 9 * * *' },
  { name: 'planStatements', pattern: '30 9 * * *' },
  { name: 'nightly', pattern: '0 2 * * *' },
  { name: 'nps', pattern: '0 11 * * 0' },
  { name: 'zakat', pattern: '0 10 * * *' },
  { name: 'offers', pattern: '15 * * * *' },
];

const HANDLERS: Record<CronName, () => Promise<unknown>> = {
  release: () => releaseDue(),
  journeyTick: () => journeyTick(),
  campaigns: () => launchDueCampaigns(),
  recoverEvents: () => recoverEvents(),
  dailyPrice: () => dailyPriceSummary(),
  debitReminders: () => debitReminders(),
  statements: () => monthlyStatements(),
  planStatements: () => planStatements(),
  nightly: () => nightly(),
  nps: () => quarterlyNps(),
  zakat: () => zakatSummary(),
  offers: () => offerHousekeeping(),
};

async function main() {
  const c = config();
  const connection = redis();

  const dispatchWorker = new Worker(
    QUEUE.dispatch,
    async (job) => dispatchMessage((job.data as { messageId: string }).messageId),
    { connection, concurrency: 20 },
  );
  const fanoutWorker = new Worker(QUEUE.fanout, async (job) => processFanoutPage(job.data as FanoutJob), { connection, concurrency: 2 });
  const cronWorker = new Worker(
    QUEUE.cron,
    async (job) => {
      const handler = HANDLERS[job.name as CronName];
      if (!handler) return 'unknown';
      return handler();
    },
    { connection, concurrency: 4 },
  );

  for (const w of [dispatchWorker, fanoutWorker, cronWorker]) {
    w.on('failed', (job, err) => log.warn({ queue: w.name, job: job?.name, err: err.message }, 'job failed'));
    w.on('error', (err) => log.error({ queue: w.name, err: err.message }, 'worker error'));
  }

  if (!c.DISABLE_SCHEDULES) {
    const q = queue(QUEUE.cron);
    for (const s of SCHEDULE) {
      await q.upsertJobScheduler(
        s.name,
        s.every ? { every: s.every } : { pattern: s.pattern!, tz: ZONE },
        { name: s.name, opts: { removeOnComplete: 100, removeOnFail: 200 } },
      );
    }
    log.info({ jobs: SCHEDULE.map((s) => `${s.name}@${s.pattern ?? `${s.every! / 1000}s`}`) }, 'schedules registered (Africa/Cairo)');
  }

  let poller: CdcPoller | undefined;
  if (c.SOURCE_MSSQL_URL) {
    poller = new CdcPoller(
      {
        get: async (inst) => (await prisma.cdcCheckpoint.findUnique({ where: { captureInstance: inst } }))?.lastLsn ?? null,
        set: async (inst, lsn) => {
          await prisma.cdcCheckpoint.upsert({
            where: { captureInstance: inst },
            create: { captureInstance: inst, lastLsn: lsn },
            update: { lastLsn: lsn },
          });
        },
      },
      async (events) => {
        await ingestEvents(events, 'cdc');
      },
      {
        info: (m) => log.info(m),
        warn: (m) => log.warn(m),
        error: (m) => log.error(m),
      },
    );
    poller.start();
    log.info({ pollMs: c.CDC_POLL_MS, start: c.CDC_START }, 'CDC poller started');
  } else {
    log.warn('SOURCE_MSSQL_URL not set — CDC ingestion disabled (events can still be posted to the API)');
  }

  log.info({ providerMode: c.PROVIDER_MODE }, 'worker ready');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    await poller?.stop();
    await Promise.all([dispatchWorker.close(), fanoutWorker.close(), cronWorker.close()]);
    await closeSource();
    await closeInfra();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err: (err as Error).stack }, 'worker failed to start');
  process.exit(1);
});
