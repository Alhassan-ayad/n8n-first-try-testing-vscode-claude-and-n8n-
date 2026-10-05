// Monthly holdings and cash statement (plan §5.1) — PDF attached to email,
// mirrored in the in-app inbox. The PDF is laid out in English with figures;
// the covering email is in the client's language. (Arabic PDF layout needs an
// Arabic shaping engine; drop an Arabic TTF into assets/ and set
// STATEMENT_AR_FONT to enable Arabic labels.)

import PDFDocument from 'pdfkit';
import { cairo } from '@cep/core';
import { getHoldings, getOrdersBetween, type StatementOrder } from '@cep/cdc';
import type { Client } from '@cep/db';
import { latestPrice } from './clients';

export interface StatementData {
  client: Pick<Client, 'fullName' | 'externalId'>;
  periodLabel: string;
  from: Date;
  to: Date;
  gold: number;
  silver: number;
  cash: number;
  goldPrice: number;
  silverPrice: number;
  orders: StatementOrder[];
}

export async function buildStatementData(client: Client, monthStart: Date, monthEnd: Date): Promise<StatementData> {
  const [h, orders, gp, sp] = await Promise.all([
    getHoldings(client.externalId),
    getOrdersBetween(client.externalId, monthStart, monthEnd),
    latestPrice('gold'),
    latestPrice('silver'),
  ]);
  return {
    client,
    periodLabel: cairo(monthStart).toFormat('MMMM yyyy'),
    from: monthStart,
    to: monthEnd,
    gold: h.gold,
    silver: h.silver,
    cash: h.cash,
    goldPrice: gp ?? 0,
    silverPrice: sp ?? 0,
    orders,
  };
}

const f = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export function renderStatementPdf(d: StatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `mngm statement ${d.periodLabel}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor('#1d1a14').fontSize(22).text('mngm', { continued: true }).fillColor('#8a6d1f').fontSize(12).text('   Monthly statement');
    doc.moveDown(0.5).fillColor('#1d1a14').fontSize(10);
    doc.text(`Client: ${d.client.fullName ?? ''}  (ID ${d.client.externalId})`);
    doc.text(`Period: ${d.periodLabel}`);
    doc.text(`Generated: ${cairo(new Date()).toFormat('d LLL yyyy HH:mm')} Cairo`);
    doc.moveDown();

    const goldValue = d.gold * d.goldPrice;
    const silverValue = d.silver * d.silverPrice;
    doc.fontSize(13).text('Holdings', { underline: true }).moveDown(0.3).fontSize(10);
    doc.text(`Gold: ${f(d.gold, 3)} g  × EGP ${f(d.goldPrice)} = EGP ${f(goldValue)}`);
    doc.text(`Silver: ${f(d.silver, 3)} g  × EGP ${f(d.silverPrice)} = EGP ${f(silverValue)}`);
    doc.text(`Cash balance: EGP ${f(d.cash)}`);
    doc.font('Helvetica-Bold').text(`Total: EGP ${f(goldValue + silverValue + d.cash)}`).font('Helvetica');
    doc.moveDown();

    doc.fontSize(13).text('Executed orders this period', { underline: true }).moveDown(0.3).fontSize(9);
    if (!d.orders.length) doc.text('No orders in this period.');
    for (const o of d.orders) {
      doc.text(
        `${cairo(new Date(o.UpdatedAt)).toFormat('dd LLL')}  ${o.Side.toUpperCase().padEnd(4)}  ${o.Metal.padEnd(6)}  ${f(Number(o.Grams), 3)} g  @ EGP ${f(Number(o.PricePerGram))}  =  EGP ${f(Number(o.Amount))}`,
      );
    }
    const buys = d.orders.filter((o) => o.Side === 'buy');
    const grams = buys.reduce((a, o) => a + Number(o.Grams), 0);
    if (grams > 0) {
      const avg = buys.reduce((a, o) => a + Number(o.Amount), 0) / grams;
      doc.moveDown(0.5).fontSize(10).text(`Average cost per gram this period: EGP ${f(avg)}`);
    }

    doc.moveDown(2).fontSize(8).fillColor('#6b6b6b');
    doc.text(
      'Valuations use the mngm buy price at the time this statement was generated. Prices move continuously; past performance is not an indication of future results. Your metal is physically backed and held in insured vault storage.',
    );
    doc.end();
  });
}
