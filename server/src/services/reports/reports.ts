import { pool, type Db } from '../../db/pool.js';
import { audit, type Actor } from '../../lib/audit.js';
import { fromPaise, toPaise } from '../../lib/money.js';
import { addDays, istDate } from '../../lib/time.js';

const PAID = `('PAID','REFUNDED','PARTIALLY_REFUNDED')`;
const CAPTURED = `('SUCCESS','REFUNDED','PARTIALLY_REFUNDED')`;
const IST = `'Asia/Kolkata'`;

export interface Summary {
  from: string;
  to: string;
  totalOrders: number; // paid (completed) orders
  totalItemsSold: number;
  successfulTransactions: number;
  totalCollection: string; // captured UPI payments
  failedPayments: number;
  pendingPayments: number;
  expiredPayments: number;
  cancelledOrders: number;
  refundCount: number;
  totalRefunds: string; // completed refunds
  netCollection: string; // collection - refunds
  averageOrderValue: string;
  needsAttention: number;
}

/**
 * Financial summary for an IST date range (inclusive).
 * - Revenue counts ONLY payments verified as captured (SUCCESS/REFUNDED/PARTIALLY_REFUNDED), by verification date.
 * - Pending and failed payments are counted but never included in money totals.
 * - Net = captured - completed refunds (refunds by completion date).
 */
export async function summary(from: string, to: string, db: Db = pool): Promise<Summary> {
  const q = async (sql: string) => (await db.query(sql, [from, to])).rows[0];
  const orders = await q(`SELECT count(*)::int AS n FROM orders WHERE status IN ${PAID} AND business_date BETWEEN $1 AND $2`);
  const items = await q(
    `SELECT coalesce(sum(oi.quantity),0)::int AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} AND o.business_date BETWEEN $1 AND $2`,
  );
  const cap = await q(
    `SELECT count(*)::int AS n, coalesce(sum(amount_received),0)::text AS amt FROM payments
      WHERE status IN ${CAPTURED} AND (verified_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2`,
  );
  const pstat = await q(
    `SELECT count(*) FILTER (WHERE status='FAILED')::int AS failed,
            count(*) FILTER (WHERE status='PENDING')::int AS pending,
            count(*) FILTER (WHERE status='EXPIRED')::int AS expired
       FROM payments WHERE (created_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2`,
  );
  const canc = await q(`SELECT count(*)::int AS n FROM orders WHERE status = 'CANCELLED' AND business_date BETWEEN $1 AND $2`);
  const ref = await q(
    `SELECT count(*)::int AS n, coalesce(sum(amount),0)::text AS amt FROM refunds
      WHERE status='COMPLETED' AND (completed_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2`,
  );
  const att = await q(`SELECT count(*)::int AS n FROM orders WHERE needs_attention AND business_date BETWEEN $1 AND $2`);
  const collected = toPaise(cap.amt);
  const refunds = toPaise(ref.amt);
  return {
    from,
    to,
    totalOrders: orders.n,
    totalItemsSold: items.n,
    successfulTransactions: cap.n,
    totalCollection: fromPaise(collected),
    failedPayments: pstat.failed,
    pendingPayments: pstat.pending,
    expiredPayments: pstat.expired,
    cancelledOrders: canc.n,
    refundCount: ref.n,
    totalRefunds: fromPaise(refunds),
    netCollection: fromPaise(collected - refunds),
    averageOrderValue: fromPaise(cap.n ? Math.round(collected / cap.n) : 0),
    needsAttention: att.n,
  };
}

/** Item-wise sales using the price/name snapshot stored with each order (history never changes). */
export async function itemWise(from: string, to: string, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT oi.item_name, oi.category_name, oi.unit_price::text AS unit_price, sum(oi.quantity)::int AS quantity, sum(oi.line_total)::text AS total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} AND o.business_date BETWEEN $1 AND $2
      GROUP BY oi.item_name, oi.category_name, oi.unit_price
      ORDER BY sum(oi.line_total) DESC, oi.item_name`,
    [from, to],
  );
  return rows.map((r) => ({ item: r.item_name, category: r.category_name, quantity: r.quantity, unitPrice: r.unit_price, total: r.total }));
}

export async function categoryWise(from: string, to: string, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT oi.category_name, sum(oi.quantity)::int AS quantity, sum(oi.line_total)::text AS total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} AND o.business_date BETWEEN $1 AND $2
      GROUP BY oi.category_name ORDER BY sum(oi.line_total) DESC`,
    [from, to],
  );
  return rows.map((r) => ({ category: r.category_name || 'Other', quantity: r.quantity, total: r.total }));
}

