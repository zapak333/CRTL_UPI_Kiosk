export interface KioskConfig {
  canteen_name: string;
  institution_name: string;
  logo_url: string | null;
  welcome_message: string;
  currency_symbol: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  tax_mode: 'exclusive' | 'inclusive';
  kiosk_idle_timeout_seconds: number;
  max_qty_per_item: number;
  opening_time: string;
  closing_time: string;
  open: boolean;
  paymentProvider: string;
  paymentTestMode: boolean;
}

export interface Category {
  id: number;
  name: string;
  image_url: string | null;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  category_id: number;
  image_url: string | null;
  price: string;
  available: boolean;
}

export interface KioskOrder {
  id: number;
  orderNumber: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  tokenNumber: number | null;
  tokenDisplay: string | null;
  subtotal: string;
  tax: string;
  taxLabel: string | null;
  total: string;
  printStatus: 'NOT_PRINTED' | 'PENDING' | 'PRINTED' | 'FAILED';
  items: { name: string; unitPrice: string; quantity: number; lineTotal: string }[];
  accessKey?: string;
  payment: null | {
    attemptRef: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
    amount: string;
    qrDataUrl?: string;
    qrImageUrl?: string | null;
    qrPayload?: string | null;
    expiresAt: string;
    failureReason: string | null;
    transactionRef: string | null;
  };
}
