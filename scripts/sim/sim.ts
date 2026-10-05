// Simulator for the mngm core database (local/staging only). Writes rows into
// the simulated mngm_core tables so the CDC pipeline picks them up exactly as
// it would in production. Also calls the client API (HMAC-signed).
//
//   npm run sim -- register u100 [--former] [--name "Mona Ali"] [--phone 01012345678] [--email m@x.com] [--lang en]
//   npm run sim -- kyc-submit u100 | kyc-approve u100 | kyc-reject u100 "blurry photo"
//   npm run sim -- cash-in u100 5000
//   npm run sim -- order u100 2.15 [--metal gold] [--status executed|failed|started]
//   npm run sim -- price gold 4812 | stale gold [--paused]
//   npm run sim -- plan u100 1000 | debit u100 <planId> succeeded|failed [--attempt 2]
//   npm run sim -- security u100 new_device "iPhone 15"
//   npm run sim -- otp u100 482913
//   npm run sim -- device u100 [fcm-token]       (client API)
//   npm run sim -- consent u100                  (client API: opt in to marketing on all channels)
//   npm run sim -- alert u100 gold below 4700    (client API)
//   npm run sim -- scenario                      (full walkthrough)

import { createHmac } from 'node:crypto';
import sql from 'mssql';

const BOOL_FLAGS = new Set(['former', 'paused']);
const argv = process.argv.slice(2);
const pos: string[] = [];
const flags: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) flags[name] = 'true';
    else flags[name] = argv[++i] ?? '';
  } else pos.push(a);
}

const API = process.env.SIM_API ?? `http://localhost:${process.env.API_PORT ?? 3000}`;
const SECRET = process.env.CLIENT_API_HMAC_SECRET ?? 'dev-client-secret';

let pool: sql.ConnectionPool | undefined;
async function q(text: string, params: Record<string, unknown> = {}) {
  pool ??= await new sql.ConnectionPool(process.env.SOURCE_MSSQL_URL!).connect();
  const r = pool.request();
  for (const [k, v] of Object.entries(params)) r.input(k, v as never);
  return r.query(text);
}

async function clientApi(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET).update(`${ts}.${method}.${path}.${raw}`).digest('hex');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-cep-timestamp': ts, 'x-cep-signature': sig, ...(raw ? { 'content-type': 'application/json' } : {}) },
    body: raw || undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Actions ─────────────────────────────────────────────────────────────────

