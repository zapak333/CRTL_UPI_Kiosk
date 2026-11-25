import { formatINR, toPaise } from '../../lib/money.js';
import { istDisplayDate, istDisplayTime } from '../../lib/time.js';
import type { Settings } from '../settings.js';
import { EscPos, toAscii } from './escpos.js';

export interface ReceiptData {
  kind: 'ORIGINAL' | 'REPRINT' | 'TEST';
  orderNumber: string;
  token: string;
  paidAt: Date;
  items: { name: string; quantity: number; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  tax: string;
  taxLabel: string | null;
  taxRate: string | null;
  total: string;
  transactionId: string;
  paymentStatus: string;
}

const rs = (v: string) => formatINR(toPaise(v), 'Rs.');

function pad(l: string, r: string, w: number) {
  const space = Math.max(1, w - l.length - r.length);
  return l + ' '.repeat(space) + r;
}

/** Receipt as plain text lines (used for the file/mock printer, preview and the ESC/POS body). */
export function receiptLines(d: ReceiptData, s: Settings, width: number) {
  const hr = '-'.repeat(width);
  const center = (t: string) => {
    const x = toAscii(t).slice(0, width);
    return ' '.repeat(Math.max(0, Math.floor((width - x.length) / 2))) + x;
  };
  const L: { t: string; style?: 'title' | 'big' | 'bold' }[] = [];
  L.push({ t: center(s.canteen_name.toUpperCase()), style: 'title' });
  if (s.institution_name) L.push({ t: center(s.institution_name.toUpperCase()) });
  if (s.address) for (const a of s.address.split('\n')) L.push({ t: center(a) });
  if (s.contact_phone) L.push({ t: center('Ph: ' + s.contact_phone) });
  if (s.tax_enabled && s.tax_registration_no) L.push({ t: center(`${s.tax_label} No: ${s.tax_registration_no}`) });
  if (d.kind === 'REPRINT') L.push({ t: center('*** DUPLICATE COPY ***'), style: 'bold' });
  if (d.kind === 'TEST') L.push({ t: center('*** TEST PRINT - NOT A BILL ***'), style: 'bold' });
  L.push({ t: hr });
  L.push({ t: center(`ORDER TOKEN: #${d.token}`), style: 'big' });
  L.push({ t: `Order No: ${d.orderNumber}` });
  L.push({ t: pad(`Date: ${istDisplayDate(d.paidAt)}`, `Time: ${istDisplayTime(d.paidAt)}`, width) });
  L.push({ t: hr });
  const qtyW = 5;
  const amtW = 12;
  const nameW = width - qtyW - amtW;
  L.push({ t: 'ITEM'.padEnd(nameW) + 'QTY'.padStart(qtyW) + 'AMOUNT'.padStart(amtW), style: 'bold' });
  for (const it of d.items) {
    const name = toAscii(it.name);
    const first = name.slice(0, nameW - 1);
    L.push({ t: first.padEnd(nameW) + String(it.quantity).padStart(qtyW) + rs(it.lineTotal).padStart(amtW) });
    let rest = name.slice(nameW - 1);
    while (rest) {
      L.push({ t: '  ' + rest.slice(0, nameW - 3) });
      rest = rest.slice(nameW - 3);
    }
    if (it.quantity > 1) L.push({ t: `  @ ${rs(it.unitPrice)} each` });
  }
  L.push({ t: hr });
  if (toPaise(d.tax) > 0) {
    L.push({ t: pad('Subtotal:', rs(d.subtotal), width) });
    L.push({ t: pad(`${d.taxLabel ?? 'Tax'} (${Number(d.taxRate ?? 0)}%)${s.tax_mode === 'inclusive' ? ' incl.' : ''}:`, rs(d.tax), width) });
  }
  L.push({ t: pad('TOTAL AMOUNT:', rs(d.total), width), style: 'bold' });
  L.push({ t: '' });
  L.push({ t: 'Payment Mode: UPI' });
  L.push({ t: `Payment Status: ${d.paymentStatus}` });
  L.push({ t: `Transaction ID: ${d.transactionId}` });
  L.push({ t: hr });
  for (const f of (s.receipt_footer || '').split('\n')) L.push({ t: center(f), style: 'bold' });
  L.push({ t: hr });
  return L;
}

export function receiptText(d: ReceiptData, s: Settings, width: number) {
  return receiptLines(d, s, width).map((l) => l.t).join('\n') + '\n';
}

export function receiptEscPos(d: ReceiptData, s: Settings, width: number, opts: { cut: boolean; drawer: boolean }) {
  const p = new EscPos();
  for (const l of receiptLines(d, s, width)) {
    if (l.style === 'title') p.align('center').bold(true).size(2, 2).line(l.t.trim()).size(1, 1).bold(false).align('left');
    else if (l.style === 'big') p.align('center').bold(true).size(2, 2).line(l.t.trim()).size(1, 1).bold(false).align('left');
    else if (l.style === 'bold') p.bold(true).line(l.t).bold(false);
    else p.line(l.t);
  }
  p.feed(4);
  if (opts.cut) p.cut();
  if (opts.drawer) p.drawer();
  return p.build();
}
