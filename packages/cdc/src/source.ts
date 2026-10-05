// Read-only queries against the mngm core database for the single client
// view, holdings, statements and scheduled reminders. Column names follow the
// same documented schema as the CDC mappers.

import sql from 'mssql';
import { config } from '@cep/core';

let pool: sql.ConnectionPool | undefined;

export async function sourcePool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  const conn = config().SOURCE_MSSQL_URL;
  if (!conn) throw new Error('SOURCE_MSSQL_URL is not set');
  pool = await new sql.ConnectionPool(conn).connect();
  return pool;
}

export async function closeSource(): Promise<void> {
  await pool?.close().catch(() => undefined);
  pool = undefined;
}

export interface SourceUser {
  Id: string;
  FullName: string | null;
  Phone: string | null;
  Email: string | null;
  Language: string | null;
  Source: string | null;
  IsFormerInstalment: boolean | null;
  Status: string | null;
  CreatedAt: Date;
}

export async function getUser(externalId: string): Promise<SourceUser | null> {
  const p = await sourcePool();
  const r = await p.request().input('id', sql.NVarChar, externalId).query<SourceUser>('SELECT * FROM dbo.Users WHERE Id = @id');
  return r.recordset[0] ?? null;
}

export interface Holdings {
  gold: number;
  silver: number;
  cash: number;
}

export async function getHoldings(externalId: string): Promise<Holdings> {
  const p = await sourcePool();
  const r = await p
    .request()
    .input('id', sql.NVarChar, externalId)
    .query<{ Metal: string; Grams: number }>('SELECT Metal, Grams FROM dbo.Holdings WHERE UserId = @id');
  const w = await p
    .request()
    .input('id', sql.NVarChar, externalId)
    .query<{ CashBalance: number }>('SELECT CashBalance FROM dbo.Wallets WHERE UserId = @id');
  const h: Holdings = { gold: 0, silver: 0, cash: Number(w.recordset[0]?.CashBalance ?? 0) };
  for (const row of r.recordset) {
    if (row.Metal?.toLowerCase() === 'silver') h.silver += Number(row.Grams);
    else h.gold += Number(row.Grams);
  }
  return h;
}

export async function getAllHoldings(): Promise<Map<string, Holdings>> {
  const p = await sourcePool();
  const r = await p.request().query<{ UserId: string; Metal: string; Grams: number }>('SELECT UserId, Metal, Grams FROM dbo.Holdings');
  const w = await p.request().query<{ UserId: string; CashBalance: number }>('SELECT UserId, CashBalance FROM dbo.Wallets');
  const out = new Map<string, Holdings>();
  const get = (id: string) => {
    let h = out.get(id);
    if (!h) out.set(id, (h = { gold: 0, silver: 0, cash: 0 }));
    return h;
  };
  for (const row of r.recordset) {
    const h = get(row.UserId);
    if (row.Metal?.toLowerCase() === 'silver') h.silver += Number(row.Grams);
    else h.gold += Number(row.Grams);
  }
  for (const row of w.recordset) get(row.UserId).cash = Number(row.CashBalance);
  return out;
}

export interface UpcomingDebit {
  PlanId: string;
  UserId: string;
  Amount: number;
  Metal: string;
  NextDebitDate: Date;
  CashBalance: number | null;
}

/** Plans debiting on `debitDate` (YYYY-MM-DD). */
export async function getDebitsDueOn(debitDate: string): Promise<UpcomingDebit[]> {
  const p = await sourcePool();
  const r = await p.request().input('d', sql.Date, debitDate).query<UpcomingDebit>(
    `SELECT CAST(p.Id AS NVARCHAR(64)) AS PlanId, p.UserId, p.Amount, p.Metal, p.NextDebitDate, w.CashBalance
       FROM dbo.RecurringPlans p
       LEFT JOIN dbo.Wallets w ON w.UserId = p.UserId
      WHERE p.Status = 'active' AND p.NextDebitDate = @d`,
  );
  return r.recordset;
}

export interface StatementOrder {
  Id: string;
  Side: string;
  Metal: string;
  Grams: number;
  PricePerGram: number;
  Amount: number;
  UpdatedAt: Date;
}

export async function getOrdersBetween(externalId: string, from: Date, to: Date): Promise<StatementOrder[]> {
  const p = await sourcePool();
  const r = await p
    .request()
    .input('id', sql.NVarChar, externalId)
    .input('from', sql.DateTime2, from)
    .input('to', sql.DateTime2, to)
    .query<StatementOrder>(
      `SELECT CAST(Id AS NVARCHAR(64)) AS Id, Side, Metal, Grams, PricePerGram, Amount, UpdatedAt
         FROM dbo.Orders WHERE UserId = @id AND Status = 'executed' AND UpdatedAt >= @from AND UpdatedAt < @to
        ORDER BY UpdatedAt`,
    );
  return r.recordset;
}

/** Executed buy orders for pay-day pattern detection (last 120 days). */
export async function getRecentBuys(days = 120): Promise<Array<{ UserId: string; Amount: number; UpdatedAt: Date }>> {
  const p = await sourcePool();
  const r = await p.request().input('days', sql.Int, days).query<{ UserId: string; Amount: number; UpdatedAt: Date }>(
    `SELECT UserId, Amount, UpdatedAt FROM dbo.Orders
      WHERE Status = 'executed' AND Side = 'buy' AND UpdatedAt >= DATEADD(day, -@days, SYSUTCDATETIME())`,
  );
  return r.recordset;
}
