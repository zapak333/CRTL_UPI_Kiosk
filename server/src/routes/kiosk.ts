import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { actorOf } from '../middleware/auth.js';
import { ah, idParam, parse } from '../lib/validate.js';
import { istMinutesNow } from '../lib/time.js';
import { activeProvider } from '../services/payments/index.js';
import { assertAccess, cancelOrder, createOrder, getOrderForKiosk, reconcileOrder, startPayment } from '../services/orders.js';
import { getSettings, publicSettings } from '../services/settings.js';

export const kioskRouter = Router();

kioskRouter.use(rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 300, standardHeaders: true, legacyHeaders: false }));

kioskRouter.get('/config', ah(async (_req, res) => {
  const s = await getSettings();
  const now = istMinutesNow();
  const [oh, om] = s.opening_time.split(':').map(Number);
  const [ch, cm] = s.closing_time.split(':').map(Number);
  const open = !s.enforce_operating_hours || (now >= oh * 60 + om && now <= ch * 60 + cm);
  const provider = activeProvider();
  res.json({ ...publicSettings(s), open, paymentProvider: provider.name, paymentTestMode: provider.isTestMode, serverTime: new Date().toISOString() });
}));

kioskRouter.get('/menu', ah(async (_req, res) => {
  const { rows: cats } = await pool.query(
    `SELECT id, name, image_url FROM food_categories WHERE is_active AND deleted_at IS NULL ORDER BY display_order, name`,
  );
  // 'disabled' items are hidden entirely; 'temporarily_unavailable' are shown greyed out.
  const { rows: items } = await pool.query(
    `SELECT i.id, i.name, i.description, i.category_id, i.image_url, i.price::text AS price, i.availability_status
       FROM food_items i JOIN food_categories c ON c.id = i.category_id
      WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_active AND i.availability_status <> 'disabled'
      ORDER BY i.display_order, i.name`,
  );
  res.set('Cache-Control', 'no-store');
  res.json({ categories: cats, items: items.map((i) => ({ ...i, available: i.availability_status === 'available' })) });
}));

const orderSchema = z.object({
  idempotencyKey: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  kioskId: z.string().max(60).optional(),
  items: z.array(z.object({ itemId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) })).min(1).max(60),
});

kioskRouter.post('/orders', ah(async (req, res) => {
  const body = parse(orderSchema, req.body);
  const order = await createOrder(body.items, body.idempotencyKey, body.kioskId ?? null, actorOf(req));
  if (order.duplicate) {
    // Same idempotency key replayed: hand back the access key only to the same kiosk request flow.
    const { rows } = await pool.query('SELECT access_key FROM orders WHERE id=$1', [order.id]);
    return res.json({ ...order, accessKey: rows[0].access_key });
  }
  res.status(201).json(order);
}));

const key = (req: any) => String(req.get('x-order-key') ?? '');

kioskRouter.post('/orders/:id/pay', ah(async (req, res) => {
  const id = idParam(req);
  await assertAccess(id, key(req));
  const order = await startPayment(id, actorOf(req));
  res.json(await withQr(order));
}));

kioskRouter.get('/orders/:id', ah(async (req, res) => {
  const id = idParam(req);
  await assertAccess(id, key(req));
  await reconcileOrder(id); // server-side API verification fallback (throttled)
  res.set('Cache-Control', 'no-store');
  res.json(await withQr(await getOrderForKiosk(id)));
}));

kioskRouter.post('/orders/:id/cancel', ah(async (req, res) => {
  const id = idParam(req);
  await assertAccess(id, key(req));
  res.json(await cancelOrder(id, actorOf(req)));
}));

async function withQr<T extends Awaited<ReturnType<typeof getOrderForKiosk>>>(order: T) {
  if (order.payment?.status === 'PENDING' && order.payment.qrPayload) {
    const qrDataUrl = await QRCode.toDataURL(order.payment.qrPayload, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
    return { ...order, payment: { ...order.payment, qrDataUrl } };
  }
  return order;
}
