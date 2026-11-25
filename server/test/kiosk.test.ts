import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { receiptsDir } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { istDate } from '../src/lib/time.js';
import { simLedger, signSimulated } from '../src/services/payments/simulated.js';
import { expireStale } from '../src/services/orders.js';
import { generateDailyReport } from '../src/services/reports/reports.js';
import { app, createAdmin, itemId, key, login, paidOrder, pay, placeOrder, resetDb, simRef, status, waitPrint, webhook } from './helpers.js';

beforeEach(resetDb);
afterAll(() => pool.end());

const H = { 'x-crtl-admin': '1' };

describe('Menu (kiosk view)', () => {
  it('lists active categories and hides disabled items, shows temporarily unavailable as unavailable', async () => {
    await pool.query(`UPDATE food_items SET availability_status='disabled' WHERE name='Brownie'`);
    const r = await request(app).get('/api/kiosk/menu');
    expect(r.status).toBe(200);
    expect(r.body.categories.map((c: any) => c.name)).toContain('Tea & Coffee');
    const names = r.body.items.map((i: any) => i.name);
    expect(names).not.toContain('Brownie');
    expect(r.body.items.find((i: any) => i.name === 'Mango Shake').available).toBe(false);
  });
});

describe('Cart, totals and order creation', () => {
  it('3/4/5. calculates totals server-side from DB prices (client prices are never trusted)', async () => {
    const r = await placeOrder([['Tea', 2], ['Coffee', 1], ['Veg Sandwich', 1], ['Samosa', 2]]);
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('170.00'); // sample receipt in spec: 20 + 30 + 80 + 40
    expect(r.body.items).toHaveLength(4);
    expect(r.body.status).toBe('PENDING_PAYMENT');
    expect(r.body.tokenNumber).toBeNull(); // token only after verified payment
  });

  it('merges duplicate lines for the same item', async () => {
    const id = await itemId('Tea');
    const r = await request(app).post('/api/kiosk/orders').send({ idempotencyKey: key(), items: [{ itemId: id, quantity: 1 }, { itemId: id, quantity: 2 }] });
    expect(r.body.items).toEqual([expect.objectContaining({ name: 'Tea', quantity: 3, lineTotal: '30.00' })]);
  });

  it('rejects an empty cart, unavailable items and excessive quantities', async () => {
    expect((await request(app).post('/api/kiosk/orders').send({ idempotencyKey: key(), items: [] })).status).toBe(400);
    expect((await placeOrder([['Mango Shake', 1]])).status).toBe(409);
    expect((await placeOrder([['Tea', 21]])).status).toBe(400);
  });

  it('6. idempotency key prevents duplicate orders on double-tap/retry', async () => {
    const k = key();
    const a = await placeOrder([['Tea', 1]], k);
    const b = await placeOrder([['Tea', 1]], k);
    expect(b.body.id).toBe(a.body.id);
    const { rows } = await pool.query('SELECT count(*)::int n FROM orders');
    expect(rows[0].n).toBe(1);
  });

  it('applies optional exclusive tax only when enabled', async () => {
    const admin = await adminAgent('superadmin');
    await admin.put('/api/admin/system/settings').set(H).send({ tax_enabled: true, tax_rate: 5, tax_mode: 'exclusive' }).expect(200);
    const r = await placeOrder([['Veg Thali', 1]]);
    expect(r.body.subtotal).toBe('80.00');
    expect(r.body.tax).toBe('4.00');
    expect(r.body.total).toBe('84.00');
  });
});

