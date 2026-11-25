import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { addDays, istDate, isValidDate } from '../../lib/time.js';
import { ah, idParam, parse } from '../../lib/validate.js';
import { actorOf, requirePerm } from '../../middleware/auth.js';
import { receiptPreview, requestReprint } from '../../services/printing/printService.js';
import { createRefund, resolveAttention } from '../../services/refunds.js';

export const ordersRouter = Router();

const listSchema = z.object({
  range: z.enum(['today', 'yesterday', 'custom', 'all']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(['all', 'PAID', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED']).default('all'),
  payment: z.enum(['all', 'SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'CANCELLED', 'REFUNDED']).default('all'),
  print: z.enum(['all', 'FAILED', 'PRINTED', 'PENDING', 'NOT_PRINTED']).default('all'),
  attention: z.enum(['0', '1']).optional(),
  q: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

ordersRouter.get('/', requirePerm('orders.view'), ah(async (req, res) => {
  const f = parse(listSchema, req.query);
  const today = istDate();
  let from = today;
  let to = today;
  if (f.range === 'yesterday') from = to = addDays(today, -1);
  if (f.range === 'custom') {
    from = isValidDate(f.from) ? f.from : today;
    to = isValidDate(f.to) ? f.to : from;
  }
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (f.range !== 'all') where.push(`o.business_date BETWEEN ${arg(from)} AND ${arg(to)}`);
  if (f.status !== 'all') where.push(`o.status = ${arg(f.status)}`);
  if (f.print !== 'all') where.push(`o.print_status = ${arg(f.print)}`);
  if (f.attention === '1') where.push('o.needs_attention');
  if (f.payment !== 'all') where.push(`EXISTS (SELECT 1 FROM payments px WHERE px.order_id=o.id AND px.status = ${arg(f.payment)})`);
  if (f.q) {
    const q = arg(`%${f.q}%`);
    where.push(`(o.order_number ILIKE ${q} OR o.token_number::text = ${arg(f.q.replace(/^#/, '').replace(/^0+/, ''))}
               OR EXISTS (SELECT 1 FROM payments py WHERE py.order_id=o.id AND (py.provider_payment_ref ILIKE ${q} OR py.bank_rrn ILIKE ${q} OR py.attempt_ref ILIKE ${q})))`);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM orders o ${w}`, args);
  const { rows } = await pool.query(
    `SELECT o.id, o.order_number, o.token_number, o.business_date, o.created_at, o.paid_at, o.status, o.total_amount::text AS total_amount,
            o.payment_mode, o.print_status, o.needs_attention, o.attention_note,
            (SELECT string_agg(oi.item_name || ' x' || oi.quantity, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id=o.id) AS items_summary,
            lp.status AS payment_status, lp.bank_rrn, lp.provider_payment_ref
       FROM orders o
       LEFT JOIN LATERAL (SELECT status, bank_rrn, provider_payment_ref FROM payments p WHERE p.order_id=o.id
                          ORDER BY (p.status IN ('SUCCESS','REFUNDED','PARTIALLY_REFUNDED')) DESC, p.id DESC LIMIT 1) lp ON true
       ${w} ORDER BY o.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    args,
  );
  res.json({ total: cnt[0].n, page: f.page, pageSize: f.pageSize, from, to, rows });
}));

ordersRouter.get('/:id', requirePerm('orders.view'), ah(async (req, res) => {
  const id = idParam(req);
  const { rows } = await pool.query('SELECT o.*, o.total_amount::text, o.subtotal_amount::text, o.tax_amount::text FROM orders o WHERE id=$1', [id]);
  if (!rows[0]) throw notFound();
  const { access_key: _k, idempotency_key: _i, ...order } = rows[0];
  const [items, payments, refunds, prints, audit] = await Promise.all([
    pool.query('SELECT item_name, category_name, unit_price::text, quantity, line_total::text, food_item_id FROM order_items WHERE order_id=$1 ORDER BY id', [id]),
    pool.query(`SELECT id, attempt_ref, provider, provider_order_ref, provider_payment_ref, bank_rrn, payer_vpa_masked, amount::text, amount_received::text,
                       status, failure_reason, verified_via, verified_at, expires_at, created_at FROM payments WHERE order_id=$1 ORDER BY id`, [id]),
    pool.query(`SELECT r.*, r.amount::text, a.username AS requested_by_name FROM refunds r LEFT JOIN admin_users a ON a.id=r.requested_by WHERE order_id=$1 ORDER BY id`, [id]),
    pool.query(`SELECT p.id, p.kind, p.status, p.attempts, p.last_error, p.printed_at, p.created_at, a.username AS requested_by FROM print_jobs p LEFT JOIN admin_users a ON a.id=p.requested_by WHERE order_id=$1 ORDER BY id`, [id]),
    pool.query(`SELECT action, actor_type, actor_name, details, created_at FROM audit_logs WHERE (entity_type='order' AND entity_id=$1)
                  OR (entity_type='payment' AND entity_id IN (SELECT id::text FROM payments WHERE order_id=$2)) ORDER BY id`, [String(id), id]),
  ]);
  let receipt: string | null = null;
  try {
    receipt = await receiptPreview(id);
  } catch {
    receipt = null;
  }
  res.json({ order, items: items.rows, payments: payments.rows, refunds: refunds.rows, printJobs: prints.rows, audit: audit.rows, receipt });
}));

ordersRouter.post('/:id/reprint', requirePerm('orders.reprint'), ah(async (req, res) => {
  res.json(await requestReprint(idParam(req), actorOf(req)));
}));

ordersRouter.post('/:id/refund', requirePerm('orders.refund'), ah(async (req, res) => {
  const b = parse(z.object({ paymentId: z.number().int().positive(), amount: z.union([z.string(), z.number()]).transform(String), reason: z.string().min(3).max(300) }), req.body);
  const { rows } = await pool.query('SELECT id FROM payments WHERE id=$1 AND order_id=$2', [b.paymentId, idParam(req)]);
  if (!rows[0]) throw notFound('Payment not found for this order');
  res.json(await createRefund(b.paymentId, b.amount, b.reason, actorOf(req)));
}));

ordersRouter.post('/:id/resolve', requirePerm('orders.refund'), ah(async (req, res) => {
  const b = parse(z.object({ note: z.string().min(3).max(200) }), req.body);
  await resolveAttention(idParam(req), b.note, actorOf(req));
  res.json({ ok: true });
}));
