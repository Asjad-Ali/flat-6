/**
 * Dates are stored as local calendar dates in ISO form ("YYYY-MM-DD").
 * String comparison of ISO dates matches chronological order, which SQLite relies on.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Parses an ISO date as a local date (never shifted by timezone). */
export function parseISODate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Whole days from `from` to `to` (to - from). DST-safe. */
export function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const day = parseISODate(iso).getDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(iso, offset);
}

export function formatDate(iso: string, style: 'short' | 'long' = 'short'): string {
  const date = parseISODate(iso);
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return style === 'long' ? `${WEEKDAYS[date.getDay()]}, ${base}` : base;
}

/** "2 – 8 Nov 2026", "28 Oct – 3 Nov 2026", "29 Dec 2025 – 4 Jan 2026". */
export function formatRange(from: string, to: string): string {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(from)} – ${formatDate(to)}`;
  if (a.getMonth() !== b.getMonth()) {
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

export function relativeDayLabel(iso: string, today = todayISO()): string {
  const diff = diffDays(iso, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatDate(iso, 'long');
}

/** Formats an SQLite UTC timestamp or ISO timestamp ("YYYY-MM-DD HH:MM:SS") in local time: "8 Nov 2026, 14:05". */
export function formatTimestamp(sqliteUtc: string): string {
  // SQLite gives "YYYY-MM-DD HH:MM:SS" (UTC); Firebase data uses full ISO with a time zone.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(sqliteUtc) ? sqliteUtc.replace(' ', 'T') : `${sqliteUtc.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sqliteUtc;
  return `${formatDate(toISODate(date))}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** List section header: "Today · Sun, 8 Nov 2026", "Yesterday · …", or just the full date. */
export function dayHeader(iso: string, today = todayISO()): string {
  const rel = relativeDayLabel(iso, today);
  const full = formatDate(iso, 'long');
  return rel === full ? full : `${rel} · ${full}`;
}

/** "YYYY-MM" month key. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${pad(last)}` };
}

export function addMonths(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, m - 1 + months, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}