describe('UPI payment flow (simulated provider)', () => {
  it('7. creates a dynamic QR for the exact amount and reuses it on retry', async () => {
    const o = await placeOrder([['Tea', 2]]);
    const p1 = await pay(o.body.id, o.body.accessKey);
    expect(p1.status).toBe(200);
    expect(p1.body.payment.status).toBe('PENDING');
    expect(p1.body.payment.amount).toBe('20.00');
    expect(p1.body.payment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(simLedger.get(simRef(p1))!.amountPaise).toBe(2000);
    const p2 = await pay(o.body.id, o.body.accessKey);
    expect(p2.body.payment.attemptRef).toBe(p1.body.payment.attemptRef);
  });

  it('requires the order access key', async () => {
    const o = await placeOrder([['Tea', 1]]);
    expect((await pay(o.body.id, 'wrong')).status).toBe(404);
    expect((await status(o.body.id, '')).status).toBe(404);
  });

  it('8/11/13. verified webhook marks PAID, issues token, prints receipt automatically', async () => {
    const o = await placeOrder([['Tea', 2], ['Coffee', 1], ['Veg Sandwich', 1], ['Samosa', 2]]);
    const p = await pay(o.body.id, o.body.accessKey);
    const w = await webhook(simRef(p), 'success');
    expect(w.body.status).toBe('confirmed');
    expect(await waitPrint(o.body.id)).toBe('PRINTED');
    const s = await status(o.body.id, o.body.accessKey);
    expect(s.body.status).toBe('PAID');
    expect(s.body.tokenNumber).toBe(1);
    expect(s.body.tokenDisplay).toBe('00001');
    expect(s.body.payment.transactionRef).toBeTruthy();
    const files = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.txt'));
    expect(files).toHaveLength(1);
    const txt = fs.readFileSync(path.join(receiptsDir, files[0]), 'utf8');
    expect(txt).toContain('CRTL CANTEEN');
    expect(txt).toContain('ORDER TOKEN: #00001');
    expect(txt).toMatch(/TOTAL AMOUNT:\s+Rs\.170/);
    expect(txt).toContain('Payment Status: SUCCESSFUL');
    expect(txt).toContain('PLEASE COLLECT YOUR ORDER.');
    expect(fs.readFileSync(path.join(receiptsDir, files[0].replace('.txt', '.bin')))[0]).toBe(0x1b); // ESC/POS init
  });

  it('rejects webhooks with an invalid signature and records them', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    const body = JSON.stringify({ id: 'evt_fake', event: 'payment.captured', payload: { qr_id: simRef(p), payment_id: 'x', amount: 1000, currency: 'INR' } });
    const r = await request(app).post('/api/webhooks/simulated').set('content-type', 'application/json').set('x-sim-signature', 'deadbeef').send(body);
    expect(r.status).toBe(401);
    expect((await status(o.body.id, o.body.accessKey)).body.status).toBe('PENDING_PAYMENT');
    const { rows } = await pool.query(`SELECT signature_valid, processing_result FROM payment_events`);
    expect(rows).toEqual([{ signature_valid: false, processing_result: 'rejected_signature' }]);
  });

  it('a customer cannot fake success: no client endpoint can mark an order paid', async () => {
    const o = await placeOrder([['Tea', 1]]);
    await pay(o.body.id, o.body.accessKey);
    const r = await request(app).post(`/api/kiosk/orders/${o.body.id}/confirm`).set('x-order-key', o.body.accessKey).send({ status: 'SUCCESS' });
    expect(r.status).toBe(404);
    expect((await status(o.body.id, o.body.accessKey)).body.status).toBe('PENDING_PAYMENT');
  });

  it('9. failed payment leaves the order payable and allows a retry with a new QR (same order)', async () => {
    const o = await placeOrder([['Coffee', 1]]);
    const p1 = await pay(o.body.id, o.body.accessKey);
    expect((await webhook(simRef(p1), 'fail')).body.status).toBe('failed');
    const s = await status(o.body.id, o.body.accessKey);
    expect(s.body.status).toBe('PENDING_PAYMENT');
    expect(s.body.payment.status).toBe('FAILED');
    const p2 = await pay(o.body.id, o.body.accessKey);
    expect(p2.body.payment.attemptRef).not.toBe(p1.body.payment.attemptRef);
    await webhook(simRef(p2), 'success');
    expect((await status(o.body.id, o.body.accessKey)).body.status).toBe('PAID');
    const { rows } = await pool.query('SELECT count(*)::int n FROM orders');
    expect(rows[0].n).toBe(1);
  });

  it('10. duplicate webhooks (same event and re-sent events) are processed once and print once', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    const ref = simRef(p);
    const a = await webhook(ref, 'success', 'evt_same');
    const b = await webhook(ref, 'success', 'evt_same');
    const c = await webhook(ref, 'success', 'evt_other');
    expect(a.body.status).toBe('confirmed');
    expect(b.body.status).toBe('duplicate_event');
    expect(c.body.status).toBe('duplicate');
    await waitPrint(o.body.id);
    const { rows: pj } = await pool.query(`SELECT count(*)::int n FROM print_jobs WHERE order_id=$1`, [o.body.id]);
    expect(pj[0].n).toBe(1);
    const { rows: tk } = await pool.query(`SELECT last_token FROM token_counters`);
    expect(tk[0].last_token).toBe(1);
  });

  it('concurrent duplicate webhooks still confirm exactly once', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    const ref = simRef(p);
    const results = await Promise.all([1, 2, 3, 4].map((i) => webhook(ref, 'success', `evt_c${i}`)));
    expect(results.filter((r) => r.body.status === 'confirmed')).toHaveLength(1);
  });

  it('amount mismatch is never accepted as paid and is flagged for attention', async () => {
    const o = await placeOrder([['Veg Thali', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    expect((await webhook(simRef(p), 'wrong_amount')).body.status).toBe('amount_mismatch');
    const { rows } = await pool.query('SELECT status, needs_attention, token_number FROM orders WHERE id=$1', [o.body.id]);
    expect(rows[0]).toEqual({ status: 'PENDING_PAYMENT', needs_attention: true, token_number: null });
  });

  it('lost webhook: payment is still found by server-side API status check', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    await request(app).post(`/api/simulator/${simRef(p)}/silent`).expect(200);
    const s = await status(o.body.id, o.body.accessKey);
    expect(s.body.status).toBe('PAID');
  });

  it('cancel: cancels unpaid orders; a later payment is recorded and flagged for refund, not issued a token', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    const ref = simRef(p);
    const c = await request(app).post(`/api/kiosk/orders/${o.body.id}/cancel`).set('x-order-key', o.body.accessKey);
    expect(c.body.status).toBe('CANCELLED');
    simLedger.get(ref)!.status = 'PENDING'; // simulate the customer paying from an already-scanned QR
    expect((await webhook(ref, 'success')).body.status).toBe('late_payment');
    const { rows } = await pool.query('SELECT status, needs_attention, token_number FROM orders WHERE id=$1', [o.body.id]);
    expect(rows[0]).toEqual({ status: 'CANCELLED', needs_attention: true, token_number: null });
  });

  it('cancel after the customer already paid honours the payment', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    await request(app).post(`/api/simulator/${simRef(p)}/silent`);
    const c = await request(app).post(`/api/kiosk/orders/${o.body.id}/cancel`).set('x-order-key', o.body.accessKey);
    expect(c.status).toBe(409);
    expect((await status(o.body.id, o.body.accessKey)).body.status).toBe('PAID');
  });

  it('expires stale QR attempts', async () => {
    const o = await placeOrder([['Tea', 1]]);
    const p = await pay(o.body.id, o.body.accessKey);
    simLedger.get(simRef(p))!.expiresAt = new Date(Date.now() - 120_000);
    await pool.query(`UPDATE payments SET expires_at = now() - interval '2 minutes'`);
    await expireStale();
    expect((await status(o.body.id, o.body.accessKey)).body.payment.status).toBe('EXPIRED');
  });

  it('13. token numbers increase per day and reset on a new day; DB order id stays unique', async () => {
    const a = await paidOrder([['Tea', 1]]);
    const b = await paidOrder([['Tea', 1]]);
    const t = (id: number) => pool.query('SELECT token_number, business_date FROM orders WHERE id=$1', [id]).then((r) => r.rows[0]);
    expect((await t(a.id)).token_number).toBe(1);
    expect((await t(b.id)).token_number).toBe(2);
    // Simulate yesterday's counter being high: today's tokens are independent.
    await pool.query(`INSERT INTO token_counters VALUES ('2000-01-01', 999)`);
    const c = await paidOrder([['Tea', 1]]);
    expect((await t(c.id)).token_number).toBe(3);
    expect((await t(c.id)).business_date).toBe(istDate());
  });
});

