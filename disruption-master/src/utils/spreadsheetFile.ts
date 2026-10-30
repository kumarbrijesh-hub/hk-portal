/**
 * Turns a picked file into the CSV text the server's parser expects.
 *
 * Everything is converted in the browser, so an .xlsx straight out of Sheets or
 * Excel can be uploaded without anyone having to "Save as CSV" first - which is
 * the step people forget, and the one that silently drops the tab they meant.
 */

import * as XLSX from 'xlsx';

/** Extensions read as plain delimited text rather than through the workbook reader. */
const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt'];

export function isTextSpreadsheet(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Reads the file and returns CSV text.
 *
 * For a workbook, `tabName` picks the sheet; when it is missing or does not
 * match, the first sheet is used, because a workbook saved from a single tab
 * often has a name nobody remembers setting.
 */
export async function readSpreadsheetAsCsv(file: File, tabName?: string): Promise<string> {
  if (isTextSpreadsheet(file.name)) {
    return file.text();
  }

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  if (workbook.SheetNames.length === 0) {
    throw new Error('That workbook has no sheets in it.');
  }

  const wanted = (tabName || '').trim().toLowerCase();
  const matched = wanted
    ? workbook.SheetNames.find((n) => n.trim().toLowerCase() === wanted)
    : undefined;
  const sheetName = matched ?? workbook.SheetNames[0];

  return XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
}

/** Row count in CSV text, not counting the header or blank lines. */
export function countDataRows(csvText: string): number {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}
