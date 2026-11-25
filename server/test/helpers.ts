import crypto from 'node:crypto';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { receiptsDir } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { seedMenu, writeSampleImages } from '../src/scripts/seed.js';
import { buildSimulatedWebhook, simLedger } from '../src/services/payments/simulated.js';
import { clearSettingsCache } from '../src/services/settings.js';

export const app = createApp();

export async function resetDb() {
  await runMigrations(false);
  await pool.query(`TRUNCATE audit_logs, payment_events, refunds, print_jobs, payments, order_items, orders, token_counters,
                    food_items, food_categories, daily_reports, system_settings, admin_sessions, admin_users RESTART IDENTITY CASCADE`);
  await pool.query(`UPDATE printer_settings SET driver='mock', mock_fail=false, auto_print=true WHERE id=1`);
  clearSettingsCache();
  simLedger.clear();
  fs.rmSync(receiptsDir, { recursive: true, force: true });
  writeSampleImages();
  await seedMenu();
}

export async function itemId(name: string) {
  const { rows } = await pool.query('SELECT id FROM food_items WHERE name=$1', [name]);
  return rows[0].id as number;
}

export function key() {
  return 'test_' + crypto.randomBytes(12).toString('hex');
}

export async function placeOrder(items: [string, number][], idem = key()) {
  const body = { idempotencyKey: idem, items: await Promise.all(items.map(async ([n, q]) => ({ itemId: await itemId(n), quantity: q }))) };
  return request(app).post('/api/kiosk/orders').send(body);
}

export async function pay(orderId: number, accessKey: string) {
  return request(app).post(`/api/kiosk/orders/${orderId}/pay`).set('x-order-key', accessKey);
}

export async function status(orderId: number, accessKey: string) {
  return request(app).get(`/api/kiosk/orders/${orderId}`).set('x-order-key', accessKey);
}

export function simRef(payRes: request.Response) {
  return String(payRes.body.payment.qrPayload).split('/').pop()!;
}

export async function webhook(ref: string, outcome: 'success' | 'fail' | 'wrong_amount', eventId?: string) {
  const hook = buildSimulatedWebhook(ref, outcome, { eventId });
  return request(app).post('/api/webhooks/simulated').set('content-type', 'application/json').set('x-sim-signature', hook.signature).send(hook.raw);
}

/** Full happy path: order -> QR -> verified webhook. Returns order id + access key. */
export async function paidOrder(items: [string, number][]) {
  const o = await placeOrder(items);
  const p = await pay(o.body.id, o.body.accessKey);
  await webhook(simRef(p), 'success');
  await waitPrint(o.body.id);
  return { id: o.body.id as number, accessKey: o.body.accessKey as string };
}

export async function waitPrint(orderId: number, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { rows } = await pool.query('SELECT print_status FROM orders WHERE id=$1', [orderId]);
    if (rows[0] && !['PENDING'].includes(rows[0].print_status)) return rows[0].print_status;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 'TIMEOUT';
}

export async function createAdmin(username: string, role: 'superadmin' | 'admin' | 'staff', password = 'Passw0rd!234') {
  await pool.query(`INSERT INTO admin_users (username, full_name, password_hash, role) VALUES ($1,$1,$2,$3)`, [username, await bcrypt.hash(password, 4), role]);
}

export async function login(username: string, password = 'Passw0rd!234') {
  const agent = request.agent(app);
  const r = await agent.post('/api/admin/auth/login').set('x-crtl-admin', '1').send({ username, password });
  if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.body));
  return agent;
}
