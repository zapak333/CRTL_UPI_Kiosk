import crypto from 'node:crypto';
import { config } from '../../config.js';
import type { CreateQrInput, CreateQrResult, ParsedWebhook, PaymentProvider, ProviderPaymentUpdate, RefundResult } from './types.js';
import { ProviderUnavailableError, header } from './types.js';

/**
 * Razorpay UPI QR Codes integration.
 *
 * STATUS: written against Razorpay's documented QR Codes / Payments / Refunds APIs but NOT YET TESTED
 * against a live Razorpay account. Test it in Razorpay Test Mode before going live (see docs/PAYMENTS.md).
 *
 * - QR:       POST /v1/payments/qr_codes  (type=upi_qr, usage=single_use, fixed_amount=true)
 * - Status:   GET  /v1/payments/qr_codes/:id/payments
 * - Close:    POST /v1/payments/qr_codes/:id/close
 * - Refund:   POST /v1/payments/:payment_id/refund
 * - Webhooks: qr_code.credited, payment.captured, payment.failed; header X-Razorpay-Signature =
 *             hex(HMAC_SHA256(raw_body, webhook_secret)); header X-Razorpay-Event-Id for de-duplication.
 */
const BASE = 'https://api.razorpay.com/v1';

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  get isTestMode() {
    return config.payment.razorpayKeyId.startsWith('rzp_test_');
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const { razorpayKeyId, razorpayKeySecret } = config.payment;
    if (!razorpayKeyId || !razorpayKeySecret) throw new ProviderUnavailableError('Razorpay keys are not configured');
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      throw new ProviderUnavailableError(`Cannot reach Razorpay: ${(e as Error).message}`);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.description ?? `HTTP ${res.status}`;
      if (res.status >= 500) throw new ProviderUnavailableError(`Razorpay error: ${msg}`);
      throw new Error(`Razorpay rejected request: ${msg}`);
    }
    return json;
  }

  async createQr(input: CreateQrInput): Promise<CreateQrResult> {
    // Razorpay requires close_by to be some minutes in the future; keep at least 3 min.
    const closeBy = Math.max(Math.floor(input.expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 180);
    const qr = await this.call('POST', '/payments/qr_codes', {
      type: 'upi_qr',
      name: input.payeeName.slice(0, 40),
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: input.amountPaise,
      description: input.description.slice(0, 100),
      close_by: closeBy,
      notes: { attempt_ref: input.attemptRef, order_number: input.orderNumber },
    });
    return { providerOrderRef: qr.id, qrPayload: qr.image_content ?? null, qrImageUrl: qr.image_url ?? null };
  }

  async fetchStatus(providerOrderRef: string, attemptRef: string): Promise<ProviderPaymentUpdate> {
    const list = await this.call('GET', `/payments/qr_codes/${encodeURIComponent(providerOrderRef)}/payments`);
    const items: any[] = list?.items ?? [];
    const captured = items.find((p) => p.status === 'captured');
    if (captured) return this.fromPayment(captured, providerOrderRef, attemptRef);
    const failed = items.find((p) => p.status === 'failed');
    if (failed) return this.fromPayment(failed, providerOrderRef, attemptRef);
    const qr = await this.call('GET', `/payments/qr_codes/${encodeURIComponent(providerOrderRef)}`);
    if (qr?.status === 'closed') return { status: 'EXPIRED', providerOrderRef };
    return { status: 'PENDING', providerOrderRef };
  }

  private fromPayment(p: any, providerOrderRef: string | null, attemptRef: string | null): ProviderPaymentUpdate {
    return {
      status: p.status === 'captured' ? 'SUCCESS' : p.status === 'failed' ? 'FAILED' : 'PENDING',
      providerOrderRef,
      attemptRef: attemptRef ?? p.notes?.attempt_ref ?? null,
      providerPaymentRef: p.id ?? null,
      amountPaise: typeof p.amount === 'number' ? p.amount : null,
      currency: p.currency ?? null,
      rrn: p.acquirer_data?.rrn ?? null,
      payerVpa: maskVpa(p.vpa),
      failureReason: p.error_description ?? null,
    };
  }

  async closeQr(providerOrderRef: string) {
    try {
      await this.call('POST', `/payments/qr_codes/${encodeURIComponent(providerOrderRef)}/close`);
    } catch {
      /* already closed or unreachable; status checks will reconcile */
    }
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = config.payment.razorpayWebhookSecret;
    const sig = header(headers, 'x-razorpay-signature');
    if (!secret || !sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(body: any, headers: Record<string, string | string[] | undefined>): ParsedWebhook | null {
    if (!body || typeof body.event !== 'string') return null;
    const eventId = header(headers, 'x-razorpay-event-id') ?? null;
    const payment = body.payload?.payment?.entity;
    const qr = body.payload?.qr_code?.entity;
    if (!payment) return null;
    if (!['qr_code.credited', 'payment.captured', 'payment.failed'].includes(body.event)) return null;
    const upd = this.fromPayment(payment, qr?.id ?? null, qr?.notes?.attempt_ref ?? payment.notes?.attempt_ref ?? null);
    if (body.event === 'qr_code.credited' && payment.status !== 'captured') upd.status = 'PENDING';
    return { ...upd, eventId, eventType: body.event };
  }

  async refund(providerPaymentRef: string, amountPaise: number, notes: Record<string, string>): Promise<RefundResult> {
    try {
      const r = await this.call('POST', `/payments/${encodeURIComponent(providerPaymentRef)}/refund`, { amount: amountPaise, speed: 'normal', notes });
      return { providerRefundRef: r.id, status: r.status === 'processed' ? 'COMPLETED' : r.status === 'failed' ? 'FAILED' : 'PENDING' };
    } catch (e) {
      return { providerRefundRef: null, status: 'FAILED', failureReason: (e as Error).message };
    }
  }
}

function maskVpa(vpa?: string | null) {
  if (!vpa) return null;
  const [u, d] = vpa.split('@');
  return `${u.slice(0, 2)}****@${d ?? ''}`;
}
