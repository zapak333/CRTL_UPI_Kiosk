import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool, withTransaction, type Db } from '../db/pool.js';
import { audit, systemActor, type Actor } from '../lib/audit.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { fromPaise, percentOf, toPaise } from '../lib/money.js';
import { istDate, istMinutesNow } from '../lib/time.js';
import { activeProvider, providerByName } from './payments/index.js';
import { ProviderUnavailableError, type ProviderPaymentUpdate } from './payments/types.js';
import { getSettings } from './settings.js';
import { schedulePrint } from './printing/printService.js';

export interface CartLine {
  itemId: number;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

export async function createOrder(lines: CartLine[], idempotencyKey: string, kioskId: string | null, actor: Actor) {
  const settings = await getSettings();
  if (!lines.length) throw badRequest('Cart is empty');

  if (settings.enforce_operating_hours) {
    const now = istMinutesNow();
    const [oh, om] = settings.opening_time.split(':').map(Number);
    const [ch, cm] = settings.closing_time.split(':').map(Number);
    if (now < oh * 60 + om || now > ch * 60 + cm) throw new HttpError(403, 'The canteen is closed right now.', 'closed');
  }

  // Merge duplicate lines
  const merged = new Map<number, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.itemId) || !Number.isInteger(l.quantity) || l.quantity < 1) throw badRequest('Invalid cart line');
    merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.quantity);
  }
  for (const q of merged.values()) if (q > settings.max_qty_per_item) throw badRequest(`Maximum ${settings.max_qty_per_item} of one item per order`);
  if (merged.size > 40) throw badRequest('Too many different items');

  return withTransaction(async (c) => {
    // Idempotency: the same kiosk request (double tap / network retry) returns the same order.
    const existing = await c.query('SELECT id FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing.rows[0]) return { ...(await getOrderForKiosk(existing.rows[0].id, c)), duplicate: true };

    const ids = [...merged.keys()];
    const { rows: items } = await c.query(
      `SELECT i.id, i.name, i.price, i.availability_status, c.name AS category_name, c.is_active AS category_active
         FROM food_items i JOIN food_categories c ON c.id = i.category_id
        WHERE i.id = ANY($1::int[]) AND i.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [ids],
    );
    const byId = new Map(items.map((i) => [i.id as number, i]));
    let subtotal = 0;
    const snapshot: { id: number; name: string; category: string; unit: number; qty: number; total: number }[] = [];
    for (const [id, qty] of merged) {
      const it = byId.get(id);
      if (!it || it.availability_status !== 'available' || !it.category_active)
        throw new HttpError(409, `${it?.name ?? 'An item'} is no longer available. Please update your cart.`, 'item_unavailable', { itemId: id });
      const unit = toPaise(it.price);
      const total = unit * qty;
      subtotal += total;
      snapshot.push({ id, name: it.name, category: it.category_name, unit, qty, total });
    }

    let tax = 0;
    let total = subtotal;
    if (settings.tax_enabled && settings.tax_rate > 0) {
      if (settings.tax_mode === 'exclusive') {
        tax = percentOf(subtotal, settings.tax_rate);
        total = subtotal + tax;
      } else {
        tax = Math.round((subtotal * settings.tax_rate) / (100 + settings.tax_rate));
      }
    }

    const { rows: seq } = await c.query(`SELECT nextval('orders_id_seq') AS id`);
    const id = Number(seq[0].id);
    const businessDate = istDate();
    const orderNumber = `CRTL-${businessDate.replace(/-/g, '')}-${String(id).padStart(6, '0')}`;
    const accessKey = crypto.randomBytes(24).toString('hex');
    await c.query(
      `INSERT INTO orders (id, order_number, idempotency_key, access_key, business_date, subtotal_amount, tax_amount, total_amount, tax_label, tax_rate, kiosk_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, orderNumber, idempotencyKey, accessKey, businessDate, fromPaise(subtotal), fromPaise(tax), fromPaise(total),
        settings.tax_enabled ? settings.tax_label : null, settings.tax_enabled ? settings.tax_rate : null, kioskId],
    );
    for (const s of snapshot) {
      await c.query(
        `INSERT INTO order_items (order_id, food_item_id, item_name, category_name, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, s.id, s.name, s.category, fromPaise(s.unit), s.qty, fromPaise(s.total)],
      );
    }
    await audit(actor, 'order.created', 'order', id, { orderNumber, total: fromPaise(total), items: snapshot.length }, c);
    return { ...(await getOrderForKiosk(id, c)), accessKey, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Reading orders
// ---------------------------------------------------------------------------

export async function getOrderForKiosk(orderId: number, db: Db = pool) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  const { rows: items } = await db.query('SELECT item_name, unit_price, quantity, line_total FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  const { rows: pays } = await db.query(
    `SELECT id, attempt_ref, status, amount, qr_payload, qr_image_url, expires_at, failure_reason, provider_payment_ref, bank_rrn
       FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
    [orderId],
  );
  const p = pays[0];
  return {
    id: Number(o.id),
    orderNumber: o.order_number as string,
    status: o.status as string,
    tokenNumber: o.token_number as number | null,
    tokenDisplay: o.token_number ? await formatToken(o.token_number) : null,
    subtotal: o.subtotal_amount as string,
    tax: o.tax_amount as string,
    taxLabel: o.tax_label as string | null,
    total: o.total_amount as string,
    printStatus: o.print_status as string,
    paidAt: o.paid_at,
    items: items.map((i) => ({ name: i.item_name, unitPrice: i.unit_price, quantity: i.quantity, lineTotal: i.line_total })),
    payment: p
      ? {
          attemptRef: p.attempt_ref,
          status: p.status,
          amount: p.amount,
          qrPayload: p.qr_payload,
          qrImageUrl: p.qr_image_url,
          expiresAt: p.expires_at,
          failureReason: p.failure_reason,
          transactionRef: p.status === 'SUCCESS' ? p.bank_rrn ?? p.provider_payment_ref : null,
        }
      : null,
  };
}

export async function formatToken(n: number) {
  const s = await getSettings();
  return `${s.token_prefix}${String(n).padStart(s.token_digits, '0')}`;
}

export async function assertAccess(orderId: number, accessKey: string | undefined) {
  const { rows } = await pool.query('SELECT access_key FROM orders WHERE id = $1', [orderId]);
  if (!rows[0]) throw notFound('Order not found');
  const a = Buffer.from(String(accessKey ?? ''));
  const b = Buffer.from(rows[0].access_key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw notFound('Order not found');
}

// ---------------------------------------------------------------------------
// Payment attempts
// ---------------------------------------------------------------------------

/**
 * Start (or resume) payment for an order. Reuses a still-valid pending QR so a retry / page refresh never
 * creates a second payable QR for the same order; creates a fresh attempt only after failure/expiry.
 */
export async function startPayment(orderId: number, actor: Actor) {
  const provider = activeProvider();
  const settings = await getSettings();
  const printJobId = await withTransaction(async (c): Promise<number | undefined> => {
    const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'PENDING_PAYMENT') {
      if (o.status === 'PAID') return;
      throw conflict(`Order is ${o.status.toLowerCase().replace('_', ' ')}`);
    }
    const { rows: pend } = await c.query(
      `SELECT * FROM payments WHERE order_id = $1 AND status = 'PENDING' ORDER BY id DESC`,
      [orderId],
    );
    for (const p of pend) {
      if (new Date(p.expires_at).getTime() > Date.now() + 15_000) return; // still valid -> reuse it
    }
    // Any stale pending attempts: confirm with provider before discarding (payment may have just landed)
    for (const p of pend) {
      const upd = await safeFetch(p.provider, p.provider_order_ref, p.attempt_ref);
      if (upd?.status === 'SUCCESS') {
        const r = await applyUpdateLocked(c, p.id, upd, 'api_poll', systemActor);
        return r.printJobId;
      }
      await c.query(`UPDATE payments SET status='EXPIRED', failure_reason='QR expired', updated_at=now() WHERE id=$1 AND status='PENDING'`, [p.id]);
      if (p.provider_order_ref) providerByName(p.provider)?.closeQr(p.provider_order_ref).catch(() => {});
    }

    const { rows: cnt } = await c.query('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [orderId]);
    const attemptRef = `CRTL${orderId}A${cnt[0].n + 1}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const amountPaise = toPaise(o.total_amount);
    const expiresAt = new Date(Date.now() + config.payment.qrTtlMinutes * 60_000);
    const { rows: ins } = await c.query(
      `INSERT INTO payments (order_id, attempt_ref, provider, amount, status, expires_at) VALUES ($1,$2,$3,$4,'PENDING',$5) RETURNING id`,
      [orderId, attemptRef, provider.name, o.total_amount, expiresAt],
    );
    let qr;
    try {
      qr = await provider.createQr({
        attemptRef,
        amountPaise,
        orderNumber: o.order_number,
        description: `${settings.canteen_name} order ${o.order_number}`,
        payeeName: settings.upi_payee_name || settings.canteen_name,
        expiresAt,
      });
    } catch (e) {
      // Roll back the attempt: nothing was created at the provider.
      const err = e instanceof ProviderUnavailableError ? new HttpError(503, 'Payment service is unavailable right now. Please try again in a moment.', 'payment_unavailable') : e;
      throw err;
    }
    await c.query(`UPDATE payments SET provider_order_ref=$2, qr_payload=$3, qr_image_url=$4, updated_at=now() WHERE id=$1`, [ins[0].id, qr.providerOrderRef, qr.qrPayload, qr.qrImageUrl]);
    await audit(actor, 'payment.attempt_created', 'payment', ins[0].id, { orderId, attemptRef, provider: provider.name, amount: o.total_amount }, c);
    return undefined;
  });
  if (printJobId) schedulePrint(printJobId);
  return getOrderForKiosk(orderId);
}

async function safeFetch(providerName: string, providerOrderRef: string | null, attemptRef: string): Promise<ProviderPaymentUpdate | null> {
  if (!providerOrderRef) return null;
  try {
    return (await providerByName(providerName)?.fetchStatus(providerOrderRef, attemptRef)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Server-side status check against the provider API (fallback when a webhook is delayed or lost).
 * Throttled per attempt so the kiosk's polling does not hammer the gateway.
 */
export async function reconcileOrder(orderId: number) {
  const { rows } = await pool.query(
    `SELECT id, provider, provider_order_ref, attempt_ref FROM payments
      WHERE order_id = $1 AND status = 'PENDING'
        AND (last_polled_at IS NULL OR last_polled_at < now() - interval '4 seconds')`,
    [orderId],
  );
  for (const p of rows) {
    await pool.query('UPDATE payments SET last_polled_at = now() WHERE id = $1', [p.id]);
    const upd = await safeFetch(p.provider, p.provider_order_ref, p.attempt_ref);
    if (upd && upd.status !== 'PENDING') await applyProviderUpdate(p.id, upd, 'api_poll', systemActor);
  }
}

export type ApplyResult = 'confirmed' | 'duplicate' | 'failed' | 'expired' | 'amount_mismatch' | 'late_payment' | 'ignored';

export async function applyProviderUpdate(paymentId: number, upd: ProviderPaymentUpdate, via: 'webhook' | 'api_poll', actor: Actor): Promise<ApplyResult> {
  const res = await withTransaction((c) => applyUpdateLocked(c, paymentId, upd, via, actor));
  if (res.printJobId) schedulePrint(res.printJobId);
  return res.result;
}

/** Core state machine. Must run inside a transaction. Locks the payment and order rows. */
async function applyUpdateLocked(
  c: PoolClient,
  paymentId: number,
  upd: ProviderPaymentUpdate,
  via: 'webhook' | 'api_poll',
  actor: Actor,
): Promise<{ result: ApplyResult; printJobId?: number }> {
  const { rows: pr } = await c.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
  const p = pr[0];
  if (!p) return { result: 'ignored' };
  const { rows: or } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [p.order_id]);
  const o = or[0];

  if (upd.status === 'FAILED') {
    if (p.status !== 'PENDING') return { result: 'duplicate' };
    await c.query(`UPDATE payments SET status='FAILED', failure_reason=$2, verified_via=$3, updated_at=now() WHERE id=$1`, [p.id, (upd.failureReason ?? 'Payment failed').slice(0, 300), via]);
    await audit(actor, 'payment.failed', 'payment', p.id, { orderId: o.id, reason: upd.failureReason, via }, c);
    return { result: 'failed' };
  }
  if (upd.status === 'EXPIRED') {
    if (p.status !== 'PENDING') return { result: 'duplicate' };
    await c.query(`UPDATE payments SET status='EXPIRED', failure_reason='QR expired', updated_at=now() WHERE id=$1`, [p.id]);
    return { result: 'expired' };
  }
  if (upd.status !== 'SUCCESS') return { result: 'ignored' };

  // ---- SUCCESS ----
  if (['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(p.status)) return { result: 'duplicate' };
  if (!upd.providerPaymentRef) return { result: 'ignored' };
  // Same provider payment already recorded on another attempt? (should never happen)
  const { rows: dupRef } = await c.query('SELECT id FROM payments WHERE provider=$1 AND provider_payment_ref=$2', [p.provider, upd.providerPaymentRef]);
  if (dupRef[0]) return { result: 'duplicate' };

  const expected = toPaise(p.amount);
  const received = upd.amountPaise ?? -1;
  const currencyOk = (upd.currency ?? 'INR').toUpperCase() === 'INR';
  const common = [p.id, upd.providerPaymentRef, upd.rrn ?? null, upd.payerVpa ?? null, via];

  if (received !== expected || !currencyOk) {
    // Money moved but not the right amount: never mark the order paid. Flag for refund.
    await c.query(
      `UPDATE payments SET status='FAILED', provider_payment_ref=$2, bank_rrn=$3, payer_vpa_masked=$4, verified_via=$5,
              amount_received=$6, failure_reason=$7, verified_at=now(), updated_at=now() WHERE id=$1`,
      [...common, received >= 0 ? fromPaise(received) : null, `Amount mismatch: expected ${fromPaise(expected)}, received ${received >= 0 ? fromPaise(received) : 'unknown'} ${upd.currency ?? ''}`],
    );
    await c.query(`UPDATE orders SET needs_attention=true, attention_note=$2, updated_at=now() WHERE id=$1`, [o.id, 'Payment amount mismatch - verify with gateway and refund the payer']);
    await audit(actor, 'payment.amount_mismatch', 'payment', p.id, { orderId: o.id, expected: fromPaise(expected), received, via }, c);
    return { result: 'amount_mismatch' };
  }

  await c.query(
    `UPDATE payments SET status='SUCCESS', provider_payment_ref=$2, bank_rrn=$3, payer_vpa_masked=$4, verified_via=$5,
            amount_received=amount, verified_at=now(), failure_reason=NULL, updated_at=now() WHERE id=$1`,
    common,
  );

  if (o.status !== 'PENDING_PAYMENT') {
    // Paid after cancel/expiry, or a second payment on an already-paid order: keep the money on record and flag a refund.
    const note = o.status === 'PAID' ? 'Duplicate payment received for an already paid order - refund required' : `Payment received after order was ${o.status.toLowerCase()} - refund required`;
    await c.query(`UPDATE orders SET needs_attention=true, attention_note=$2, updated_at=now() WHERE id=$1`, [o.id, note]);
    await audit(actor, 'payment.late_or_duplicate', 'payment', p.id, { orderId: o.id, orderStatus: o.status, via }, c);
    return { result: 'late_payment' };
  }

  const today = istDate();
  const { rows: tok } = await c.query(
    `INSERT INTO token_counters (business_date, last_token) VALUES ($1, 1)
     ON CONFLICT (business_date) DO UPDATE SET last_token = token_counters.last_token + 1 RETURNING last_token`,
    [today],
  );
  const token = tok[0].last_token as number;
  const { rows: ps } = await c.query('SELECT auto_print FROM printer_settings WHERE id = 1');
  const autoPrint = ps[0]?.auto_print !== false;
  await c.query(
    `UPDATE orders SET status='PAID', token_number=$2, business_date=$3, paid_at=now(), print_status=$4, updated_at=now() WHERE id=$1`,
    [o.id, token, today, autoPrint ? 'PENDING' : 'NOT_PRINTED'],
  );
  // Close any other open attempts for this order
  const { rows: others } = await c.query(
    `UPDATE payments SET status='CANCELLED', failure_reason='Order paid via another attempt', updated_at=now()
      WHERE order_id=$1 AND id<>$2 AND status='PENDING' RETURNING provider, provider_order_ref`,
    [o.id, p.id],
  );
  for (const x of others) if (x.provider_order_ref) providerByName(x.provider)?.closeQr(x.provider_order_ref).catch(() => {});

  let printJobId: number | undefined;
  if (autoPrint) {
    const { rows: pj } = await c.query(
      `INSERT INTO print_jobs (order_id, kind) VALUES ($1,'ORIGINAL') ON CONFLICT DO NOTHING RETURNING id`,
      [o.id],
    );
    printJobId = pj[0]?.id;
  }
  await audit(actor, 'payment.confirmed', 'payment', p.id, { orderId: o.id, token, amount: p.amount, providerPaymentRef: upd.providerPaymentRef, via }, c);
  return { result: 'confirmed', printJobId };
}

// ---------------------------------------------------------------------------
// Cancellation / expiry
// ---------------------------------------------------------------------------

export async function cancelOrder(orderId: number, actor: Actor, reason = 'Cancelled by customer') {
  // Last check with the provider: if the customer paid a moment ago, honour the payment instead.
  await reconcileOrderNow(orderId);
  const closeRefs: { provider: string; ref: string }[] = [];
  await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!rows[0]) throw notFound('Order not found');
    if (rows[0].status === 'PAID') throw conflict('Payment already received for this order');
    if (rows[0].status !== 'PENDING_PAYMENT') return;
    const { rows: pend } = await c.query(
      `UPDATE payments SET status='CANCELLED', failure_reason=$2, updated_at=now() WHERE order_id=$1 AND status='PENDING' RETURNING provider, provider_order_ref`,
      [orderId, reason],
    );
    for (const p of pend) if (p.provider_order_ref) closeRefs.push({ provider: p.provider, ref: p.provider_order_ref });
    await c.query(`UPDATE orders SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1`, [orderId]);
    await audit(actor, 'order.cancelled', 'order', orderId, { reason }, c);
  });
  for (const r of closeRefs) await providerByName(r.provider)?.closeQr(r.ref).catch(() => {});
  return getOrderForKiosk(orderId);
}

async function reconcileOrderNow(orderId: number) {
  const { rows } = await pool.query(`SELECT id, provider, provider_order_ref, attempt_ref FROM payments WHERE order_id=$1 AND status='PENDING'`, [orderId]);
  for (const p of rows) {
    const upd = await safeFetch(p.provider, p.provider_order_ref, p.attempt_ref);
    if (upd?.status === 'SUCCESS') await applyProviderUpdate(p.id, upd, 'api_poll', systemActor);
  }
}

/** Periodic housekeeping: expire stale QR attempts and abandoned orders (after a final provider check). */
export async function expireStale() {
  const { rows } = await pool.query(
    `SELECT id, provider, provider_order_ref, attempt_ref FROM payments WHERE status='PENDING' AND expires_at < now() - interval '60 seconds'`,
  );
  for (const p of rows) {
    const upd = await safeFetch(p.provider, p.provider_order_ref, p.attempt_ref);
    if (upd?.status === 'SUCCESS' || upd?.status === 'FAILED') {
      await applyProviderUpdate(p.id, upd, 'api_poll', systemActor);
    } else if (upd) {
      // Provider answered and it is not paid -> expire and close.
      await applyProviderUpdate(p.id, { status: 'EXPIRED' }, 'api_poll', systemActor);
      if (p.provider_order_ref) await providerByName(p.provider)?.closeQr(p.provider_order_ref).catch(() => {});
    }
    // If the provider could not be reached we leave it PENDING and try again next run.
  }
  await pool.query(
    `UPDATE orders o SET status='EXPIRED', updated_at=now()
      WHERE o.status='PENDING_PAYMENT' AND o.created_at < now() - interval '30 minutes'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='PENDING')`,
  );
}
