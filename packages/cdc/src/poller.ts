// SQL Server Change Data Capture poller. Reads each capture instance's change
// table from the last checkpointed LSN, pairs update before/after images, maps
// them to platform events and hands them to the sink. The checkpoint only
// advances after the sink has accepted the batch, so restarts lose nothing.

import sql from 'mssql';
import { config } from '@cep/core';
import { type Change, MAPPINGS, type MappedEvent, type Row, type TableMapping } from './mappings';

export interface CheckpointStore {
  get(captureInstance: string): Promise<string | null>;
  set(captureInstance: string, lsnHex: string): Promise<void>;
}

export interface CdcEvent extends MappedEvent {
  /** Stable id: `<instance>:<lsn>:<seqval>:<n>` */
  id: string;
  occurredAt: Date;
}

export type EventSink = (events: CdcEvent[]) => Promise<void>;

interface Logger {
  info(msg: string, ...a: unknown[]): void;
  warn(msg: string, ...a: unknown[]): void;
  error(msg: string, ...a: unknown[]): void;
}

const META = new Set(['__$start_lsn', '__$end_lsn', '__$seqval', '__$operation', '__$update_mask', '__$command_id']);

const hex = (b: Buffer) => b.toString('hex');
const fromHex = (h: string) => Buffer.from(h, 'hex');

function stripMeta(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!META.has(k)) out[k] = v;
  return out;
}

/** Turn raw CDC rows (ops 1 delete, 2 insert, 3 before, 4 after) into paired changes. */
export function pairChanges(rows: Row[], txTimes: Map<string, Date>): Array<Change & { lsn: string; seq: string }> {
  const out: Array<Change & { lsn: string; seq: string }> = [];
  const pendingBefore = new Map<string, Row>();
  for (const r of rows) {
    const lsn = hex(r['__$start_lsn'] as Buffer);
    const seq = hex(r['__$seqval'] as Buffer);
    const op = Number(r['__$operation']);
    const key = `${lsn}:${seq}`;
    const occurredAt = txTimes.get(lsn) ?? new Date();
    const data = stripMeta(r);
    if (op === 1) out.push({ op: 'delete', before: data, occurredAt, lsn, seq });
    else if (op === 2) out.push({ op: 'insert', after: data, occurredAt, lsn, seq });
    else if (op === 3) pendingBefore.set(key, data);
    else if (op === 4) {
      out.push({ op: 'update', before: pendingBefore.get(key), after: data, occurredAt, lsn, seq });
      pendingBefore.delete(key);
    }
  }
  return out;
}

export class CdcPoller {
  private pool?: sql.ConnectionPool;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private mappings: TableMapping[];