/** Per-day breakdown for a range (every day present, including zero days). */
export async function dailyBreakdown(from: string, to: string, db: Db = pool) {
  const { rows } = await db.query(
    `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d),
     o AS (SELECT business_date d, count(*)::int n FROM orders WHERE status IN ${PAID} AND business_date BETWEEN $1 AND $2 GROUP BY 1),
     it AS (SELECT o.business_date d, sum(oi.quantity)::int n FROM order_items oi JOIN orders o ON o.id=oi.order_id
             WHERE o.status IN ${PAID} AND o.business_date BETWEEN $1 AND $2 GROUP BY 1),
     p AS (SELECT (verified_at AT TIME ZONE ${IST})::date d, count(*)::int n, sum(amount_received) amt FROM payments
            WHERE status IN ${CAPTURED} AND (verified_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2 GROUP BY 1),
     r AS (SELECT (completed_at AT TIME ZONE ${IST})::date d, sum(amount) amt FROM refunds
            WHERE status='COMPLETED' AND (completed_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2 GROUP BY 1)
     SELECT to_char(days.d,'YYYY-MM-DD') AS date, coalesce(o.n,0) AS orders, coalesce(it.n,0) AS items, coalesce(p.n,0) AS txns,
            coalesce(p.amt,0)::text AS collection, coalesce(r.amt,0)::text AS refunds
       FROM days LEFT JOIN o ON o.d=days.d LEFT JOIN it ON it.d=days.d LEFT JOIN p ON p.d=days.d LEFT JOIN r ON r.d=days.d
      ORDER BY days.d`,
    [from, to],
  );
  return rows.map((r) => ({ ...r, net: fromPaise(toPaise(r.collection) - toPaise(r.refunds)) }));
}

/** Aggregate a breakdown into weeks (Mon-Sun) or months for charts / weekly & monthly reports. */
export async function periodBreakdown(from: string, to: string, unit: 'week' | 'month', db: Db = pool) {
  const { rows } = await db.query(
    `WITH p AS (SELECT date_trunc('${unit}', (verified_at AT TIME ZONE ${IST})::date)::date d, count(*)::int n, sum(amount_received) amt FROM payments
                 WHERE status IN ${CAPTURED} AND (verified_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2 GROUP BY 1),
          r AS (SELECT date_trunc('${unit}', (completed_at AT TIME ZONE ${IST})::date)::date d, sum(amount) amt FROM refunds
                 WHERE status='COMPLETED' AND (completed_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2 GROUP BY 1),
          periods AS (SELECT generate_series(date_trunc('${unit}', $1::date), $2::date, interval '1 ${unit}')::date d)
     SELECT to_char(periods.d,'YYYY-MM-DD') AS period, coalesce(p.n,0) AS txns, coalesce(p.amt,0)::text AS collection, coalesce(r.amt,0)::text AS refunds
       FROM periods LEFT JOIN p ON p.d = periods.d LEFT JOIN r ON r.d = periods.d ORDER BY periods.d`,
    [from, to],
  );
  return rows.map((r) => ({ ...r, net: fromPaise(toPaise(r.collection) - toPaise(r.refunds)) }));
}

export async function transactions(from: string, to: string, status: string | null, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT p.id, p.attempt_ref, p.provider, p.provider_payment_ref, p.bank_rrn, p.amount::text, p.amount_received::text, p.status,
            p.failure_reason, p.verified_via, p.created_at, p.verified_at, o.order_number, o.token_number, o.business_date, o.id AS order_id
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE (p.created_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.status = $3)
      ORDER BY p.created_at DESC LIMIT 5000`,
    [from, to, status],
  );
  return rows;
}

export async function refundList(from: string, to: string, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.amount::text, r.reason, r.status, r.provider_refund_ref, r.failure_reason, r.created_at, r.completed_at,
            o.order_number, o.token_number, o.business_date, p.provider_payment_ref, p.bank_rrn, a.username AS requested_by
       FROM refunds r JOIN orders o ON o.id=r.order_id JOIN payments p ON p.id=r.payment_id LEFT JOIN admin_users a ON a.id=r.requested_by
      WHERE (r.created_at AT TIME ZONE ${IST})::date BETWEEN $1 AND $2
      ORDER BY r.created_at DESC`,
    [from, to],
  );
  return rows;
}