describe('Printing', () => {
  it('12. printer failure keeps the paid order, shows error, and admin can print later', async () => {
    await pool.query(`UPDATE printer_settings SET mock_fail=true`);
    const o = await paidOrder([['Tea', 1]]);
    const s = await status(o.id, o.accessKey);
    expect(s.body.status).toBe('PAID');
    expect(s.body.printStatus).toBe('FAILED');
    await pool.query(`UPDATE printer_settings SET mock_fail=false`);
    await createAdmin('staff1', 'staff');
    const staff = await login('staff1');
    const r = await staff.post(`/api/admin/orders/${o.id}/reprint`).set(H);
    expect(r.body).toMatchObject({ kind: 'ORIGINAL', status: 'PRINTED' }); // never printed -> original, not "duplicate"
    const r2 = await staff.post(`/api/admin/orders/${o.id}/reprint`).set(H);
    expect(r2.body).toMatchObject({ kind: 'REPRINT', status: 'PRINTED' });
    const dup = fs.readdirSync(receiptsDir).find((f) => f.includes('reprint') && f.endsWith('.txt'))!;
    expect(fs.readFileSync(path.join(receiptsDir, dup), 'utf8')).toContain('DUPLICATE COPY');
  });

  it('never prints a receipt for an unpaid order', async () => {
    const o = await placeOrder([['Tea', 1]]);
    await pay(o.body.id, o.body.accessKey);
    await createAdmin('a1', 'admin');
    const ag = await login('a1');
    expect((await ag.post(`/api/admin/orders/${o.body.id}/reprint`).set(H)).status).toBe(409);
  });
});

