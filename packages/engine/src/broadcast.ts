// Segment fan-out for scheduled sends, market alerts and campaigns. Pages
// through the segment in id order (500 per job) so very large sends are
// resumable and never hold a giant result set in memory.

import {
  type Category,
  type Channel,
  isInHoldout,
  isMandatory,
  type Kind,
  type SegmentFilter,
  segmentToWhere,
  type Topic,
} from '@cep/core';
import { type Prisma, prisma } from '@cep/db';
import { log, queue, QUEUE } from './infra';
import { createMulti } from './messages';

export interface BroadcastSpec {
  templateKey: string;
  channels: Array<Exclude<Channel, 'call'>>;
  kind: Kind;
  topic: Topic;
  category: Category;
  vars?: Record<string, unknown>;
  inbox?: boolean;
  campaignId?: string;
  campaignSlot?: string;
  holdoutScope?: string;
  holdoutPct?: number;
  /** Dedupe prefix — re-running the same broadcast never double-sends. */
  dedupePrefix: string;
  notBefore?: string;
}

export interface FanoutJob {
  filter: SegmentFilter;
  spec: BroadcastSpec;
  cursor: string | null;
}

const PAGE = 500;

export function broadcastWhere(filter: SegmentFilter, spec: Pick<BroadcastSpec, 'kind' | 'topic' | 'channels'>): Prisma.ClientWhereInput {
  const where = segmentToWhere(filter) as Prisma.ClientWhereInput;
  if (isMandatory(spec.kind, spec.topic) || spec.channels.includes('inapp')) return where;
  return {
    AND: [where, { consents: { some: { granted: true, topic: spec.topic, channel: { in: spec.channels } } } }],
  };
}

export async function countAudience(filter: SegmentFilter, spec?: Pick<BroadcastSpec, 'kind' | 'topic' | 'channels'>) {
  return prisma.client.count({ where: spec ? broadcastWhere(filter, spec) : (segmentToWhere(filter) as Prisma.ClientWhereInput) });
}

export async function startBroadcast(filter: SegmentFilter, spec: BroadcastSpec): Promise<void> {
  await queue(QUEUE.fanout).add('fanout', { filter, spec, cursor: null } satisfies FanoutJob, {
    removeOnComplete: true,
    removeOnFail: 500,
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
  });
}

export async function processFanoutPage(job: FanoutJob): Promise<number> {
  const { filter, spec } = job;
  const where = broadcastWhere(filter, spec);
  const clients = await prisma.client.findMany({
    where: job.cursor ? { AND: [where, { id: { gt: job.cursor } }] } : where,
    orderBy: { id: 'asc' },
    take: PAGE,
  });

  for (const client of clients) {
    if (spec.holdoutScope) {
      const holdout = isInHoldout(client.id, spec.holdoutScope, spec.holdoutPct ?? 0);
      await prisma.holdoutAssignment.upsert({
        where: { scope_clientId: { scope: spec.holdoutScope, clientId: client.id } },
        create: { scope: spec.holdoutScope, clientId: client.id, holdout },
        update: {},
      });
      if (holdout) continue;
    }
    await createMulti({
      client,
      channels: spec.channels,
      templateKey: spec.templateKey,
      kind: spec.kind,
      topic: spec.topic,
      category: spec.category,
      vars: spec.vars,
      inbox: spec.inbox,
      campaignId: spec.campaignId,
      campaignSlot: spec.campaignSlot,
      notBefore: spec.notBefore ? new Date(spec.notBefore) : null,
      dedupeBase: `${spec.dedupePrefix}:${client.id}`,
      skipUnconsented: true,
    });
  }

  if (clients.length === PAGE) {
    await queue(QUEUE.fanout).add(
      'fanout',
      { filter, spec, cursor: clients[clients.length - 1]!.id } satisfies FanoutJob,
      { removeOnComplete: true, removeOnFail: 500, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    );
  } else if (spec.campaignId) {
    await finishCampaignFanout(spec.campaignId, spec.holdoutScope);
  }
  log.info({ template: spec.templateKey, page: clients.length, campaign: spec.campaignId }, 'fanout page');
  return clients.length;
}

async function finishCampaignFanout(campaignId: string, scope?: string) {
  const [treated, holdout] = scope
    ? await Promise.all([
        prisma.holdoutAssignment.count({ where: { scope, holdout: false } }),
        prisma.holdoutAssignment.count({ where: { scope, holdout: true } }),
      ])
    : [0, 0];
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'completed', completedAt: new Date(), segmentSize: treated + holdout, holdoutSize: holdout },
  });
}
