import { pool } from '../../db/pool.js';
import { audit, systemActor, type Actor } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { getSettings } from '../settings.js';
import { sendToPrinter, type PrinterSettings } from './drivers.js';
import { receiptEscPos, receiptText, type ReceiptData } from './receipt.js';

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const { rows } = await pool.query('SELECT * FROM printer_settings WHERE id = 1');
  return rows[0];
}

/** Build receipt data for an order. Refuses for anything that is not a verified, paid order. */
export async function buildReceiptData(orderId: number, kind: 'ORIGINAL' | 'REPRINT'): Promise<ReceiptData> {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  const { rows: pays } = await pool.query(
    `SELECT * FROM payments WHERE order_id = $1 AND status IN ('SUCCESS','REFUNDED','PARTIALLY_REFUNDED') AND verified_at IS NOT NULL ORDER BY verified_at LIMIT 1`,
    [orderId],
  );
  const p = pays[0];
  if (!p || !o.token_number || !['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(o.status))
    throw conflict('Receipt can only be printed for orders with a verified payment');
  const { rows: items } = await pool.query('SELECT item_name, quantity, unit_price, line_total FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  const s = await getSettings();
  return {
    kind,
    orderNumber: o.order_number,
    token: `${s.token_prefix}${String(o.token_number).padStart(s.token_digits, '0')}`,
    paidAt: new Date(o.paid_at),
    items: items.map((i) => ({ name: i.item_name, quantity: i.quantity, unitPrice: i.unit_price, lineTotal: i.line_total })),
    subtotal: o.subtotal_amount,
    tax: o.tax_amount,
    taxLabel: o.tax_label,
    taxRate: o.tax_rate,
    total: o.total_amount,
    transactionId: p.bank_rrn ?? p.provider_payment_ref,
    paymentStatus: p.status === 'SUCCESS' ? 'SUCCESSFUL' : p.status,
  };
}

const running = new Set<number>();

/** Fire-and-forget: print a job in the background (the payment response never waits on the printer). */
export function schedulePrint(jobId: number) {
  setImmediate(() => {
    processPrintJob(jobId).catch((e) => console.error('[print] job', jobId, e));
  });
}

export async function processPrintJob(jobId: number, actor: Actor = systemActor) {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    const { rows } = await pool.query(
      `UPDATE print_jobs SET status='PRINTING', attempts=attempts+1, updated_at=now()
        WHERE id=$1 AND status IN ('PENDING','FAILED') RETURNING *`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return; // already printed or in progress
    try {
      const ps = await getPrinterSettings();
      const s = await getSettings();
      const data = await buildReceiptData(job.order_id, job.kind === 'REPRINT' ? 'REPRINT' : 'ORIGINAL');
      const bytes = receiptEscPos(data, s, ps.chars_per_line, { cut: ps.cut_paper, drawer: ps.open_drawer && job.kind === 'ORIGINAL' });
      const text = receiptText(data, s, ps.chars_per_line);
      await sendToPrinter(ps, bytes, text, `${data.orderNumber}_${job.kind.toLowerCase()}_${job.id}`);
      await pool.query(`UPDATE print_jobs SET status='PRINTED', printed_at=now(), last_error=NULL, updated_at=now() WHERE id=$1`, [jobId]);
      await pool.query(`UPDATE orders SET print_status='PRINTED', updated_at=now() WHERE id=$1`, [job.order_id]);
      await audit(actor, job.kind === 'ORIGINAL' ? 'print.original' : 'print.reprint', 'order', job.order_id, { jobId });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      await pool.query(`UPDATE print_jobs SET status='FAILED', last_error=$2, updated_at=now() WHERE id=$1`, [jobId, msg]);
      // A failed reprint does not change the status of an original ticket that already printed.
      await pool.query(`UPDATE orders SET print_status='FAILED', updated_at=now() WHERE id=$1 AND print_status <> 'PRINTED'`, [job.order_id]);
      await audit(actor, 'print.failed', 'order', job.order_id, { jobId, error: msg });
    }
  } finally {
    running.delete(jobId);
  }
}

/**
 * Admin "print / reprint". If the original ticket never printed, retry the original job (so the
 * ticket is not marked duplicate). Otherwise create a REPRINT job marked "DUPLICATE COPY".
 */
export async function requestReprint(orderId: number, actor: Actor) {
  await buildReceiptData(orderId, 'REPRINT'); // validates order is paid & verified
  const { rows: orig } = await pool.query(`SELECT id, status FROM print_jobs WHERE order_id=$1 AND kind='ORIGINAL'`, [orderId]);
  let jobId: number;
  if (!orig[0]) {
    const { rows } = await pool.query(`INSERT INTO print_jobs (order_id, kind, requested_by) VALUES ($1,'ORIGINAL',$2) ON CONFLICT DO NOTHING RETURNING id`, [orderId, actor.id ?? null]);
    jobId = rows[0]?.id ?? (await pool.query(`SELECT id FROM print_jobs WHERE order_id=$1 AND kind='ORIGINAL'`, [orderId])).rows[0].id;
  } else if (orig[0].status === 'FAILED' || orig[0].status === 'PENDING') {
    jobId = orig[0].id;
  } else {
    const { rows } = await pool.query(`INSERT INTO print_jobs (order_id, kind, requested_by) VALUES ($1,'REPRINT',$2) RETURNING id`, [orderId, actor.id ?? null]);
    jobId = rows[0].id;
  }
  await audit(actor, 'print.requested', 'order', orderId, { jobId });
  await processPrintJob(jobId, actor);
  const { rows } = await pool.query('SELECT id, kind, status, last_error FROM print_jobs WHERE id=$1', [jobId]);
  return rows[0];
}

export async function testPrint(actor: Actor) {
  const ps = await getPrinterSettings();
  const s = await getSettings();
  const data: ReceiptData = {
    kind: 'TEST',
    orderNumber: 'TEST',
    token: '00000',
    paidAt: new Date(),
    items: [
      { name: 'Tea', quantity: 2, unitPrice: '10.00', lineTotal: '20.00' },
      { name: 'Veg Sandwich', quantity: 1, unitPrice: '80.00', lineTotal: '80.00' },
    ],
    subtotal: '100.00', tax: '0.00', taxLabel: null, taxRate: null, total: '100.00',
    transactionId: 'TEST-NOT-A-PAYMENT',
    paymentStatus: 'TEST',
  };
  const { rows } = await pool.query(`INSERT INTO print_jobs (kind, status, requested_by, attempts) VALUES ('TEST','PRINTING',$1,1) RETURNING id`, [actor.id ?? null]);
  const id = rows[0].id;
  try {
    await sendToPrinter(ps, receiptEscPos(data, s, ps.chars_per_line, { cut: ps.cut_paper, drawer: false }), receiptText(data, s, ps.chars_per_line), `test_${id}`);
    await pool.query(`UPDATE print_jobs SET status='PRINTED', printed_at=now() WHERE id=$1`, [id]);
    await audit(actor, 'print.test', 'printer', 1, { ok: true });
    return { ok: true, preview: receiptText(data, s, ps.chars_per_line) };
  } catch (e) {
    await pool.query(`UPDATE print_jobs SET status='FAILED', last_error=$2 WHERE id=$1`, [id, (e as Error).message]);
    await audit(actor, 'print.test', 'printer', 1, { ok: false, error: (e as Error).message });
    return { ok: false, error: (e as Error).message, preview: receiptText(data, s, ps.chars_per_line) };
  }
}

export async function receiptPreview(orderId: number) {
  const ps = await getPrinterSettings();
  const s = await getSettings();
  const data = await buildReceiptData(orderId, 'REPRINT');
  data.kind = 'ORIGINAL';
  return receiptText(data, s, ps.chars_per_line);
}
