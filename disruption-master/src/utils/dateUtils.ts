/**
 * Date and Time utilities formatted for Asia/Kolkata (IST)
 */

export function getCurrentISTDate(): {
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM:SS
  formattedIST: string; // DD/MM/YYYY HH:MM:SS
} {
  const now = new Date();
  // Format for IST timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const day = getPart('day');
  const month = getPart('month');
  const year = getPart('year');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hour}:${minute}:${second}`,
    formattedIST: `${day}/${month}/${year} ${hour}:${minute}:${second}`,
  };
}

export function formatToIST(dateInput: Date | string | number): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';

    const day = getPart('day');
    const month = getPart('month');
    const year = getPart('year');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');

    return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
  } catch {
    return String(dateInput);
  }
}

/**
 * Parses user input date and time to DD/MM/YYYY HH:MM:SS format
 */
export function formatDateTimeIST(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  // dateStr is typically YYYY-MM-DD from HTML5 date input
  const dateParts = dateStr.split('-');
  let day = '01';
  let month = '01';
  let year = '2026';
  if (dateParts.length === 3) {
    year = dateParts[0];
    month = dateParts[1];
    day = dateParts[2];
  }

  // timeStr is HH:MM or HH:MM:SS
  const timeClean = timeStr ? (timeStr.length === 5 ? `${timeStr}:00` : timeStr) : '00:00:00';
  return `${day}/${month}/${year} ${timeClean}`;
}

/**
 * Returns formatted timestamp for ProFix report header: e.g. "8 Sept 2026, 10:59 pm"
 */
export function formatProFixGeneratedTimestamp(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  const formatter = new Intl.DateTimeFormat('en-GB', options);
  // Example result: "8 Sept 2026, 10:59 pm"
  return formatter.format(now).replace(/\bam\b/g, 'am').replace(/\bpm\b/g, 'pm');
}

/**
 * Returns safe timestamp for ProFix filename: e.g. "20260908_2259"
 */
export function getProFixFileTimestamp(): string {
  const { dateStr, timeStr } = getCurrentISTDate();
  const yyyymmdd = dateStr.replace(/-/g, '');
  const hhmm = timeStr.replace(/:/g, '').slice(0, 4);
  return `${yyyymmdd}_${hhmm}`;
}

/**
 * Parses the timestamp shapes this app stores — "DD/MM/YYYY HH:MM:SS" written
 * by the server, and "YYYY-MM-DD HH:MM" as it arrives from sheets — into epoch
 * milliseconds. The wall-clock reading is always Asia/Kolkata.
 *
 * Returns null when the value is missing or cannot be read, so callers can show
 * a dash instead of inventing a number.
 */
export function parseISTTimestamp(value?: string): number | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[\sT]+/);
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';

  const dateBits = datePart.split(/[/.-]/).map(Number);
  if (dateBits.length === 3 && dateBits.every((n) => Number.isFinite(n))) {
    const hms = timePart.split(':').map((v) => Number(v) || 0);
    // A leading 4-digit value means YYYY-MM-DD, otherwise it is DD/MM/YYYY.
    const isIsoOrder = dateBits[0] > 1000;
    const year = isIsoOrder ? dateBits[0] : dateBits[2];
    const month = dateBits[1];
    const day = isIsoOrder ? dateBits[2] : dateBits[0];
    const fullYear = year < 100 ? 2000 + year : year;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Shift by the IST offset (UTC+5:30) to get a true epoch value.
      const ms = Date.UTC(fullYear, month - 1, day, hms[0] - 5, hms[1] - 30, hms[2] || 0);
      if (!isNaN(ms)) return ms;
    }
  }

  const fallback = new Date(trimmed).getTime();
  return isNaN(fallback) ? null : fallback;
}

/** Whole hours elapsed between an IST timestamp and now; null if unparseable. */
export function hoursSince(istTimestamp?: string): number | null {
  const start = parseISTTimestamp(istTimestamp);
  if (start === null) return null;
  return (Date.now() - start) / (1000 * 60 * 60);
}

/**
 * Duration in hours from the disruption start time to now, or null when the
 * start time is missing or unparseable — the caller renders a dash rather than
 * a made-up number.
 */
export function calculateDurationHours(disruptionStartDateTime?: string, fallbackDuration?: string): number | null {
  if (fallbackDuration) {
    const num = parseFloat(fallbackDuration.replace(/[^0-9.]/g, ''));
    if (!isNaN(num) && num > 0) return num;
  }

  const startTimestamp = parseISTTimestamp(disruptionStartDateTime);
  if (startTimestamp === null) return null;

  const diffMs = Date.now() - startTimestamp;
  if (diffMs <= 0) return null;
  return Math.max(0.1, Number((diffMs / (1000 * 60 * 60)).toFixed(1)));
}

/**
 * Hours between two IST timestamps, for closed records where both the start and
 * the closure are known. Null when either end is missing or the order is wrong.
 */
export function hoursBetween(startIST?: string, endIST?: string): number | null {
  const start = parseISTTimestamp(startIST);
  const end = parseISTTimestamp(endIST);
  if (start === null || end === null) return null;
  const diffMs = end - start;
  if (diffMs < 0) return null;
  return Number((diffMs / (1000 * 60 * 60)).toFixed(2));
}