async function register(id: string, o: { name?: string; phone?: string; email?: string; lang?: string; source?: string; former?: boolean } = {}) {
  await q(
    `INSERT INTO dbo.Users (Id, FullName, Phone, Email, Language, Source, IsFormerInstalment) VALUES (@id, @name, @phone, @email, @lang, @source, @former)`,
    {
      id,
      name: o.name ?? `Test Client ${id}`,
      phone: o.phone ?? `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      email: o.email ?? `${id}@example.com`,
      lang: o.lang ?? 'ar',
      source: o.source ?? 'organic',
      former: o.former ? 1 : 0,
    },
  );
  await q(`INSERT INTO dbo.Wallets (UserId, CashBalance) VALUES (@id, 0)`, { id });
  return `registered ${id}`;
}

async function kyc(id: string, status: 'submitted' | 'approved' | 'rejected', reason?: string) {
  if (status === 'submitted') await q(`INSERT INTO dbo.KycApplications (UserId, Status) VALUES (@id, 'submitted')`, { id });
  else
    await q(
      `UPDATE dbo.KycApplications SET Status=@s, RejectionReason=@r, UpdatedAt=SYSUTCDATETIME() WHERE Id = (SELECT MAX(Id) FROM dbo.KycApplications WHERE UserId=@id)`,
      { id, s: status, r: status === 'rejected' ? (reason ?? 'The photo of your ID was not clear') : null },
    );
  return `kyc ${status}`;
}

async function cashIn(id: string, amount: number) {
  await q(`INSERT INTO dbo.CashTransactions (UserId, Direction, Amount, Method, Status) VALUES (@id, 'in', @a, 'instapay', 'settled')`, { id, a: amount });
  await q(`UPDATE dbo.Wallets SET CashBalance = CashBalance + @a WHERE UserId=@id`, { id, a: amount });
  return `cash in ${amount}`;
}

async function order(id: string, grams: number, o: { metal?: string; status?: string; price?: number } = {}) {
  const metal = o.metal ?? 'gold';
  const status = o.status ?? 'executed';
  const price = o.price ?? (metal === 'silver' ? 61.5 : 4812);
  const ins = await q(
    `INSERT INTO dbo.Orders (UserId, Side, Metal, Grams, PricePerGram, Amount, Status) OUTPUT INSERTED.Id VALUES (@id, 'buy', @m, @g, @p, @a, 'started')`,
    { id, m: metal, g: grams, p: price, a: Math.round(grams * price * 100) / 100 },
  );
  const orderId = ins.recordset[0].Id as number;
  if (status === 'started') return `order ${orderId} started (abandoned)`;
  await sleep(300);
  await q(`UPDATE dbo.Orders SET Status='placed', UpdatedAt=SYSUTCDATETIME() WHERE Id=@o`, { o: orderId });
  await sleep(300);
  if (status === 'failed') {
    await q(`UPDATE dbo.Orders SET Status='failed', FailureReason='Insufficient balance', UpdatedAt=SYSUTCDATETIME() WHERE Id=@o`, { o: orderId });
    return `order ${orderId} failed`;
  }
  await q(
    `MERGE dbo.Holdings AS t USING (SELECT @id AS UserId, @m AS Metal) s ON t.UserId=s.UserId AND t.Metal=s.Metal
     WHEN MATCHED THEN UPDATE SET Grams = t.Grams + @g, UpdatedAt = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (UserId, Metal, Grams) VALUES (@id, @m, @g);`,
    { id, m: metal, g: grams },
  );
  await q(`UPDATE dbo.Orders SET Status='executed', UpdatedAt=SYSUTCDATETIME() WHERE Id=@o`, { o: orderId });
  return `order ${orderId} executed (${grams} g ${metal})`;
}

async function price(metal: string, buy: number) {
  await q(`INSERT INTO dbo.Prices (Metal, BuyPrice, SellPrice) VALUES (@m, @b, @s)`, { m: metal, b: buy, s: Math.round(buy * 0.985 * 100) / 100 });
  return `price ${metal} ${buy}`;
}

async function stale(metal: string, paused: boolean) {
  await q(`INSERT INTO dbo.Prices (Metal, IsStale, TradingPaused) VALUES (@m, 1, @p)`, { m: metal, p: paused ? 1 : 0 });
  return `price feed stale${paused ? ' (trading paused)' : ''}`;
}

async function plan(id: string, amount: number) {
  const r = await q(
    `INSERT INTO dbo.RecurringPlans (UserId, Amount, Metal, DayOfMonth, NextDebitDate) OUTPUT INSERTED.Id VALUES (@id, @a, 'gold', 27, DATEADD(day, 2, CAST(SYSUTCDATETIME() AS date)))`,
    { id, a: amount },
  );
  return `plan ${r.recordset[0].Id} created (next debit in 2 days)`;
}

async function debit(id: string, planId: number, status: string, attempt: number) {
  await q(
    `INSERT INTO dbo.PlanDebits (PlanId, UserId, Amount, Grams, Status, FailureReason, AttemptNo, ConsecutiveMonths) VALUES (@p, @id, 1000, @g, @s, @r, @n, @c)`,
    { p: planId, id, g: status === 'succeeded' ? 0.207 : null, s: status, r: status === 'failed' ? 'Insufficient wallet balance' : null, n: attempt, c: status === 'succeeded' ? 3 : null },
  );
  return `debit ${status}`;
}

const device = (id: string, token?: string) => clientApi('POST', `/v1/clients/${id}/devices`, { token: token ?? `sim-token-${id}-${Date.now()}`, platform: 'android' });
const consent = (id: string) =>
  clientApi('POST', `/v1/clients/${id}/consents/registration`, {
    emailMarketing: true,
    smsMarketing: true,
    pushPromotions: true,
    priceDailyPush: true,
    marketResearchEmail: true,
    feedback: true,
    wordingVersion: 'reg-2026-09',
    wordingText: 'I agree to receive offers and updates from mngm by the channels I selected.',
  });
const alert = (id: string, metal: string, direction: string, level: number) => clientApi('POST', `/v1/clients/${id}/price-alerts`, { metal, direction, level });

async function scenario() {
  const id = `sim${Date.now().toString().slice(-6)}`;
  const step = async (label: string, fn: () => Promise<unknown>, wait = 4000) => {
    console.log(`→ ${label}`);
    const r = await fn();
    if (r) console.log(`   ${typeof r === 'string' ? r : JSON.stringify(r).slice(0, 140)}`);
    await sleep(wait);
  };
  await step('price ticks', async () => `${await price('gold', 4800)}; ${await price('silver', 61.5)}`, 2000);
  await step(`register ${id}`, () => register(id, { name: 'Mona Ali', lang: 'ar' }), 5000);
  await step('register push device', () => device(id), 300);
  await step('marketing consent', () => consent(id), 300);
  await step('eKYC submitted', () => kyc(id, 'submitted'));
  await step('eKYC approved', () => kyc(id, 'approved'));
  await step('cash in EGP 5000', () => cashIn(id, 5000));
  await step('buy 1.2 g gold', () => order(id, 1.2), 6000);
  await step('price alert: gold below 4700', () => alert(id, 'gold', 'below', 4700), 300);
  await step('gold drops to 4650', () => price('gold', 4650));
  console.log(`\nDone. Console → Clients → ${id} shows the events, messages and journeys.`);
  return id;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const [cmd, a1, a2, a3, a4] = pos;
const id = a1!;
const run: Record<string, () => Promise<unknown>> = {
  register: () => register(id, { name: flags.name, phone: flags.phone, email: flags.email, lang: flags.lang, source: flags.source, former: !!flags.former }),
  'kyc-submit': () => kyc(id, 'submitted'),
  'kyc-approve': () => kyc(id, 'approved'),
  'kyc-reject': () => kyc(id, 'rejected', a2),
  'cash-in': () => cashIn(id, Number(a2 ?? 1000)),
  order: () => order(id, Number(a2 ?? 1), { metal: flags.metal, status: flags.status, price: flags.price ? Number(flags.price) : undefined }),
  price: () => price(a1 ?? 'gold', Number(a2 ?? 4812)),
  stale: () => stale(a1 ?? 'gold', !!flags.paused),
  plan: () => plan(id, Number(a2 ?? 1000)),
  debit: () => debit(id, Number(a2), a3 ?? 'failed', Number(flags.attempt ?? 1)),
  security: async () => {
    await q(`INSERT INTO dbo.SecurityEvents (UserId, Type, Device) VALUES (@id, @t, @d)`, { id, t: a2 ?? 'new_device', d: a3 ?? 'Samsung S24' });
    return 'security event';
  },
  otp: async () => {
    await q(`INSERT INTO dbo.OtpRequests (UserId, Phone, Code, Purpose) SELECT Id, Phone, @c, 'login' FROM dbo.Users WHERE Id=@id`, { id, c: a2 ?? '482913' });
    return 'otp requested';
  },
  device: () => device(id, a2),
  consent: () => consent(id),
  alert: () => alert(id, a2 ?? 'gold', a3 ?? 'below', Number(a4 ?? 4700)),
  scenario,
};

const fn = cmd ? run[cmd] : undefined;
if (!fn) {
  console.log(`Usage: npm run sim -- <${Object.keys(run).join('|')}> ...`);
  process.exit(1);
}
fn()
  .then((r) => {
    if (r && cmd !== 'scenario') console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  })
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool?.close());