describe('Admin authentication & authorization', () => {
  it('17. first-run setup requires the setup token and only works once; login/logout work', async () => {
    const st = await request(app).get('/api/admin/auth/setup/status');
    expect(st.body.needsSetup).toBe(true);
    const bad = await request(app).post('/api/admin/auth/setup').set(H).send({ setupToken: 'nope', username: 'boss', password: 'Sup3rSecret!x' });
    expect(bad.status).toBe(403);
    const { config } = await import('../src/config.js');
    const ok = await request(app).post('/api/admin/auth/setup').set(H).send({ setupToken: config.adminSetupToken, username: 'boss', password: 'Sup3rSecret!x' });
    expect(ok.status).toBe(201);
    const again = await request(app).post('/api/admin/auth/setup').set(H).send({ setupToken: config.adminSetupToken, username: 'boss2', password: 'Sup3rSecret!x' });
    expect(again.status).toBe(409);
    const ag = await login('boss', 'Sup3rSecret!x');
    expect((await ag.get('/api/admin/auth/me')).body.user.role).toBe('superadmin');
    await ag.post('/api/admin/auth/logout').set(H).expect(200);
    expect((await ag.get('/api/admin/auth/me')).status).toBe(401);
  });

  it('stores only bcrypt hashes and locks the account after 5 failed logins', async () => {
    await createAdmin('u1', 'admin');
    const { rows } = await pool.query(`SELECT password_hash FROM admin_users WHERE username='u1'`);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    for (let i = 0; i < 5; i++) await request(app).post('/api/admin/auth/login').set(H).send({ username: 'u1', password: 'wrong' });
    const r = await request(app).post('/api/admin/auth/login').set(H).send({ username: 'u1', password: 'Passw0rd!234' });
    expect(r.status).toBe(423);
  });

  it('18. blocks unauthenticated access, missing CSRF header and insufficient roles', async () => {
    expect((await request(app).get('/api/admin/orders')).status).toBe(401);
    expect((await request(app).get('/api/admin/reports/dashboard')).status).toBe(401);
    await createAdmin('s1', 'staff');
    const staff = await login('s1');
    expect((await staff.get('/api/admin/orders')).status).toBe(200);
    expect((await staff.post('/api/admin/menu/items').set(H).send({})).status).toBe(403);
    expect((await staff.get('/api/admin/reports?from=2026-01-01')).status).toBe(403);
    expect((await staff.put('/api/admin/system/settings').set(H).send({})).status).toBe(403);
    await createAdmin('a2', 'admin');
    const admin = await login('a2');
    expect((await admin.post('/api/admin/menu/categories').send({ name: 'X' })).status).toBe(403); // no CSRF header
  });

  it('kiosk menu does not expose admin-only fields', async () => {
    const r = await request(app).get('/api/kiosk/menu');
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['availability_status', 'available', 'category_id', 'description', 'id', 'image_url', 'name', 'price']);
  });
});