export async function fullReport(from: string, to: string) {
  const [s, items, categories, daily, txns, failures, refunds] = await Promise.all([
    summary(from, to),
    itemWise(from, to),
    categoryWise(from, to),
    dailyBreakdown(from, to),
    transactions(from, to, null),
    transactions(from, to, 'FAILED'),
    refundList(from, to),
  ]);
  return { summary: s, items, categories, daily, transactions: txns, failures, refunds };
}

/** Generate (or regenerate) the stored End-of-Day report for a date. */
export async function generateDailyReport(date: string, generatedBy: string, actor?: Actor) {
  const s = await summary(date, date);
  const items = await itemWise(date, date);
  const categories = await categoryWise(date, date);
  const data = { summary: s, items, categories };
  await pool.query(
    `INSERT INTO daily_reports (report_date, total_orders, total_items_sold, successful_txns, total_collection, failed_payments,
                                pending_payments, cancelled_orders, total_refunds, net_collection, report_data, generated_by, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (report_date) DO UPDATE SET total_orders=EXCLUDED.total_orders, total_items_sold=EXCLUDED.total_items_sold,
       successful_txns=EXCLUDED.successful_txns, total_collection=EXCLUDED.total_collection, failed_payments=EXCLUDED.failed_payments,
       pending_payments=EXCLUDED.pending_payments, cancelled_orders=EXCLUDED.cancelled_orders, total_refunds=EXCLUDED.total_refunds,
       net_collection=EXCLUDED.net_collection, report_data=EXCLUDED.report_data, generated_by=EXCLUDED.generated_by, generated_at=now()`,
    [date, s.totalOrders, s.totalItemsSold, s.successfulTransactions, s.totalCollection, s.failedPayments, s.pendingPayments,
      s.cancelledOrders, s.totalRefunds, s.netCollection, JSON.stringify(data), generatedBy],
  );
  if (actor) await audit(actor, 'report.generated', 'daily_report', date, { generatedBy });
  return data;
}

/** On startup, make sure every day since the first order has a stored EOD report (covers server downtime at 23:59). */
export async function catchUpDailyReports() {
  const { rows } = await pool.query(`SELECT min(business_date) AS d FROM orders`);
  if (!rows[0]?.d) return;
  const yesterday = addDays(istDate(), -1);
  let d = rows[0].d as string;
  const { rows: have } = await pool.query(`SELECT to_char(report_date,'YYYY-MM-DD') AS d FROM daily_reports WHERE report_date >= $1`, [d]);
  const done = new Set(have.map((r) => r.d));
  let guard = 0;
  while (d <= yesterday && guard++ < 400) {
    if (!done.has(d)) await generateDailyReport(d, 'catch-up');
    d = addDays(d, 1);
  }
}

export async function dashboard() {
  const today = istDate();
  const s = await summary(today, today);
  const best = await itemWise(today, today);
  const bestByQty = [...best].sort((a, b) => b.quantity - a.quantity)[0] ?? null;
  const daily = await dailyBreakdown(addDays(today, -13), today);
  const weekly = await periodBreakdown(addDays(today, -7 * 11), today, 'week');
  const monthStart = new Date(today + 'T00:00:00Z');
  monthStart.setUTCMonth(monthStart.getUTCMonth() - 11);
  const monthly = await periodBreakdown(monthStart.toISOString().slice(0, 10), today, 'month');
  const { rows: attention } = await pool.query(
    `SELECT id, order_number, attention_note, business_date FROM orders WHERE needs_attention ORDER BY id DESC LIMIT 20`,
  );
  const { rows: printFails } = await pool.query(
    `SELECT id, order_number, token_number, business_date FROM orders WHERE print_status='FAILED' AND business_date >= $1 ORDER BY id DESC LIMIT 20`,
    [addDays(today, -1)],
  );
  return { today, summary: s, bestSeller: bestByQty, daily, weekly, monthly, attention, printFailures: printFails };
}
