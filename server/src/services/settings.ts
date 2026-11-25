import { z } from 'zod';
import { pool, type Db } from '../db/pool.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

export const settingsSchema = z.object({
  canteen_name: z.string().min(1).max(80),
  institution_name: z.string().max(120),
  logo_url: z.string().max(500).nullable(),
  address: z.string().max(300),
  contact_phone: z.string().max(40),
  contact_email: z.string().max(120),
  welcome_message: z.string().max(120),
  opening_time: hhmm,
  closing_time: hhmm,
  enforce_operating_hours: z.boolean(),
  token_prefix: z.string().max(4),
  token_digits: z.number().int().min(3).max(6),
  report_time: hhmm,
  currency_code: z.literal('INR'),
  currency_symbol: z.string().max(4),
  tax_enabled: z.boolean(),
  tax_label: z.string().max(20),
  tax_rate: z.number().min(0).max(28),
  tax_mode: z.enum(['exclusive', 'inclusive']),
  tax_registration_no: z.string().max(30),
  kiosk_idle_timeout_seconds: z.number().int().min(20).max(900),
  admin_session_timeout_minutes: z.number().int().min(5).max(480),
  max_qty_per_item: z.number().int().min(1).max(50),
  receipt_footer: z.string().max(300),
  upi_payee_name: z.string().max(60),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  canteen_name: 'CRTL Canteen',
  institution_name: 'Central Research & Training Laboratory',
  logo_url: null,
  address: '',
  contact_phone: '',
  contact_email: '',
  welcome_message: 'Welcome to CRTL Canteen',
  opening_time: '07:00',
  closing_time: '22:00',
  enforce_operating_hours: false,
  token_prefix: '',
  token_digits: 5,
  report_time: '23:59',
  currency_code: 'INR',
  currency_symbol: '₹',
  tax_enabled: false,
  tax_label: 'GST',
  tax_rate: 5,
  tax_mode: 'exclusive',
  tax_registration_no: '',
  kiosk_idle_timeout_seconds: 90,
  admin_session_timeout_minutes: 15,
  max_qty_per_item: 20,
  receipt_footer: 'THANK YOU!\nPLEASE COLLECT YOUR ORDER.',
  upi_payee_name: 'CRTL Canteen',
};

let cache: Settings | null = null;

export async function getSettings(db: Db = pool): Promise<Settings> {
  if (cache) return cache;
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM system_settings');
  const merged: Record<string, unknown> = { ...defaultSettings };
  for (const r of rows) if (r.key in defaultSettings) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  cache = parsed.success ? parsed.data : { ...defaultSettings };
  return cache;
}

export async function updateSettings(patch: Partial<Settings>, adminId: number | null, db: Db = pool) {
  const current = await getSettings(db);
  const next = settingsSchema.parse({ ...current, ...patch });
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in defaultSettings)) continue;
    await db.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [k, JSON.stringify((next as Record<string, unknown>)[k]), adminId],
    );
  }
  cache = null;
  return getSettings(db);
}

export function clearSettingsCache() {
  cache = null;
}

/** Public subset safe to send to the kiosk (no internal config). */
export function publicSettings(s: Settings) {
  return {
    canteen_name: s.canteen_name,
    institution_name: s.institution_name,
    logo_url: s.logo_url,
    welcome_message: s.welcome_message,
    currency_symbol: s.currency_symbol,
    tax_enabled: s.tax_enabled,
    tax_label: s.tax_label,
    tax_rate: s.tax_rate,
    tax_mode: s.tax_mode,
    kiosk_idle_timeout_seconds: s.kiosk_idle_timeout_seconds,
    max_qty_per_item: s.max_qty_per_item,
    opening_time: s.opening_time,
    closing_time: s.closing_time,
    enforce_operating_hours: s.enforce_operating_hours,
  };
}
