import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { RazorpayProvider } from '../src/services/payments/razorpay.js';

// Offline checks of the Razorpay adapter using payloads shaped like Razorpay's documented webhooks.
// Live API calls are covered by the sandbox checklist in docs/PAYMENTS.md.
const p = new RazorpayProvider();
const secret = 'unit-test-webhook-secret';

function qrCredited(status = 'captured', amount = 17000) {
  return {
    entity: 'event',
    event: 'qr_code.credited',
    payload: {
      payment: { entity: { id: 'pay_TEST123', amount, currency: 'INR', status, vpa: 'customer@okbank', notes: {}, acquirer_data: { rrn: '432112345678' } } },
      qr_code: { entity: { id: 'qr_TEST123', status: 'closed', notes: { attempt_ref: 'CRTL1A1ABC', order_number: 'CRTL-20261125-000001' } } },
    },
  };
}

describe('Razorpay adapter (offline)', () => {
  it('verifies X-Razorpay-Signature over the raw body and rejects tampering', () => {
    (config.payment as any).razorpayWebhookSecret = secret;
    const raw = Buffer.from(JSON.stringify(qrCredited()));
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    expect(p.verifyWebhookSignature(raw, { 'x-razorpay-signature': sig })).toBe(true);
    const tampered = Buffer.from(raw.toString().replace('17000', '100'));
    expect(p.verifyWebhookSignature(tampered, { 'x-razorpay-signature': sig })).toBe(false);
    expect(p.verifyWebhookSignature(raw, {})).toBe(false);
  });

  it('maps qr_code.credited to a verified success with amount, refs and masked VPA', () => {
    const u = p.parseWebhook(qrCredited(), { 'x-razorpay-event-id': 'evt_1' })!;
    expect(u).toMatchObject({
      eventId: 'evt_1', status: 'SUCCESS', providerOrderRef: 'qr_TEST123', attemptRef: 'CRTL1A1ABC',
      providerPaymentRef: 'pay_TEST123', amountPaise: 17000, currency: 'INR', rrn: '432112345678', payerVpa: 'cu****@okbank',
    });
  });

  it('does not treat an uncaptured credit as success and ignores unrelated events', () => {
    expect(p.parseWebhook(qrCredited('authorized'), {})!.status).toBe('PENDING');
    expect(p.parseWebhook({ event: 'order.paid', payload: {} }, {})).toBeNull();
  });

  it('retries QR creation with a later close_by when Razorpay rejects the first one', async () => {
    (config.payment as any).razorpayKeyId = 'rzp_test_dummy';
    (config.payment as any).razorpayKeySecret = 'dummy';
    const bodies: any[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'close_by should be at least 15 minutes after current time' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'qr_X', image_url: 'https://rzp.io/i/abc', status: 'active' }), { status: 200 });
    });
    try {
      const r = await p.createQr({ attemptRef: 'A1', amountPaise: 100, orderNumber: 'O1', description: 'd', payeeName: 'n', expiresAt: new Date(Date.now() + 5 * 60_000) });
      expect(r).toEqual({ providerOrderRef: 'qr_X', qrPayload: null, qrImageUrl: 'https://rzp.io/i/abc' });
      expect(bodies).toHaveLength(2);
      expect(bodies[1].close_by - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(15 * 60);
    } finally {
      fetchMock.mockRestore();
      (config.payment as any).razorpayKeyId = '';
      (config.payment as any).razorpayKeySecret = '';
    }
  });
});
