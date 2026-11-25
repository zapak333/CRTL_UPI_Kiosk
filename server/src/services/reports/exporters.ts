import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatINR, toPaise } from '../../lib/money.js';
import { getSettings } from '../settings.js';
import { fullReport } from './reports.js';

type Report = Awaited<ReturnType<typeof fullReport>>;
export type CsvKind = 'summary' | 'items' | 'daily' | 'transactions' | 'failures' | 'refunds';

const here = path.dirname(fileURLToPath(import.meta.url));
function fontPath(name: string) {
  const c = [path.join(here, '../../../assets/fonts', name), path.join(here, '../../../../assets/fonts', name)];
  return c.find((p) => fs.existsSync(p))!;
}

const istTs = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const num = (v: string) => toPaise(v) / 100;

function title(r: Report) {
  return r.summary.from === r.summary.to ? `Sales Report - ${r.summary.from}` : `Sales Report - ${r.summary.from} to ${r.summary.to}`;
}

function summaryRows(r: Report): [string, string | number][] {
  const s = r.summary;
  return [
    ['Total orders (paid)', s.totalOrders],
    ['Total quantity of items sold', s.totalItemsSold],
    ['Successful UPI transactions', s.successfulTransactions],
    ['Total UPI collection (Rs.)', num(s.totalCollection)],
    ['Failed payments', s.failedPayments],
    ['Pending payments', s.pendingPayments],
    ['Expired payment QRs', s.expiredPayments],
    ['Cancelled orders', s.cancelledOrders],
    ['Refunds (count)', s.refundCount],
    ['Total refunds (Rs.)', num(s.totalRefunds)],
    ['NET COLLECTION (Rs.)', num(s.netCollection)],
  ];
}