  constructor(
    private readonly checkpoints: CheckpointStore,
    private readonly sink: EventSink,
    private readonly log: Logger = console,
    mappings: TableMapping[] = MAPPINGS,
  ) {
    const disabled = new Set(
      config()
        .CDC_DISABLED_INSTANCES.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    this.mappings = mappings.filter((m) => !disabled.has(m.captureInstance));
    for (const m of this.mappings) {
      if (!/^[A-Za-z0-9_]+$/.test(m.captureInstance)) throw new Error(`Invalid capture instance name ${m.captureInstance}`);
    }
  }

  async connect(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    const conn = config().SOURCE_MSSQL_URL;
    if (!conn) throw new Error('SOURCE_MSSQL_URL is not set');
    this.pool = await new sql.ConnectionPool(conn).connect();
    return this.pool;
  }

  /** Capture instances that actually exist in the source DB. */
  async availableInstances(): Promise<Set<string>> {
    const pool = await this.connect();
    const res = await pool.request().query<{ capture_instance: string }>('SELECT capture_instance FROM cdc.change_tables');
    return new Set(res.recordset.map((r) => r.capture_instance));
  }

  start(): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.pollOnce();
      } catch (err) {
        this.log.error(`CDC poll failed: ${(err as Error).message}`);
        await this.pool?.close().catch(() => undefined);
        this.pool = undefined;
      }
      if (!this.stopped) this.timer = setTimeout(tick, config().CDC_POLL_MS);
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pool?.close().catch(() => undefined);
  }

  async pollOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const pool = await this.connect();
      const available = await this.availableInstances();
      const maxRes = await pool.request().query<{ lsn: Buffer | null }>('SELECT sys.fn_cdc_get_max_lsn() AS lsn');
      const maxLsn = maxRes.recordset[0]?.lsn;
      if (!maxLsn) return 0; // CDC not producing yet (SQL Agent stopped?)

      let total = 0;
      for (const m of this.mappings) {
        if (!available.has(m.captureInstance)) continue;
        total += await this.pollInstance(pool, m, maxLsn);
      }
      return total;
    } finally {
      this.running = false;
    }
  }

  private async pollInstance(pool: sql.ConnectionPool, m: TableMapping, maxLsn: Buffer): Promise<number> {
    const minRes = await pool
      .request()
      .input('inst', sql.NVarChar, m.captureInstance)
      .query<{ lsn: Buffer }>('SELECT sys.fn_cdc_get_min_lsn(@inst) AS lsn');
    const minLsn = minRes.recordset[0]?.lsn;
    if (!minLsn) return 0; // capture instance not ready yet

    const saved = await this.checkpoints.get(m.captureInstance);
    let from: Buffer;
    if (!saved) {
      if (config().CDC_START === 'latest') {
        await this.checkpoints.set(m.captureInstance, hex(maxLsn));
        this.log.info(`CDC ${m.captureInstance}: starting from current LSN ${hex(maxLsn)}`);
        return 0;
      }
      from = minLsn;
    } else {
      const inc = await pool
        .request()
        .input('lsn', sql.VarBinary(10), fromHex(saved))
        .query<{ lsn: Buffer }>('SELECT sys.fn_cdc_increment_lsn(@lsn) AS lsn');
      from = inc.recordset[0]?.lsn ?? fromHex(saved);
      if (Buffer.compare(from, minLsn) < 0) {
        this.log.warn(`CDC ${m.captureInstance}: checkpoint is older than retention; changes may have been lost. Resuming at min LSN.`);
        from = minLsn;
      }
    }
    if (Buffer.compare(from, maxLsn) > 0) return 0;

    const rowsRes = await pool
      .request()
      .input('from', sql.VarBinary(10), from)
      .input('to', sql.VarBinary(10), maxLsn)
      .query<Row>(
        `SELECT * FROM cdc.fn_cdc_get_all_changes_${m.captureInstance}(@from, @to, N'all update old')
         ORDER BY __$start_lsn, __$seqval, __$operation`,
      );
    const rows = rowsRes.recordset;
    if (!rows.length) {
      await this.checkpoints.set(m.captureInstance, hex(maxLsn));
      return 0;
    }

    // Commit times for the LSNs in this batch.
    const txTimes = new Map<string, Date>();
    const lsns = [...new Set(rows.map((r) => hex(r['__$start_lsn'] as Buffer)))];
    for (const l of lsns) {
      const t = await pool
        .request()
        .input('lsn', sql.VarBinary(10), fromHex(l))
        .query<{ t: Date | null }>('SELECT sys.fn_cdc_map_lsn_to_time(@lsn) AS t');
      // CDC commit times are server-local wall clock; treat as UTC if the server runs in UTC.
      if (t.recordset[0]?.t) txTimes.set(l, t.recordset[0].t);
    }

    const events: CdcEvent[] = [];
    for (const ch of pairChanges(rows, txTimes)) {
      let mapped: MappedEvent[] = [];
      try {
        mapped = m.map(ch);
      } catch (err) {
        this.log.error(`CDC mapper ${m.captureInstance} failed at ${ch.lsn}: ${(err as Error).message}`);
      }
      mapped.forEach((e, i) =>
        events.push({ ...e, id: `${m.captureInstance}:${ch.lsn}:${ch.seq}:${i}`, occurredAt: e.occurredAt ?? ch.occurredAt }),
      );
    }

    if (events.length) await this.sink(events);
    await this.checkpoints.set(m.captureInstance, hex(maxLsn));
    if (events.length) this.log.info(`CDC ${m.captureInstance}: ${rows.length} change rows → ${events.length} events`);
    return events.length;
  }
}
