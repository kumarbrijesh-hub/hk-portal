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
 * Duration in hours from the disruption start time to now, or null when the
 * start time is missing or unparseable — the caller renders a dash rather than
 * a made-up number.
 */
export function calculateDurationHours(disruptionStartDateTime?: string, fallbackDuration?: string): number | null {
  if (fallbackDuration) {
    const num = parseFloat(fallbackDuration.replace(/[^0-9.]/g, ''));
    if (!isNaN(num) && num > 0) return num;
  }
  if (!disruptionStartDateTime) return null;

  try {
    const parts = disruptionStartDateTime.trim().split(/[\sT]+/);
    let startTimestamp = 0;
    if (parts.length >= 2) {
      const datePart = parts[0];
      const timePart = parts[1];
      const dmy = datePart.split(/[/.-]/).map(Number);
      const hms = timePart.split(':').map((v) => Number(v) || 0);
      if (dmy.length === 3) {
        let day = dmy[0];
        let month = dmy[1];
        let year = dmy[2];
        if (dmy[0] > 1000) {
          // YYYY-MM-DD
          year = dmy[0];
          month = dmy[1];
          day = dmy[2];
        }
        const fullYear = year < 100 ? 2000 + year : year;
        // Asia/Kolkata UTC+5:30
        const dateObj = new Date(Date.UTC(fullYear, month - 1, day, hms[0] - 5, hms[1] - 30, hms[2] || 0));
        startTimestamp = dateObj.getTime();
      }
    }

    if (!startTimestamp || isNaN(startTimestamp)) {
      const parsed = new Date(disruptionStartDateTime).getTime();
      if (!isNaN(parsed)) startTimestamp = parsed;
    }

    if (startTimestamp > 0) {
      const diffMs = Date.now() - startTimestamp;
      if (diffMs > 0) {
        return Math.max(0.1, Number((diffMs / (1000 * 60 * 60)).toFixed(1)));
      }
    }
  } catch {
    // fall through to null
  }

  return null;
}
