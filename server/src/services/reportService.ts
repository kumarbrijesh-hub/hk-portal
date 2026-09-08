/**
 * Hourly "Download Active Report" generation (spec section 19).
 *
 * All three formats are built from the same filtered active dataset so the numbers
 * in the Excel file, the CSV and the printable HTML always agree.
 */
import ExcelJS from 'exceljs';
import { loadConfig } from '../config.js';
import type { Disruption } from '../types.js';
import { IST_LABEL, formatIst, formatIstFriendly, roundTo } from '../utils/time.js';

export interface BucketSplit {
  breakdown: number | null;
  nonBreakdown: number | null;
}

export interface ReportStats {
  activeNow: number;
  activeSplit: BucketSplit;
  totalDurationHrs: number;
  totalDurationSplit: BucketSplit;
  totalDurationSharePct: BucketSplit;
  avgDurationHrs: number;
  avgDurationSplit: BucketSplit;
  avgMstFrtMins: number;
  avgMstFrtSplit: BucketSplit;
  avgCcFrtMins: number;
  avgCcFrtSplit: BucketSplit;
}

export interface ReportData {
  generatedAt: string;
  appliedFilters: Record<string, string>;
  stats: ReportStats;
  primary: Disruption[];
  secondary: Disruption[];
  secondaryTitle: string;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Returns null for an empty subset so the tile can render a dash instead of 0. */
function nullableAverage(values: number[]): number | null {
  return values.length ? roundTo(average(values), 0) : null;
}

export function computeStats(records: Disruption[]): ReportStats {
  const { breakdownBucket, nonBreakdownBucket } = loadConfig().report;

  const inBucket = (bucket: string) =>
    records.filter((record) => record.bucket.toLowerCase() === bucket.toLowerCase());

  const breakdown = inBucket(breakdownBucket);
  const nonBreakdown = inBucket(nonBreakdownBucket);

  const durations = records.map((record) => record.durationHours);
  const totalDuration = sum(durations);

  const totalBreakdown = sum(breakdown.map((record) => record.durationHours));
  const totalNonBreakdown = sum(nonBreakdown.map((record) => record.durationHours));

  const share = (value: number) =>
    totalDuration > 0 ? roundTo((value / totalDuration) * 100, 1) : 0;

  const metric = (list: Disruption[], key: 'ccFrtMins' | 'mstFrtMins') =>
    list.map((record) => record[key]).filter((value): value is number => value !== null);

  return {
    activeNow: records.length,
    activeSplit: { breakdown: breakdown.length, nonBreakdown: nonBreakdown.length },
    totalDurationHrs: roundTo(totalDuration, 1),
    totalDurationSplit: {
      breakdown: roundTo(totalBreakdown, 1),
      nonBreakdown: roundTo(totalNonBreakdown, 1),
    },
    totalDurationSharePct: {
      breakdown: share(totalBreakdown),
      nonBreakdown: share(totalNonBreakdown),
    },
    avgDurationHrs: roundTo(average(durations), 1),
    avgDurationSplit: {
      breakdown: breakdown.length ? roundTo(average(breakdown.map((r) => r.durationHours)), 1) : null,
      nonBreakdown: nonBreakdown.length ? roundTo(average(nonBreakdown.map((r) => r.durationHours)), 1) : null,
    },
    avgMstFrtMins: roundTo(average(metric(records, 'mstFrtMins')), 0),
    avgMstFrtSplit: {
      breakdown: nullableAverage(metric(breakdown, 'mstFrtMins')),
      nonBreakdown: nullableAverage(metric(nonBreakdown, 'mstFrtMins')),
    },
    avgCcFrtMins: roundTo(average(metric(records, 'ccFrtMins')), 0),
    avgCcFrtSplit: {
      breakdown: nullableAverage(metric(breakdown, 'ccFrtMins')),
      nonBreakdown: nullableAverage(metric(nonBreakdown, 'ccFrtMins')),
    },
  };
}

/** Splits the active set into the main table and the auditing / non-admin table. */
export function buildReportData(
  records: Disruption[],
  appliedFilters: Record<string, string>,
  generatedAt: string,
): ReportData {
  const config = loadConfig();
  const secondaryStatuses = config.report.secondarySectionStatuses.map((s) => s.toLowerCase());

  const secondary = records.filter((r) => secondaryStatuses.includes(r.currentStatus.toLowerCase()));
  const primary = records.filter((r) => !secondaryStatuses.includes(r.currentStatus.toLowerCase()));

  const byDurationDesc = (a: Disruption, b: Disruption) => b.durationHours - a.durationHours;

  return {
    generatedAt,
    appliedFilters,
    stats: computeStats(records),
    primary: [...primary].sort(byDurationDesc),
    secondary: [...secondary].sort(byDurationDesc),
    secondaryTitle: config.report.secondarySectionTitle,
  };
}

// ---------------------------------------------------------------------------
// Tabular exports
// ---------------------------------------------------------------------------

const EXPORT_COLUMNS: { header: string; width: number; value: (r: Disruption) => string | number | null }[] = [
  { header: 'Disruption ID', width: 24, value: (r) => r.disruptionId },
  { header: 'Outlet ID', width: 14, value: (r) => r.outletId },
  { header: 'Store Name', width: 32, value: (r) => r.storeName },
  { header: 'City', width: 18, value: (r) => r.city },
  { header: 'Mode', width: 14, value: (r) => r.mode },
  { header: 'Vendor', width: 20, value: (r) => r.vendor },
  { header: 'POC Name', width: 18, value: (r) => r.pocName },
  { header: 'POC Contact', width: 16, value: (r) => r.pocContact },
  { header: 'CC POC', width: 14, value: (r) => r.ccPoc },
  { header: 'Bucket', width: 18, value: (r) => r.bucket },
  { header: 'Disruption Ticket ID', width: 20, value: (r) => r.ticketId ?? '' },
  { header: 'Disruption Start Time (IST)', width: 22, value: (r) => formatIst(r.disruptionStartAt) },
  { header: 'Duration (Hrs)', width: 14, value: (r) => r.durationHours },
  { header: 'Current Status', width: 20, value: (r) => r.currentStatus },
  { header: 'Issue', width: 24, value: (r) => r.issue ?? '' },
  { header: 'Sub Issue', width: 24, value: (r) => r.subIssue ?? '' },
  { header: 'CC FRT (Mins)', width: 14, value: (r) => r.ccFrtMins ?? '' },
  { header: 'MST FRT (Mins)', width: 14, value: (r) => r.mstFrtMins ?? '' },
  { header: 'Audit Duration (Hrs)', width: 18, value: (r) => r.auditDurationHrs ?? '' },
  { header: 'Latest Live Update', width: 70, value: (r) => r.latestLiveUpdate },
  { header: 'Last Updated By', width: 18, value: (r) => r.lastUpdatedBy ?? '' },
  { header: 'Last Updated At (IST)', width: 22, value: (r) => formatIst(r.lastUpdatedAt) },
];

function csvCell(value: string | number | null): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(data: ReportData): string {
  const lines: string[] = [];
  lines.push(csvCell(`${loadConfig().brand.appName} - Active Disruption Report`));
  lines.push(csvCell(`Report Generated: ${formatIst(data.generatedAt)} ${IST_LABEL}`));
  lines.push(csvCell(`Total Active: ${data.stats.activeNow}`));
  const filterLine = Object.entries(data.appliedFilters).map(([k, v]) => `${k}=${v}`).join('; ');
  lines.push(csvCell(`Filters: ${filterLine || 'None'}`));
  lines.push('');
  lines.push(EXPORT_COLUMNS.map((column) => csvCell(column.header)).join(','));

  for (const record of [...data.primary, ...data.secondary]) {
    lines.push(EXPORT_COLUMNS.map((column) => csvCell(column.value(record))).join(','));
  }

  // BOM so Excel opens UTF-8 correctly on Windows.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function buildExcel(data: ReportData): Promise<Buffer> {
  const config = loadConfig();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = config.brand.appName;
  workbook.created = new Date(data.generatedAt);

  const sheet = workbook.addWorksheet('Active Disruptions', {
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  sheet.mergeCells(1, 1, 1, EXPORT_COLUMNS.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${config.brand.appName} — ${config.brand.reportTitle}`;
  titleCell.font = { bold: true, size: 14 };

  sheet.getCell(2, 1).value = `Report Generated: ${formatIst(data.generatedAt)} ${IST_LABEL}`;
  sheet.getCell(3, 1).value = `Total Active: ${data.stats.activeNow}`
    + `  (Breakdown: ${data.stats.activeSplit.breakdown}, Non Breakdown: ${data.stats.activeSplit.nonBreakdown})`;
  sheet.getCell(4, 1).value = `Total Duration: ${data.stats.totalDurationHrs} Hrs`
    + `  |  Avg Duration: ${data.stats.avgDurationHrs} Hrs`
    + `  |  Avg CC FRT: ${data.stats.avgCcFrtMins} Mins`
    + `  |  Avg MST FRT: ${data.stats.avgMstFrtMins} Mins`;
  const filterLine = Object.entries(data.appliedFilters).map(([k, v]) => `${k} = ${v}`).join('  |  ');
  sheet.getCell(5, 1).value = `Filters: ${filterLine || 'None'}`;

  const headerRowIndex = 6;
  const headerRow = sheet.getRow(headerRowIndex);
  EXPORT_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getColumn(index + 1).width = column.width;
  });
  headerRow.commit();

  const addRows = (records: Disruption[]) => {
    for (const record of records) {
      const row = sheet.addRow(EXPORT_COLUMNS.map((column) => column.value(record)));
      row.alignment = { vertical: 'top', wrapText: true };
    }
  };

  addRows(data.primary);

  if (data.secondary.length) {
    const spacer = sheet.addRow([]);
    spacer.commit();
    const sectionRow = sheet.addRow([data.secondaryTitle]);
    sheet.mergeCells(sectionRow.number, 1, sectionRow.number, EXPORT_COLUMNS.length);
    sectionRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
    addRows(data.secondary);
  }

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: EXPORT_COLUMNS.length },
  };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Printable HTML report (mirrors the shared report layout)
// ---------------------------------------------------------------------------

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Status badge tone. Each badge always carries its status text, never colour alone. */
function statusTone(status: string): 'resolved' | 'audit' | 'admin' | 'aligned' | 'visited' {
  const value = status.toLowerCase();
  if (value.startsWith('resolved')) return 'resolved';
  if (value.includes('audit')) return 'audit';
  if (value.includes('admin') || value.includes('disable')) return 'admin';
  if (value.includes('visited')) return 'visited';
  return 'aligned';
}

function num(value: number | null, dash = '-'): string {
  return value === null || value === undefined ? dash : String(value);
}

/** Value with its unit, or a bare dash when the subset had no data. */
function metric(value: number | null, unit: string): string {
  return value === null || value === undefined ? '-' : `${value}${unit}`;
}

function tile(options: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
  valueClass: string;
  rows: { label: string; value: string; dotClass: string }[];
}): string {
  return `
    <section class="tile" style="--accent:${options.accent}">
      <h2 class="tile-label">${escapeHtml(options.label)}</h2>
      <p class="tile-value ${options.valueClass}">${escapeHtml(options.value)}${
        options.unit ? `<span class="tile-unit">${escapeHtml(options.unit)}</span>` : ''
      }</p>
      <dl class="tile-rows">
        ${options.rows
          .map(
            (row) => `<div class="tile-row">
              <dt><span class="dot ${row.dotClass}" aria-hidden="true"></span>${escapeHtml(row.label)}</dt>
              <dd>${escapeHtml(row.value)}</dd>
            </div>`,
          )
          .join('')}
      </dl>
    </section>`;
}

export function buildHtml(data: ReportData): string {
  const config = loadConfig();
  const stats = data.stats;
  const bd = 'Breakdown';
  const nbd = 'Non Breakdown';

  const filterSummary = Object.entries(data.appliedFilters)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');

  const primaryRows = data.primary
    .map(
      (record, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(record.city)}</td>
        <td class="store">${escapeHtml(record.storeName)}</td>
        <td>${escapeHtml(record.pocName)}</td>
        <td><span class="badge bucket-${record.bucket.toLowerCase() === bd.toLowerCase() ? 'breakdown' : 'other'}">${escapeHtml(record.bucket)}</span></td>
        <td class="num dur">${record.durationHours.toFixed(1)}</td>
        <td><span class="badge status-${statusTone(record.currentStatus)}">${escapeHtml(record.currentStatus)}</span></td>
        <td class="updates">${escapeHtml(record.latestLiveUpdate)}</td>
        <td class="num">${num(record.ccFrtMins)}</td>
        <td class="num">${num(record.mstFrtMins)}</td>
        <td class="ticket">${escapeHtml(record.ticketId ?? '-')}</td>
      </tr>`,
    )
    .join('');

  const secondaryRows = data.secondary
    .map(
      (record, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(record.city)}</td>
        <td class="store">${escapeHtml(record.storeName)}</td>
        <td>${escapeHtml(record.pocName)}</td>
        <td class="num dur">${record.durationHours.toFixed(1)} Hrs</td>
        <td class="num">${record.auditDurationHrs === null ? '-' : `${record.auditDurationHrs.toFixed(1)} Hrs`}</td>
        <td><span class="badge status-${statusTone(record.currentStatus)}">${escapeHtml(record.currentStatus)}</span></td>
        <td class="updates">${escapeHtml(record.latestLiveUpdate)}</td>
        <td class="num">${num(record.ccFrtMins)}</td>
        <td class="num">${num(record.mstFrtMins)}</td>
        <td class="ticket">${escapeHtml(record.ticketId ?? '-')}</td>
      </tr>`,
    )
    .join('');

  const tiles = [
    tile({
      label: 'Active Now',
      value: String(stats.activeNow),
      accent: '#dc2626',
      valueClass: 'v-critical',
      rows: [
        { label: bd, value: String(stats.activeSplit.breakdown ?? 0), dotClass: 'dot-critical' },
        { label: nbd, value: String(stats.activeSplit.nonBreakdown ?? 0), dotClass: 'dot-warning' },
      ],
    }),
    tile({
      label: 'Total Duration',
      value: stats.totalDurationHrs.toFixed(1),
      unit: 'Hrs',
      accent: '#d97706',
      valueClass: 'v-warning',
      rows: [
        {
          label: bd,
          value: `${num(stats.totalDurationSplit.breakdown)} h (${num(stats.totalDurationSharePct.breakdown)}%)`,
          dotClass: 'dot-critical',
        },
        {
          label: nbd,
          value: `${num(stats.totalDurationSplit.nonBreakdown)} h (${num(stats.totalDurationSharePct.nonBreakdown)}%)`,
          dotClass: 'dot-warning',
        },
      ],
    }),
    tile({
      label: 'Avg Duration',
      value: stats.avgDurationHrs.toFixed(1),
      unit: 'Hrs',
      accent: '#d97706',
      valueClass: 'v-warning',
      rows: [
        { label: bd, value: metric(stats.avgDurationSplit.breakdown, ' h'), dotClass: 'dot-critical' },
        { label: nbd, value: metric(stats.avgDurationSplit.nonBreakdown, ' h'), dotClass: 'dot-warning' },
      ],
    }),
    tile({
      label: 'Avg MST FRT',
      value: String(stats.avgMstFrtMins),
      unit: 'Mins',
      accent: '#1d4ed8',
      valueClass: 'v-info',
      rows: [
        { label: bd, value: metric(stats.avgMstFrtSplit.breakdown, ' m'), dotClass: 'dot-critical' },
        { label: nbd, value: metric(stats.avgMstFrtSplit.nonBreakdown, ' m'), dotClass: 'dot-warning' },
      ],
    }),
    tile({
      label: 'Avg CC FRT',
      value: String(stats.avgCcFrtMins),
      unit: 'Mins',
      accent: '#1d4ed8',
      valueClass: 'v-info',
      rows: [
        { label: bd, value: metric(stats.avgCcFrtSplit.breakdown, ' m'), dotClass: 'dot-critical' },
        { label: nbd, value: metric(stats.avgCcFrtSplit.nonBreakdown, ' m'), dotClass: 'dot-warning' },
      ],
    }),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(config.brand.appName)} — ${escapeHtml(config.brand.reportTitle)}</title>
<style>
  :root {
    --surface: #eef2f7;
    --card: #ffffff;
    --ink: #0f172a;
    --ink-2: #475569;
    --ink-3: #64748b;
    --line: #e2e8f0;
    --critical: #dc2626;
    --warning: #d97706;
    --info: #1d4ed8;
    --accent-purple: #6d28d9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px;
    background: var(--surface);
    color: var(--ink);
    font: 400 13px/1.5 "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1900px; margin: 0 auto; }
  .tiles {
    display: grid; gap: 14px; margin-bottom: 18px;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .brand-tile, .tile {
    background: var(--card); border-radius: 14px; padding: 16px 18px;
    box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 1px 10px rgba(15,23,42,.04);
  }
  .tile { border-top: 4px solid var(--accent); }
  .brand-name { font-size: 26px; font-weight: 800; letter-spacing: -.5px; margin: 0; }
  .brand-name span { color: #16a34a; }
  .brand-sub { margin: 2px 0 10px; font-size: 11px; font-weight: 700; letter-spacing: .09em; color: var(--ink-3); text-transform: uppercase; }
  .generated { display: inline-block; padding: 6px 11px; border-radius: 8px; background: #eff6ff; color: #1e40af; font-size: 11.5px; font-weight: 600; }
  .tile-label { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-2); text-align: center; }
  .tile-value { margin: 6px 0 10px; text-align: center; font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -1px; }
  .tile-unit { font-size: 14px; font-weight: 700; color: var(--ink-3); margin-left: 5px; }
  .v-critical { color: var(--critical); }
  .v-warning { color: var(--warning); }
  .v-info { color: var(--info); }
  .tile-rows { margin: 0; border-top: 1px solid var(--line); padding-top: 8px; }
  .tile-row { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; padding: 2px 0; }
  .tile-row dt { display: flex; align-items: center; gap: 6px; color: var(--ink-2); margin: 0; }
  .tile-row dd { margin: 0; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .dot-critical { background: var(--critical); }
  .dot-warning { background: var(--warning); }
  .panel { background: var(--card); border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 1px 10px rgba(15,23,42,.04); margin-bottom: 18px; }
  .panel.secondary { border: 2px solid var(--accent-purple); }
  .panel-head { background: linear-gradient(90deg, #7c3aed, #a855f7); color: #fff; padding: 12px 18px; }
  .panel-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
  .panel-head p { margin: 2px 0 0; font-size: 11.5px; opacity: .9; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #f5f7fa; color: var(--ink-2); text-align: left;
    font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    padding: 11px 12px; border-bottom: 1px solid var(--line); white-space: nowrap;
  }
  .panel.secondary thead th { background: #faf5ff; color: #6b21a8; }
  tbody td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; font-size: 12.5px; }
  tbody tr:nth-child(even) { background: #fbfcfe; }
  tbody tr:last-child td { border-bottom: 0; }
  .num { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dur { font-weight: 700; color: var(--critical); }
  .store { color: #1d4ed8; font-weight: 600; }
  .ticket { color: #1d4ed8; font-weight: 600; text-align: center; white-space: nowrap; }
  .updates { color: var(--ink-2); min-width: 320px; max-width: 560px; }
  .badge {
    display: inline-block; padding: 4px 9px; border-radius: 6px;
    font-size: 11px; font-weight: 700; white-space: nowrap; border: 1px solid transparent;
  }
  .bucket-breakdown { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .bucket-other { background: #fef3c7; color: #854d0e; border-color: #fcd34d; }
  .status-aligned { background: #fef3c7; color: #854d0e; border-color: #fcd34d; }
  .status-visited { background: #fef3c7; color: #854d0e; border-color: #fcd34d; }
  .status-resolved { background: #dcfce7; color: #15803d; border-color: #86efac; }
  .status-audit { background: #f3e8ff; color: #6b21a8; border-color: #d8b4fe; }
  .status-admin { background: #e0e7ff; color: #3730a3; border-color: #a5b4fc; }
  .empty { padding: 34px; text-align: center; color: var(--ink-3); }
  .foot { color: var(--ink-3); font-size: 11.5px; padding: 4px 2px 10px; }
  @media print {
    body { background: #fff; padding: 0; }
    .panel, .tile, .brand-tile { box-shadow: none; border: 1px solid var(--line); }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="tiles">
    <section class="brand-tile">
      <p class="brand-name">${escapeHtml(config.brand.appName)}</p>
      <p class="brand-sub">${escapeHtml(config.brand.reportTitle)}</p>
      <span class="generated">Generated: ${escapeHtml(formatIstFriendly(data.generatedAt))} ${IST_LABEL}</span>
    </section>
    ${tiles}
  </div>

  <div class="panel">
    ${
      data.primary.length
        ? `<table>
      <thead><tr>
        <th>#</th><th>City</th><th>Store Name</th><th>POC</th><th>Bucket</th>
        <th>Dur (Hrs)</th><th>Status</th><th>Live Updates</th>
        <th>CC FRT (M)</th><th>MST FRT (M)</th><th>Ticket ID</th>
      </tr></thead>
      <tbody>${primaryRows}</tbody>
    </table>`
        : '<p class="empty">No active disruptions for the selected filters.</p>'
    }
  </div>

  ${
    data.secondary.length
      ? `<div class="panel secondary">
    <div class="panel-head">
      <h2>${escapeHtml(data.secondaryTitle)}</h2>
      <p>${escapeHtml(config.report.secondarySectionStatuses.join(' · '))} — ${data.secondary.length} active</p>
    </div>
    <table>
      <thead><tr>
        <th>#</th><th>City</th><th>Store Name</th><th>POC</th>
        <th>Dur (Hrs)</th><th>Audit Dur (Hrs)</th><th>Status</th><th>Live Updates</th>
        <th>CC FRT (M)</th><th>MST FRT (M)</th><th>Ticket ID</th>
      </tr></thead>
      <tbody>${secondaryRows}</tbody>
    </table>
  </div>`
      : ''
  }

  <p class="foot">
    Report Generated: ${escapeHtml(formatIst(data.generatedAt))} ${IST_LABEL}
    &nbsp;·&nbsp; Total Active: ${stats.activeNow}
    ${filterSummary ? `&nbsp;·&nbsp; Filters — ${escapeHtml(filterSummary)}` : '&nbsp;·&nbsp; Filters — None'}
  </p>
</div>
</body>
</html>`;
}

/** e.g. active-disruptions_08-09-2026_2259.xlsx */
export function reportFileName(generatedAt: string, extension: string): string {
  const [date, time] = formatIst(generatedAt, false).split(' ');
  return `active-disruptions_${date}_${time.replace(':', '')}.${extension}`;
}