// ---------------- CSV ----------------
function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : v instanceof Date ? istTs(v) : String(v);
  // Neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(r: Report, kind: CsvKind) {
  let header: string[] = [];
  let rows: unknown[][] = [];
  switch (kind) {
    case 'summary':
      header = ['Metric', 'Value'];
      rows = summaryRows(r);
      break;
    case 'items':
      header = ['Food Item', 'Category', 'Quantity Sold', 'Unit Price', 'Total Amount'];
      rows = r.items.map((i) => [i.item, i.category, i.quantity, i.unitPrice, i.total]);
      break;
    case 'daily':
      header = ['Date', 'Orders', 'Items Sold', 'Transactions', 'Collection', 'Refunds', 'Net'];
      rows = r.daily.map((d) => [d.date, d.orders, d.items, d.txns, d.collection, d.refunds, d.net]);
      break;
    case 'transactions':
    case 'failures': {
      const list = kind === 'failures' ? r.failures : r.transactions;
      header = ['Created', 'Order No', 'Token', 'Our Ref', 'Gateway Payment ID', 'Bank RRN', 'Amount', 'Received', 'Status', 'Failure Reason', 'Verified Via', 'Verified At'];
      rows = list.map((t: any) => [t.created_at, t.order_number, t.token_number, t.attempt_ref, t.provider_payment_ref, t.bank_rrn, t.amount, t.amount_received, t.status, t.failure_reason, t.verified_via, t.verified_at]);
      break;
    }
    case 'refunds':
      header = ['Created', 'Order No', 'Token', 'Amount', 'Reason', 'Status', 'Refund Ref', 'Payment ID', 'Requested By', 'Completed At'];
      rows = r.refunds.map((x: any) => [x.created_at, x.order_number, x.token_number, x.amount, x.reason, x.status, x.provider_refund_ref, x.provider_payment_ref, x.requested_by, x.completed_at]);
      break;
  }
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------------- XLSX ----------------
export async function toXlsx(r: Report): Promise<Buffer> {
  const s = await getSettings();
  const wb = new ExcelJS.Workbook();
  wb.creator = s.canteen_name;
  wb.created = new Date();
  const money = '"₹"#,##0.00';

  const sum = wb.addWorksheet('Summary');
  sum.addRow([s.canteen_name]).font = { bold: true, size: 14 };
  sum.addRow([s.institution_name]);
  sum.addRow([title(r)]).font = { bold: true };
  sum.addRow([`Generated: ${istTs(new Date())} IST`]);
  sum.addRow([]);
  for (const [k, v] of summaryRows(r)) {
    const row = sum.addRow([k, v]);
    if (k.includes('Rs.')) row.getCell(2).numFmt = money;
    if (k.startsWith('NET')) row.font = { bold: true };
  }
  sum.getColumn(1).width = 34;
  sum.getColumn(2).width = 18;

  const addTable = (name: string, cols: { header: string; key: string; width: number; money?: boolean }[], data: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    for (const d of data) ws.addRow(d);
    cols.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = money;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  };

  const items = addTable('Item-wise', [
    { header: 'Food Item', key: 'item', width: 28 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Quantity Sold', key: 'quantity', width: 14 },
    { header: 'Unit Price', key: 'unitPrice', width: 14, money: true },
    { header: 'Total Amount', key: 'total', width: 16, money: true },
  ], r.items.map((i) => ({ ...i, unitPrice: num(i.unitPrice), total: num(i.total) })));
  if (r.items.length) {
    const t = items.addRow({ item: 'TOTAL', quantity: r.items.reduce((a, b) => a + b.quantity, 0), total: r.items.reduce((a, b) => a + num(b.total), 0) });
    t.font = { bold: true };
  }

  addTable('Daily', [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Orders', key: 'orders', width: 10 },
    { header: 'Items Sold', key: 'items', width: 12 },
    { header: 'Transactions', key: 'txns', width: 14 },
    { header: 'Collection', key: 'collection', width: 14, money: true },
    { header: 'Refunds', key: 'refunds', width: 12, money: true },
    { header: 'Net', key: 'net', width: 14, money: true },
  ], r.daily.map((d) => ({ ...d, collection: num(d.collection), refunds: num(d.refunds), net: num(d.net) })));

  const txCols = [
    { header: 'Created (IST)', key: 'created', width: 20 },
    { header: 'Order No', key: 'order_number', width: 24 },
    { header: 'Token', key: 'token_number', width: 8 },
    { header: 'Our Ref', key: 'attempt_ref', width: 22 },
    { header: 'Gateway Payment ID', key: 'provider_payment_ref', width: 24 },
    { header: 'Bank RRN', key: 'bank_rrn', width: 16 },
    { header: 'Amount', key: 'amount', width: 12, money: true },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Failure Reason', key: 'failure_reason', width: 36 },
    { header: 'Verified Via', key: 'verified_via', width: 12 },
  ];
  const tx = (l: any[]) => l.map((t) => ({ ...t, created: istTs(t.created_at), amount: num(t.amount) }));
  addTable('Transactions', txCols, tx(r.transactions));
  addTable('Payment Failures', txCols, tx(r.failures));
  addTable('Refunds', [
    { header: 'Created (IST)', key: 'created', width: 20 },
    { header: 'Order No', key: 'order_number', width: 24 },
    { header: 'Amount', key: 'amount', width: 12, money: true },
    { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Refund Ref', key: 'provider_refund_ref', width: 22 },
    { header: 'Requested By', key: 'requested_by', width: 14 },
  ], r.refunds.map((x: any) => ({ ...x, created: istTs(x.created_at), amount: num(x.amount) })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------- PDF ----------------
export async function toPdf(r: Report): Promise<Buffer> {
  const s = await getSettings();
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title(r), Author: s.canteen_name } });
  doc.registerFont('body', fontPath('DejaVuSans.ttf'));
  doc.registerFont('bold', fontPath('DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const inr = (v: string) => formatINR(toPaise(v));
  const W = doc.page.width - 80;

  doc.font('bold').fontSize(16).fillColor('#1e3a8a').text(s.canteen_name, { align: 'center' });
  doc.font('body').fontSize(10).fillColor('#333').text(s.institution_name, { align: 'center' });
  doc.moveDown(0.5).font('bold').fontSize(13).fillColor('#000').text(title(r), { align: 'center' });
  doc.font('body').fontSize(8).fillColor('#666').text(`Generated ${istTs(new Date())} IST`, { align: 'center' });
  doc.moveDown();

  const table = (heading: string, cols: { h: string; w: number; align?: 'left' | 'right' }[], rows: string[][], boldLast = false) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font('bold').fontSize(11).fillColor('#1e3a8a').text(heading, 40);
    doc.moveDown(0.3);
    const total = cols.reduce((a, c) => a + c.w, 0);
    const scale = W / total;
    const drawRow = (cells: string[], header: boolean, bold: boolean) => {
      const y = doc.y;
      if (header) doc.rect(40, y - 2, W, 16).fill('#1e3a8a');
      let x = 40;
      doc.font(header || bold ? 'bold' : 'body').fontSize(8.5).fillColor(header ? '#fff' : '#000');
      let h = 0;
      cells.forEach((c, i) => {
        const w = cols[i].w * scale;
        doc.text(c, x + 3, y, { width: w - 6, align: cols[i].align ?? 'left' });
        h = Math.max(h, doc.y - y);
        x += w;
      });
      doc.y = y + Math.max(h, 12) + 3;
      if (!header) doc.moveTo(40, doc.y - 2).lineTo(40 + W, doc.y - 2).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
      }
    };
    drawRow(cols.map((c) => c.h), true, false);
    if (!rows.length) drawRow(['No records', ...cols.slice(1).map(() => '')], false, false);
    rows.forEach((row, i) => drawRow(row, false, boldLast && i === rows.length - 1));
    doc.moveDown(0.8);
  };

  table('Financial Summary', [{ h: 'Metric', w: 3 }, { h: 'Value', w: 1.4, align: 'right' }],
    summaryRows(r).map(([k, v]) => [k.replace(' (Rs.)', ''), k.includes('Rs.') ? formatINR(Math.round(Number(v) * 100)) : String(v)]), true);

  const itemRows = r.items.map((i) => [i.item, String(i.quantity), inr(i.unitPrice), inr(i.total)]);
  if (itemRows.length) itemRows.push(['TOTAL', String(r.items.reduce((a, b) => a + b.quantity, 0)), '', formatINR(r.items.reduce((a, b) => a + toPaise(b.total), 0))]);
  table('Item-wise Sales', [{ h: 'Food Item', w: 3 }, { h: 'Quantity Sold', w: 1.2, align: 'right' }, { h: 'Unit Price', w: 1.2, align: 'right' }, { h: 'Total Amount', w: 1.4, align: 'right' }], itemRows, itemRows.length > 0);

  if (r.daily.length > 1)
    table('Day-wise Sales', [{ h: 'Date', w: 1.3 }, { h: 'Orders', w: 1, align: 'right' }, { h: 'Items', w: 1, align: 'right' }, { h: 'Collection', w: 1.4, align: 'right' }, { h: 'Refunds', w: 1.2, align: 'right' }, { h: 'Net', w: 1.4, align: 'right' }],
      r.daily.map((d) => [d.date, String(d.orders), String(d.items), inr(d.collection), inr(d.refunds), inr(d.net)]));

  const txRow = (t: any) => [istTs(t.created_at), t.order_number, t.token_number ? String(t.token_number) : '-', t.bank_rrn ?? t.provider_payment_ref ?? t.attempt_ref, inr(t.amount), t.status];
  const txCols = [{ h: 'Time', w: 1.6 }, { h: 'Order No', w: 2.1 }, { h: 'Token', w: 0.6 }, { h: 'Txn Ref', w: 2 }, { h: 'Amount', w: 1, align: 'right' as const }, { h: 'Status', w: 1 }];
  table('Payment Failures', txCols, r.failures.map(txRow));
  table('Refunds', [{ h: 'Time', w: 1.6 }, { h: 'Order No', w: 2.1 }, { h: 'Amount', w: 1, align: 'right' }, { h: 'Reason', w: 2.2 }, { h: 'Status', w: 1 }],
    r.refunds.map((x: any) => [istTs(x.created_at), x.order_number, inr(x.amount), x.reason, x.status]));
  if (r.transactions.length <= 400) table('All Transactions', txCols, r.transactions.map(txRow));
  else doc.font('body').fontSize(9).text(`${r.transactions.length} transactions - see the Excel/CSV export for the full list.`);

  doc.end();
  return done;
}
