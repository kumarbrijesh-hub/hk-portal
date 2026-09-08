/**
 * Google Sheet reader. Two auth paths, picked automatically:
 *   1. Service account (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS)
 *      -> Sheets API v4, works with a privately shared sheet.
 *   2. No credentials -> public CSV export endpoint, which requires the sheet to be
 *      link-viewable.
 * Credentials are read from the environment only and never leave the server.
 */
import fs from 'node:fs';
import { google } from 'googleapis';
import { parse as parseCsv } from 'csv-parse/sync';
import { env } from '../env.js';

export type SheetGrid = string[][];

export interface SheetReadResult {
  grid: SheetGrid;
  source: 'sheets-api' | 'public-csv';
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function serviceAccountCredentials(): { client_email: string; private_key: string } | null {
  if (env.googleServiceAccountJson) {
    const parsed = JSON.parse(env.googleServiceAccountJson);
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  if (env.googleApplicationCredentials && fs.existsSync(env.googleApplicationCredentials)) {
    const parsed = JSON.parse(fs.readFileSync(env.googleApplicationCredentials, 'utf8'));
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  return null;
}

export function hasServiceAccount(): boolean {
  try {
    return serviceAccountCredentials() !== null;
  } catch {
    return false;
  }
}

async function readViaSheetsApi(spreadsheetId: string, tab: string): Promise<SheetGrid> {
  const credentials = serviceAccountCredentials();
  if (!credentials) throw new Error('No service account credentials configured');

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return (response.data.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
}

async function readViaPublicCsv(spreadsheetId: string, tab: string): Promise<SheetGrid> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`
    + `?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `Public CSV export failed (HTTP ${response.status}). `
      + 'Either share the sheet as "anyone with the link can view", or configure a service account.',
    );
  }
  const body = await response.text();
  if (body.trimStart().startsWith('<')) {
    throw new Error(
      'Google returned an HTML page instead of CSV - the sheet is not publicly viewable. '
      + 'Configure a service account (GOOGLE_SERVICE_ACCOUNT_JSON) for private sheets.',
    );
  }
  return parseCsv(body, { relaxColumnCount: true, skipEmptyLines: false }) as SheetGrid;
}

export async function readSheet(spreadsheetId: string, tab: string): Promise<SheetReadResult> {
  if (!spreadsheetId) throw new Error('Google Sheet id is not configured');
  if (!tab) throw new Error('Google Sheet tab name is not configured');

  if (hasServiceAccount()) {
    return { grid: await readViaSheetsApi(spreadsheetId, tab), source: 'sheets-api' };
  }
  return { grid: await readViaPublicCsv(spreadsheetId, tab), source: 'public-csv' };
}

/** Column letter (A, B, ..., AA) to a zero-based index. */
export function columnLetterToIndex(letter: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letter)) return null;
  let index = 0;
  for (const char of letter.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Resolves a configured column spec against the header row. A spec is either a
 * header label (matched case-insensitively, whitespace collapsed) or a column letter.
 */
export function resolveColumnIndex(header: string[], spec: string): number | null {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = normalise(spec);

  const byHeader = header.findIndex((cell) => normalise(cell ?? '') === target);
  if (byHeader >= 0) return byHeader;

  const byLetter = columnLetterToIndex(spec.trim());
  if (byLetter !== null && byLetter < Math.max(header.length, 1000)) return byLetter;

  return null;
}
