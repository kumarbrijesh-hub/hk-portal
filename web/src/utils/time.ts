/** IST (+05:30, no DST) formatting helpers mirroring the server's utils/time.ts. */
const IST_OFFSET_MS = 330 * 60 * 1000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

interface Parts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

export function istParts(iso: string | Date): Parts {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** "08-09-2026 22:59:03" */
export function formatIst(iso: string | null | undefined, withSeconds = true): string {
  if (!iso) return '—';
  const p = istParts(iso);
  const time = withSeconds
    ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : `${pad(p.hour)}:${pad(p.minute)}`;
  return `${pad(p.day)}-${pad(p.month)}-${p.year} ${time}`;
}

/** "22:59" */
export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = istParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Value for a <input type="datetime-local"> holding IST wall-clock time. */
export function toDatetimeLocal(iso: string | Date = new Date()): string {
  const p = istParts(iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Today's IST calendar date, for <input type="date">. */
export function istToday(): string {
  const p = istParts(new Date());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2h 14m ago" - relative age used in the tracker table. */
export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export function formatHours(value: number): string {
  return `${value.toFixed(1)}`;
}
