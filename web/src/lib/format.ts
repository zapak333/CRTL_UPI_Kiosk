/** Rupee formatting with Indian digit grouping. Amounts from the API are decimal strings (e.g. "170.00"). */
export function toPaise(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return 0;
  const [i, f = ''] = String(typeof v === 'number' ? v.toFixed(2) : v).replace('-', '').split('.');
  const p = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return String(v).startsWith('-') ? -p : p;
}
export function inr(v: string | number | null | undefined, opts: { decimals?: boolean } = {}) {
  const p = toPaise(v);
  const neg = p < 0;
  const a = Math.abs(p);
  const r = Math.floor(a / 100).toLocaleString('en-IN');
  const d = a % 100;
  return `${neg ? '-' : ''}₹${r}${d || opts.decimals ? '.' + String(d).padStart(2, '0') : ''}`;
}
export function inrPaise(p: number) {
  return inr((p / 100).toFixed(2));
}
export function istDateTime(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}
export function istTime(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
}
export function istToday() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}
export function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}-${m}-${y}`;
}
