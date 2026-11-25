import express, { Router } from 'express';
import { pool } from '../db/pool.js';
import { ah } from '../lib/validate.js';
import { applyProviderUpdate } from '../services/orders.js';
import { providerByName } from '../services/payments/index.js';

export const webhookRouter = Router();

/**
 * POST /api/webhooks/:provider
 * 1. Verify the HMAC signature over the RAW body (reject + log if invalid).
 * 2. Record the event (unique per provider event id -> duplicate deliveries are acknowledged and ignored).
 * 3. Apply it through the same locked state machine used by API polling (idempotent).
 */
webhookRouter.post('/:provider', express.raw({ type: '*/*', limit: '256kb' }), ah(async (req, res) => {
  const provider = providerByName(String(req.params.provider));
  if (!provider) return res.status(404).json({ error: 'unknown provider' });
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  let body: any = null;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    /* recorded below as invalid */
  }
  const valid = provider.verifyWebhookSignature(raw, req.headers);
  const parsed = valid ? provider.parseWebhook(body, req.headers) : null;
  const eventType = typeof body?.event === 'string' ? body.event.slice(0, 60) : 'unknown';

  if (!valid) {
    await pool.query(
      `INSERT INTO payment_events (provider, provider_event_id, event_type, signature_valid, processing_result, payload) VALUES ($1,$2,$3,false,'rejected_signature',$4)`,
      [provider.name, null, eventType, JSON.stringify(body ?? { raw: raw.toString('utf8').slice(0, 2000) })],
    );
    console.warn(`[webhook] rejected ${provider.name} event with invalid signature from ${req.ip}`);
    return res.status(401).json({ error: 'invalid signature' });
  }

  const eventId = parsed?.eventId ?? null;
  const ins = await pool.query(
    `INSERT INTO payment_events (provider, provider_event_id, event_type, signature_valid, payload) VALUES ($1,$2,$3,true,$4)
     ON CONFLICT DO NOTHING RETURNING id`,
    [provider.name, eventId, eventType, JSON.stringify(body)],
  );
  if (!ins.rows[0]) return res.json({ status: 'duplicate_event' });
  const eventRowId = ins.rows[0].id;

  if (!parsed) {
    await pool.query(`UPDATE payment_events SET processing_result='ignored_event_type' WHERE id=$1`, [eventRowId]);
    return res.json({ status: 'ignored' });
  }
  const { rows } = await pool.query(
    `SELECT id FROM payments WHERE provider=$1 AND (attempt_ref=$2 OR provider_order_ref=$3) ORDER BY id DESC LIMIT 1`,
    [provider.name, parsed.attemptRef ?? '', parsed.providerOrderRef ?? ''],
  );
  if (!rows[0]) {
    await pool.query(`UPDATE payment_events SET processing_result='unknown_payment' WHERE id=$1`, [eventRowId]);
    return res.json({ status: 'unknown_payment' });
  }
  const result = await applyProviderUpdate(rows[0].id, parsed, 'webhook', { type: 'provider', name: provider.name, ip: req.ip });
  await pool.query(`UPDATE payment_events SET payment_id=$2, processing_result=$3 WHERE id=$1`, [eventRowId, rows[0].id, result]);
  res.json({ status: result });
}));