describe('Menu management & history preservation', () => {
  it('1/2/19. add, edit price, delete items; past orders keep the original name and price', async () => {
    const admin = await adminAgent('admin');
    const cats = (await admin.get('/api/admin/menu/categories')).body;
    const snacks = cats.find((c: any) => c.name === 'Snacks');
    const created = await admin.post('/api/admin/menu/items').set(H).send({ name: 'Kachori', price: '25', category_id: snacks.id });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const o = await request(app).post('/api/kiosk/orders').send({ idempotencyKey: key(), items: [{ itemId: id, quantity: 2 }] });
    const p = await pay(o.body.id, o.body.accessKey);
    await webhook(simRef(p), 'success');

    expect((await admin.put(`/api/admin/menu/items/${id}`).set(H).send({ price: '30.50', name: 'Raj Kachori' })).body.price).toBe('30.50');
    expect((await admin.put(`/api/admin/menu/items/${id}`).set(H).send({ price: '-5' })).status).toBe(400);
    await admin.delete(`/api/admin/menu/items/${id}`).set(H).expect(200);

    const menu = (await request(app).get('/api/kiosk/menu')).body.items.map((i: any) => i.name);
    expect(menu).not.toContain('Raj Kachori');
    const { rows } = await pool.query('SELECT item_name, unit_price::text, quantity, line_total::text FROM order_items WHERE order_id=$1', [o.body.id]);
    expect(rows[0]).toEqual({ item_name: 'Kachori', unit_price: '25.00', quantity: 2, line_total: '50.00' });
    const rep = (await admin.get(`/api/admin/reports?from=${istDate()}`)).body;
    expect(rep.items[0]).toMatchObject({ item: 'Kachori', quantity: 2, total: '50.00' });
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_type='food_item' ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['item.created', 'item.price_changed', 'item.deleted']);
  });

  it('categories in use cannot be deleted; empty ones can', async () => {
    const admin = await adminAgent('admin');
    const cats = (await admin.get('/api/admin/menu/categories')).body;
    const bakery = cats.find((c: any) => c.name === 'Bakery');
    expect((await admin.delete(`/api/admin/menu/categories/${bakery.id}`).set(H)).status).toBe(409);
    const n = await admin.post('/api/admin/menu/categories').set(H).send({ name: 'Festive Specials' });
    expect((await admin.delete(`/api/admin/menu/categories/${n.body.id}`).set(H)).status).toBe(200);
  });

  it('database forbids deleting or editing financial history', async () => {
    const o = await paidOrder([['Tea', 1]]);
    await expect(pool.query('DELETE FROM payments WHERE order_id=$1', [o.id])).rejects.toThrow(/not allowed/);
    await expect(pool.query('DELETE FROM orders WHERE id=$1', [o.id])).rejects.toThrow(/not allowed/);
    await expect(pool.query(`UPDATE payments SET amount=1 WHERE order_id=$1 AND status='SUCCESS'`, [o.id])).rejects.toThrow(/cannot be altered/);
    await expect(pool.query(`UPDATE order_items SET unit_price=1 WHERE order_id=$1`, [o.id])).rejects.toThrow(/immutable/);
  });
});

