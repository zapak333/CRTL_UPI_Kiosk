import crypto from 'node:crypto';
import { config } from '../../config.js';
import type { CreateQrInput, CreateQrResult, ParsedWebhook, PaymentProvider, ProviderPaymentUpdate, RefundResult } from './types.js';
import { header } from './types.js';

/**
 * Simulated UPI provider for development and testing.
 *
 * It behaves like a real gateway: it issues a QR per attempt, keeps its own record of what was "paid",
 * signs webhooks with HMAC-SHA256 and answers server-side status lookups. The QR does NOT contain a real
 * UPI address; it opens a "simulated UPI app" page served by this server, so no real money can move.
 */
interface SimRecord {
  attemptRef: string;
  amountPaise: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  paymentRef?: string;
  paidAmountPaise?: number;
  rrn?: string;
  failureReason?: string;
  orderNumber: string;
  expiresAt: Date;
}

export const simLedger = new Map<string, SimRecord>(); // providerOrderRef -> record

export function signSimulated(body: string): string {
  return crypto.createHmac('sha256', config.payment.simulatedWebhookSecret).update(body).digest('hex');
}

export class SimulatedProvider implements PaymentProvider {
  readonly name = 'simulated' as const;
  readonly isTestMode = true;

  async createQr(input: CreateQrInput): Promise<CreateQrResult> {
    const ref = 'simqr_' + crypto.randomBytes(8).toString('hex');
    simLedger.set(ref, {
      attemptRef: input.attemptRef,
      amountPaise: input.amountPaise,
      status: 'PENDING',
      orderNumber: input.orderNumber,
      expiresAt: input.expiresAt,
    });
    return { providerOrderRef: ref, qrPayload: `${config.publicUrl}/sim-upi/${ref}`, qrImageUrl: null };
  }

  async fetchStatus(providerOrderRef: string): Promise<ProviderPaymentUpdate> {
    const r = simLedger.get(providerOrderRef);
    if (!r) return { status: 'PENDING' };
    if (r.status === 'SUCCESS')
      return { status: 'SUCCESS', providerOrderRef, attemptRef: r.attemptRef, providerPaymentRef: r.paymentRef, amountPaise: r.paidAmountPaise, currency: 'INR', rrn: r.rrn, payerVpa: 'te****@simbank' };
    if (r.status === 'FAILED') return { status: 'FAILED', providerOrderRef, attemptRef: r.attemptRef, failureReason: r.failureReason };
    if (r.status === 'CLOSED' || r.expiresAt.getTime() < Date.now()) return { status: 'EXPIRED', providerOrderRef };
    return { status: 'PENDING', providerOrderRef };
  }

  async closeQr(providerOrderRef: string) {
    const r = simLedger.get(providerOrderRef);
    if (r && r.status === 'PENDING') r.status = 'CLOSED';
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = header(headers, 'x-sim-signature');
    if (!sig) return false;
    const expected = signSimulated(rawBody.toString('utf8'));
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(body: any): ParsedWebhook | null {
    if (!body || typeof body !== 'object' || typeof body.event !== 'string') return null;
    const p = body.payload ?? {};
    const status = body.event === 'payment.captured' ? 'SUCCESS' : body.event === 'payment.failed' ? 'FAILED' : null;
    if (!status) return null;
    return {
      eventId: typeof body.id === 'string' ? body.id : null,
      eventType: body.event,
      status,
      providerOrderRef: p.qr_id ?? null,
      attemptRef: p.attempt_ref ?? null,
      providerPaymentRef: p.payment_id ?? null,
      amountPaise: typeof p.amount === 'number' ? p.amount : null,
      currency: p.currency ?? null,
      rrn: p.rrn ?? null,
      payerVpa: p.vpa ?? null,
      failureReason: p.error_description ?? null,
    };
  }

  async refund(_providerPaymentRef: string, _amountPaise: number): Promise<RefundResult> {
    return { providerRefundRef: 'simrfnd_' + crypto.randomBytes(6).toString('hex'), status: 'COMPLETED' };
  }
}

/** Build a signed webhook as the simulated bank would send it. Used by the simulator page and tests. */
export function buildSimulatedWebhook(
  providerOrderRef: string,
  outcome: 'success' | 'fail' | 'wrong_amount',
  opts: { eventId?: string } = {},
) {
  const r = simLedger.get(providerOrderRef);
  if (!r) throw new Error('Unknown simulated QR');
  if (outcome === 'fail') {
    r.status = 'FAILED';
    r.failureReason = 'Payment declined by payer bank (simulated)';
  } else {
    r.status = 'SUCCESS';
    r.paymentRef = r.paymentRef ?? 'simpay_' + crypto.randomBytes(8).toString('hex');
    r.rrn = r.rrn ?? String(Math.floor(1e11 + Math.random() * 9e11));
    r.paidAmountPaise = outcome === 'wrong_amount' ? Math.max(100, r.amountPaise - 1000) : r.amountPaise;
  }
  const body = {
    id: opts.eventId ?? 'simevt_' + crypto.randomBytes(8).toString('hex'),
    event: outcome === 'fail' ? 'payment.failed' : 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      qr_id: providerOrderRef,
      attempt_ref: r.attemptRef,
      payment_id: r.paymentRef ?? null,
      amount: r.paidAmountPaise ?? r.amountPaise,
      currency: 'INR',
      rrn: r.rrn ?? null,
      vpa: 'te****@simbank',
      error_description: r.failureReason ?? null,
    },
  };
  const raw = JSON.stringify(body);
  return { raw, signature: signSimulated(raw), body };
}
