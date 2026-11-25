// Business dates and times are always in Indian Standard Time (UTC+05:30, no DST).
const IST_OFFSET_MS = 330 * 60 * 1000;

/** IST calendar date (YYYY-MM-DD) for an instant. */
export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** DD-MM-YYYY in IST */
export function istDisplayDate(d: Date): string {
  const [y, m, day] = istDate(d).split('-');
  return `${day}-${m}-${y}`;
}

/** hh:mm AM/PM in IST */
export function istDisplayTime(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  let h = t.getUTCHours();
  const m = t.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Current IST time as minutes since midnight */
export function istMinutesNow(d: Date = new Date()): number {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}
