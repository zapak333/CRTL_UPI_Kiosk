import { pool, withTransaction } from '../db/pool.js';
import { audit, type Actor } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { fromPaise, toPaise } from '../lib/money.js';
import { providerByName } from './payments/index.js';

/**
 * Refunds are recorded as separate, auditable transactions. The original payment row is never edited
 * except for its status moving to REFUNDED / PARTIALLY_REFUNDED.
 */
export async function createRefund(paymentId: number, amountRupees: string, reason: string, actor: Actor) {
  const amount = toPaise(amountRupees);
  if (amount <= 0) throw badRequest('Refund amount must be positive');
  if (!reason || reason.trim().length < 3) throw badRequest('A reason is required');

  const refund = await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]);
    const p = rows[0];
    if (!p) throw notFound('Payment not found');
    if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('Only successful payments can be refunded');
    const { rows: prev } = await c.query(`SELECT coalesce(sum(amount),0)::text AS s FROM refunds WHERE payment_id=$1 AND status IN ('PENDING','COMPLETED')`, [paymentId]);
    const remaining = toPaise(p.amount_received ?? p.amount) - toPaise(prev[0].s);
    if (amount > remaining) throw badRequest(`Maximum refundable amount is ${fromPaise(remaining)}`);
    const { rows: ins } = await c.query(
      `INSERT INTO refunds (payment_id, order_id, amount, reason, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [paymentId, p.order_id, fromPaise(amount), reason.trim().slice(0, 300), actor.id ?? null],
    );
    await audit(actor, 'refund.requested', 'refund', ins[0].id, { paymentId, orderId: p.order_id, amount: fromPaise(amount), reason }, c);
    return { ...ins[0], provider: p.provider, provider_payment_ref: p.provider_payment_ref };
  });

  const provider = providerByName(refund.provider);
  const result = provider
    ? await provider.refund(refund.provider_payment_ref, amount, { refund_id: String(refund.id), order_id: String(refund.order_id) })
    : { providerRefundRef: null, status: 'FAILED' as const, failureReason: 'Unknown provider' };

  await withTransaction(async (c) => {
    await c.query(
      `UPDATE refunds SET status=$2::varchar, provider_refund_ref=$3, failure_reason=$4, completed_at=CASE WHEN $2::varchar='COMPLETED' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`,
      [refund.id, result.status, result.providerRefundRef, result.failureReason ?? null],
    );
    if (result.status !== 'FAILED') await syncRefundStatus(c, paymentId);
    await audit(actor, `refund.${result.status.toLowerCase()}`, 'refund', refund.id, { providerRefundRef: result.providerRefundRef, error: result.failureReason }, c);
  });
  const { rows } = await pool.query('SELECT * FROM refunds WHERE id=$1', [refund.id]);
  return rows[0];
}

async function syncRefundStatus(c: import('pg').PoolClient, paymentId: number) {
  const { rows } = await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]);
  const p = rows[0];
  const { rows: r } = await c.query(`SELECT coalesce(sum(amount),0)::text AS s FROM refunds WHERE payment_id=$1 AND status IN ('PENDING','COMPLETED')`, [paymentId]);
  const full = toPaise(r[0].s) >= toPaise(p.amount_received ?? p.amount);
  const st = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await c.query('UPDATE payments SET status=$2, updated_at=now() WHERE id=$1', [paymentId, st]);
  await c.query(`UPDATE orders SET status=$2, updated_at=now() WHERE id=$1 AND status IN ('PAID','PARTIALLY_REFUNDED')`, [p.order_id, st]);
  if (full) await c.query(`UPDATE orders SET needs_attention=false, attention_note = coalesce(attention_note,'') || ' [refunded]' WHERE id=$1 AND needs_attention`, [p.order_id]);
}

export async function resolveAttention(orderId: number, note: string, actor: Actor) {
  const { rowCount } = await pool.query(`UPDATE orders SET needs_attention=false, attention_note = coalesce(attention_note,'') || $2, updated_at=now() WHERE id=$1 AND needs_attention`, [orderId, ` [resolved: ${note.slice(0, 120)}]`]);
  if (!rowCount) throw notFound('Nothing to resolve');
  await audit(actor, 'order.attention_resolved', 'order', orderId, { note });
}
