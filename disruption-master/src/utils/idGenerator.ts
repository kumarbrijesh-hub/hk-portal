/**
 * Generates Disruption ID with format: OutletID-YYMMDDHHMM
 * Example: OUT12345-2609091435
 */

export function generateDisruptionId(
  outletId: string,
  dateStr: string, // YYYY-MM-DD
  timeStr: string  // HH:MM or HH:MM:SS
): string {
  if (!outletId || !dateStr) {
    return '';
  }

  const cleanOutlet = outletId.trim().toUpperCase();
  const dateParts = dateStr.split('-');
  if (dateParts.length < 3) return '';

  const fullYear = dateParts[0]; // e.g. 2026
  const yy = fullYear.slice(-2); // 26
  const mm = dateParts[1].padStart(2, '0'); // 09
  const dd = dateParts[2].padStart(2, '0'); // 09

  let hh = '00';
  let min = '00';
  if (timeStr) {
    const timeParts = timeStr.split(':');
    hh = (timeParts[0] || '00').padStart(2, '0');
    min = (timeParts[1] || '00').padStart(2, '0');
  }

  return `${cleanOutlet}-${yy}${mm}${dd}${hh}${min}`;
}
