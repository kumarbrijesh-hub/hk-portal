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
 * Returns formatted timestamp for the report header: e.g. "8 Sept 2026, 10:59 pm"
 */
export function formatReportGeneratedTimestamp(): string {
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
 * Returns safe timestamp for report filenames: e.g. "20260908_2259"
 */
export function getReportFileTimestamp(): string {
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

/**
 * Reads a disruption start that was typed or pasted as one string.
 *
 * The start used to be collected as a separate date picker and time box, which
 * meant a start copied from a sheet or a chat had to be split by hand before it
 * could be entered. This takes the whole thing at once.
 *
 * Accepted, with '-', '/' or '.' between the date parts and a space or 'T'
 * before the time:
 *
 *   YY-MM-DD HH:MM        26-11-10 14:35
 *   YYYY-MM-DD HH:MM:SS   2026-11-10 14:35:00
 *   DD-MM-YYYY HH:MM      10-11-2026 14:35   (year last, when it has 4 digits)
 *
 * The time may be left off, and is then midnight. Seconds may be left off, and
 * are then zero. A two-digit year is read as 20YY: this logs live disruptions,
 * so a 19xx start is a typo, not a date.
 *
 * Returns the pieces the rest of the form already works in - a YYYY-MM-DD date
 * and an HH:MM:SS time - or null when the string is not a date at all. A
 * calendar check is part of that: 2026-02-31 is rejected rather than rolled
 * forward into March, because silently moving someone's start time is worse
 * than telling them it did not parse.
 */
export function parseStartDateTimeInput(
  raw: string
): { date: string; time: string } | null {
  const text = (raw || '').trim();
  if (!text) return null;

  const match = text.match(
    /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/
  );
  if (!match) return null;

  const [, first, middle, third, hourRaw, minuteRaw, secondRaw] = match;

  // Which end carries the year: a 4-digit group settles it, otherwise the
  // leading group is the year, as in the YY-MM-DD the team pastes.
  let yearRaw: string;
  let monthRaw: string;
  let dayRaw: string;
  if (third.length === 4) {
    dayRaw = first;
    monthRaw = middle;
    yearRaw = third;
  } else if (first.length === 3) {
    // Three digits is a mistyped year, not one we should guess at.
    return null;
  } else {
    yearRaw = first;
    monthRaw = middle;
    dayRaw = third;
  }

  const year = yearRaw.length <= 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = hourRaw === undefined ? 0 : Number(hourRaw);
  const minute = minuteRaw === undefined ? 0 : Number(minuteRaw);
  const second = secondRaw === undefined ? 0 : Number(secondRaw);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Rejects a day the month does not have, rather than rolling it over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return {
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

/**
 * The same value written back out in the shape the field shows: the full
 * YYYY-MM-DD HH:MM:SS the team works in, which is also what a start copied out
 * of a sheet looks like. parseStartDateTimeInput reads this back unchanged, so
 * the box and the Disruption ID it generated can never disagree.
 *
 * The shorter YY-MM-DD is still accepted on the way in - it is just not what
 * gets written back.
 */
export function formatStartDateTimeInput(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
}
