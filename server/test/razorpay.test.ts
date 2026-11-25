import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
});