describe('Reports', () => {
  it('14/15/16/20. daily & item-wise totals, refunds, exports and stored end-of-day report', async () => {
    await paidOrder([['Tea', 2], ['Coffee', 1], ['Veg Sandwich', 1], ['Samosa', 2]]); // 170
    const second = await paidOrder([['Tea', 3]]); // 30
    // a failed and a pending payment must not count as revenue
    const f = await placeOrder([['Veg Thali', 1]]);
    await webhook(simRef(await pay(f.body.id, f.body.accessKey)), 'fail');
    const pend = await placeOrder([['Coffee', 2]]);
    await pay(pend.body.id, pend.body.accessKey);
    const canc = await placeOrder([['Tea', 1]]);
    await request(app).post(`/api/kiosk/orders/${canc.body.id}/cancel`).set('x-order-key', canc.body.accessKey);

    const admin = await adminAgent('admin');
    const detail = (await admin.get(`/api/admin/orders/${second.id}`)).body;
    const r = await admin.post(`/api/admin/orders/${second.id}/refund`).set(H).send({ paymentId: detail.payments[0].id, amount: '10', reason: 'One tea spilled' });
    expect(r.body.status).toBe('COMPLETED');
    expect((await admin.post(`/api/admin/orders/${second.id}/refund`).set(H).send({ paymentId: detail.payments[0].id, amount: '25', reason: 'too much' })).status).toBe(400);

    const today = istDate();
    const rep = (await admin.get(`/api/admin/reports?from=${today}`)).body;
    expect(rep.summary).toMatchObject({
      totalOrders: 2,
      totalItemsSold: 9,
      successfulTransactions: 2,
      totalCollection: '200.00',
      failedPayments: 1,
      pendingPayments: 1,
      cancelledOrders: 1,
      totalRefunds: '10.00',
      netCollection: '190.00',
    });
    const tea = rep.items.find((i: any) => i.item === 'Tea');
    expect(tea).toMatchObject({ quantity: 5, unitPrice: '10.00', total: '50.00' });
    expect(rep.items.reduce((a: number, i: any) => a + Number(i.total), 0)).toBe(200);

    const xlsx = await admin.get(`/api/admin/reports/export?from=${today}&format=xlsx`).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    const pdf = await admin.get(`/api/admin/reports/export?from=${today}&format=pdf`).buffer(true).parse(binary);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const csv = await admin.get(`/api/admin/reports/export?from=${today}&format=csv&kind=items`);
    expect(csv.text).toContain('Food Item,Category,Quantity Sold,Unit Price,Total Amount');
    expect(csv.text).toContain('Tea,Tea & Coffee,5,10.00,50.00');

    await generateDailyReport(today, 'scheduler');
    const stored = (await admin.get('/api/admin/reports/daily')).body;
    expect(stored[0]).toMatchObject({ total_orders: 2, total_collection: '200.00', total_refunds: '10.00', net_collection: '190.00' });

    const dash = (await admin.get('/api/admin/reports/dashboard')).body;
    expect(dash.summary.netCollection).toBe('190.00');
    expect(dash.bestSeller.item).toBe('Tea');
  });
});

function binary(res: any, cb: any) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function adminAgent(role: 'superadmin' | 'admin' | 'staff') {
  const u = `${role}_${Math.random().toString(36).slice(2, 7)}`;
  await createAdmin(u, role);
  return login(u);
}

// keep the signer import used (documents how tests can craft provider payloads)
void signSimulated;
