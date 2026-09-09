/**
 * All operational timestamps are stored as ISO-8601 UTC strings and presented in
 * IST. India has no DST, so a fixed +05:30 offset is exact and avoids pulling in
 * a timezone database.
 */
const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

export const IST_LABEL = 'IST';

export function nowIso(): string {
  return new Date().toISOString();
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Civil date/time parts as seen on an IST wall clock. */
export interface IstParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

export function toIstParts(iso: string | Date): IstParts {
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

/** Builds a UTC ISO string from IST wall-clock parts. */
export function istPartsToIso(parts: IstParts): string {
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - IST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/**
 * Accepts the formats the UI and Google Sheet can produce and normalises to UTC ISO:
 *   DD/MM/YYYY HH:MM:SS   DD-MM-YYYY HH:MM:SS   YYYY-MM-DD HH:MM:SS
 *   YYYY-MM-DDTHH:MM(:SS) (datetime-local input, interpreted as IST)
 * Returns null when the value is not a valid calendar timestamp.
 */
export function parseIstInputToIso(input: string): string | null {
  const value = (input ?? '').trim();
  if (!value) return null;

  // Already an absolute instant with an explicit offset - trust it.
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  let match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return buildIso(+match[3], +match[2], +match[1], +match[4], +match[5], +(match[6] ?? 0));
  }

  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return buildIso(+match[1], +match[2], +match[3], +match[4], +match[5], +(match[6] ?? 0));
  }

  return null;
}

function buildIso(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const iso = istPartsToIso({ year, month, day, hour, minute, second });
  // Reject rolled-over dates such as 31/02/2026.
  const back = toIstParts(iso);
  if (back.year !== year || back.month !== month || back.day !== day) return null;
  return iso;
}

/** "08-09-2026 22:59:03" */
export function formatIst(iso: string | null | undefined, withSeconds = true): string {
  if (!iso) return '';
  const p = toIstParts(iso);
  const time = withSeconds
    ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : `${pad(p.hour)}:${pad(p.minute)}`;
  return `${pad(p.day)}-${pad(p.month)}-${p.year} ${time}`;
}

/** "8 Sept 2026, 10:59 pm" - matches the report header styling. */
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

export function formatIstFriendly(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = toIstParts(iso);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const meridiem = p.hour < 12 ? 'am' : 'pm';
  return `${p.day} ${MONTH_LABELS[p.month - 1]} ${p.year}, ${hour12}:${pad(p.minute)} ${meridiem}`;
}

/** YYMMDDHHMM in IST - the suffix of a Disruption ID. */
export function istStampYYMMDDHHMM(iso: string): string {
  const p = toIstParts(iso);
  return `${pad(p.year % 100)}${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}`;
}

export function hoursBetween(fromIso: string, toIso: string = nowIso()): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, ms) / 3_600_000;
}

export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
