// All arithmetic is done in integer paise to avoid floating point errors.

/** Parse a NUMERIC string/number (rupees) into integer paise. */
export function toPaise(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const s = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
  const neg = s.startsWith('-');
  const [intPart, frac = ''] = s.replace('-', '').split('.');
  const p = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(p)) throw new Error(`Invalid amount: ${v}`);
  return neg ? -p : p;
}

/** Integer paise -> NUMERIC string, e.g. 12345 -> "123.45" */
export function fromPaise(p: number): string {
  const neg = p < 0;
  const a = Math.abs(Math.round(p));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Display format: ₹1,234.50 or ₹1,234 when whole rupees (Indian digit grouping). */
export function formatINR(p: number, symbol = '₹'): string {
  const neg = p < 0;
  const a = Math.abs(p);
  const rupees = Math.floor(a / 100);
  const paise = a % 100;
  const r = rupees.toLocaleString('en-IN');
  return `${neg ? '-' : ''}${symbol}${r}${paise ? '.' + String(paise).padStart(2, '0') : ''}`;
}

/** Percentage (e.g. 5 or 2.5) of an amount in paise, rounded half-up to the nearest paisa. */
export function percentOf(p: number, rate: number): number {
  return Math.round((p * Math.round(rate * 100)) / 10000);
}
