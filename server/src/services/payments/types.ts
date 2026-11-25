export type ProviderName = 'simulated' | 'razorpay';

export interface CreateQrInput {
  attemptRef: string;      // our unique transaction reference
  amountPaise: number;
  orderNumber: string;
  description: string;
  payeeName: string;
  expiresAt: Date;
}

export interface CreateQrResult {
  providerOrderRef: string;
  /** Text to encode into a QR on our side (preferred), e.g. a upi://pay?... string */
  qrPayload: string | null;
  /** Provider-hosted QR image, used when no payload is returned */
  qrImageUrl: string | null;
}

export type ProviderStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

/** Normalised view of a provider event (webhook) or status lookup. */
export interface ProviderPaymentUpdate {
  status: ProviderStatus;
  providerOrderRef?: string | null;
  attemptRef?: string | null;
  providerPaymentRef?: string | null;
  amountPaise?: number | null;
  currency?: string | null;
  rrn?: string | null;
  payerVpa?: string | null;
  failureReason?: string | null;
}

export interface ParsedWebhook extends ProviderPaymentUpdate {
  eventId: string | null;
  eventType: string;
}

export interface RefundResult {
  providerRefundRef: string | null;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  failureReason?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly isTestMode: boolean;
  createQr(input: CreateQrInput): Promise<CreateQrResult>;
  /** Ask the provider (server-to-server) what happened to a QR/payment attempt. */
  fetchStatus(providerOrderRef: string, attemptRef: string): Promise<ProviderPaymentUpdate>;
  closeQr(providerOrderRef: string): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: any, headers: Record<string, string | string[] | undefined>): ParsedWebhook | null;
  refund(providerPaymentRef: string, amountPaise: number, notes: Record<string, string>): Promise<RefundResult>;
}

export class ProviderUnavailableError extends Error {}

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
