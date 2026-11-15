import * as XLSX from 'xlsx';
import { toPng } from 'html-to-image';
import { Disruption } from '../types';
import { getCurrentISTDate, getReportFileTimestamp } from './dateUtils';
import { readIssues, readSubIssues } from './issueTaxonomy';
import { disruptionDurationHours, liveUpdateReportBlock } from './liveUpdateLog';
import { StoreInstanceReport, ticketRollupIndex } from './ticketInstances';
import { withLightTheme } from './theme';

/**
 * The line that identifies the system on every file that leaves it. A report
 * gets forwarded, pasted into a deck and printed, and the person three hops
 * down the chain has no way to know where the numbers came from unless the file
 * says so itself.
 */
const REPORT_BRAND = 'Blinkit DMS - Disruption Management System';

/**
 * Worst store first.
 *
 * A report is read from the top, so the outlet breaking most often has to be
 * the first thing on it. Rows are grouped by outlet and the groups ordered by
 * how many disruptions that outlet has in this report, heaviest first; within
 * an outlet the newest disruption leads. Ties fall back to the outlet ID so
 * two runs over the same data always produce the same file.
 */
export function orderByDisruptionVolume(disruptions: Disruption[]): Disruption[] {
  const countByOutlet = new Map<string, number>();
  for (const d of disruptions) {
    const outlet = (d.outletId || '').trim().toUpperCase();
    countByOutlet.set(outlet, (countByOutlet.get(outlet) || 0) + 1);
  }

  return [...disruptions].sort((a, b) => {
    const outletA = (a.outletId || '').trim().toUpperCase();
    const outletB = (b.outletId || '').trim().toUpperCase();
    const volume = (countByOutlet.get(outletB) || 0) - (countByOutlet.get(outletA) || 0);
    if (volume !== 0) return volume;
    if (outletA !== outletB) return outletA.localeCompare(outletB);
    return (b.disruptionStartDateTime || '').localeCompare(a.disruptionStartDateTime || '');
  });
}

/**
 * Chrome refuses canvases beyond roughly 16384px on a side. Staying under that
 * keeps a tall report from silently producing a blank image.
 */
const MAX_CANVAS_EDGE = 15000;

/** Rendered at 3x so the image holds up when someone zooms into a cell. */
const TARGET_PIXEL_RATIO = 3;

/**
 * Captures the report element as a PNG.
 *
 * The report nests its tables inside horizontal scroll containers, so a naive
 * capture cuts the right-hand columns off at the viewport edge. Those
 * containers are opened up for the duration of the capture and restored
 * afterwards, and the image is measured off the resulting full content width.
 */
export async function exportActiveReportToPNG(elementId: string, customFilename?: string): Promise<void> {
  // A downloaded report is a document, not a screenshot of somebody's console,
  // so it is always the light version whichever theme the exporter is using.
  return withLightTheme(() => captureReportToPNG(elementId, customFilename));
}

async function captureReportToPNG(elementId: string, customFilename?: string): Promise<void> {
  const node = document.getElementById(elementId);
  if (!node) {
    throw new Error(`Report element with ID "${elementId}" not found for PNG generation.`);
  }

  const filename = customFilename || `Active_Disruptions_${getReportFileTimestamp()}.png`;

  // Let every clipped region lay itself out at full width before measuring.
  const scrollers = Array.from(node.querySelectorAll<HTMLElement>('.overflow-x-auto, .overflow-y-auto'));
  const saved = scrollers.map((el) => ({
    el,
    overflow: el.style.overflow,
    overflowX: el.style.overflowX,
    overflowY: el.style.overflowY,
    maxHeight: el.style.maxHeight,
  }));
  for (const el of scrollers) {
    el.style.overflow = 'visible';
    el.style.overflowX = 'visible';
    el.style.overflowY = 'visible';
    el.style.maxHeight = 'none';
  }

  const savedNodeWidth = node.style.width;

  try {
    // Reading a layout property forces the reflow we just asked for.
    void node.offsetHeight;

    const fullWidth = Math.max(node.scrollWidth, Math.ceil(node.getBoundingClientRect().width), 1280);

    // Widen the container itself so banners and footers stretch to match the
    // widest table instead of stopping at the old viewport width.
    node.style.width = `${fullWidth}px`;
    void node.offsetHeight;

    const fullHeight = Math.max(node.scrollHeight, Math.ceil(node.getBoundingClientRect().height));

    // Scale back from 3x only as far as the canvas ceiling demands.
    const pixelRatio = Math.max(
      1,
      Math.min(TARGET_PIXEL_RATIO, MAX_CANVAS_EDGE / fullWidth, MAX_CANVAS_EDGE / fullHeight)
    );

    // skipFonts avoids reading cssRules on the cross-origin Google Fonts sheet,
    // which throws a SecurityError and aborts the whole capture.
    const dataUrl = await toPng(node, {
      pixelRatio,
      width: fullWidth,
      height: fullHeight,
      backgroundColor: '#ffffff',
      cacheBust: true,
      skipFonts: true,
      fontEmbedCSS: '',
      // Drop stylesheet links, and anything marked as a screen-only control:
      // the export toolbar belongs on the page, not inside the report image.
      filter: (domNode) =>
        domNode.nodeName !== 'LINK' &&
        !(domNode instanceof HTMLElement && domNode.dataset.exportExclude === 'true'),
      style: {
        width: `${fullWidth}px`,
        height: `${fullHeight}px`,
        overflow: 'visible',
        transform: 'none',
        boxShadow: 'none',
      },
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Always hand the layout back, even if the capture threw.
    node.style.width = savedNodeWidth;
    for (const s of saved) {
      s.el.style.overflow = s.overflow;
      s.el.style.overflowX = s.overflowX;
      s.el.style.overflowY = s.overflowY;
      s.el.style.maxHeight = s.maxHeight;
    }
  }
}

/** Duration as a bare number for a spreadsheet cell, blank while it is unknown. */
function durationCell(d: Disruption): string {
  const hours = disruptionDurationHours(d);
  return hours === null ? '' : hours.toFixed(2);
}

type RollupIndex = ReturnType<typeof ticketRollupIndex>;

/**
 * Which run of its ticket this row is: 1 for the original, 2 for the first
 * auto-disable repeat, and so on. Reading "run 3 of 3" next to a two-hour
 * duration is what tells somebody the store has really been down six.
 */
function ticketRunNo(d: Disruption, rollups: RollupIndex): number {
  const rollup = rollups.get(d.disruptionId);
  if (!rollup) return 1;
  const position = rollup.records.findIndex((r) => r.disruptionId === d.disruptionId);
  return position < 0 ? 1 : position + 1;
}

/** Every run on this ticket added together, as a bare spreadsheet number. */
function ticketTotalCell(d: Disruption, rollups: RollupIndex): string {
  const total = rollups.get(d.disruptionId)?.totalHours ?? null;
  return total === null ? '' : total.toFixed(2);
}

export function exportActiveReportToCSV(
  unorderedDisruptions: Disruption[],
  activeFiltersDescription?: string,
  /**
   * Every record, so the per-ticket totals can see the earlier runs. Those are
   * usually resolved or parked and therefore absent from the filtered list;
   * leaving them out would under-report how long the store has been down.
   */
  allDisruptions: Disruption[] = unorderedDisruptions
) {
  const disruptions = orderByDisruptionVolume(unorderedDisruptions);
  const rollups = ticketRollupIndex(allDisruptions);
  const { formattedIST } = getCurrentISTDate();
  const timestampHeader = `Report Generated: ${formattedIST} IST`;
  const filterHeader = activeFiltersDescription ? `Filters Applied: ${activeFiltersDescription}` : 'All Active Records';

  const headers = [
    'Disruption ID',
    'Outlet ID',
    'Store Name',
    'City',
    'Mode',
    'Vendor',
    'POC Name',
    'POC Contact',
    'CC POC',
    'Bucket',
    'Ticket ID',
    'Disruption Start Time (IST)',
    'Disruption End Time (IST)',
    'Disruption Duration (Hrs)',
    'Ticket Run No',
    'Ticket Runs',
    'Ticket Total Duration (Hrs)',
    'Current Status',
    'Issue',
    'Sub Issues',
    'Sub Issue Count',
    'Live Updates',
    'Last Updated By',
    'Last Updated At',
  ];

  const rows = disruptions.map((d) => [
    d.disruptionId,
    d.outletId,
    `"${(d.storeName || '').replace(/"/g, '""')}"`,
    `"${(d.city || '').replace(/"/g, '""')}"`,
    `"${(d.mode || '').replace(/"/g, '""')}"`,
    `"${(d.vendor || '').replace(/"/g, '""')}"`,
    `"${(d.pocName || '').replace(/"/g, '""')}"`,
    `"${(d.pocContact || '').replace(/"/g, '""')}"`,
    d.ccPoc,
    d.bucket,
    d.ticketId || 'N/A',
    d.disruptionStartDateTime,
    d.endTime || '',
    durationCell(d),
    String(ticketRunNo(d, rollups)),
    String(rollups.get(d.disruptionId)?.occurrences ?? 1),
    ticketTotalCell(d, rollups),
    d.currentStatus,
    `"${readIssues(d).join(' | ').replace(/"/g, '""')}"`,
    `"${readSubIssues(d).join(' | ').replace(/"/g, '""')}"`,
    String(readSubIssues(d).length),
    `"${liveUpdateReportBlock(d).replace(/"/g, '""')}"`,
    d.lastUpdatedBy,
    d.lastUpdatedAt,
  ]);

  const csvContent = [
    `"${REPORT_BRAND}"`,
    '"Active Disruption Report"',
    `"${timestampHeader}"`,
    `"${filterHeader}"`,
    `"Total Active Disruptions: ${disruptions.length}"`,
    '',
    headers.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Active_Disruptions_Report_${formattedIST.replace(/[\/\s:]/g, '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportActiveReportToExcel(
  unorderedDisruptions: Disruption[],
  activeFiltersDescription?: string,
  allDisruptions: Disruption[] = unorderedDisruptions
) {
  const disruptions = orderByDisruptionVolume(unorderedDisruptions);
  const rollups = ticketRollupIndex(allDisruptions);
  const { formattedIST } = getCurrentISTDate();

  const metadataRows = [
    { 'Disruption ID': REPORT_BRAND },
    { 'Disruption ID': 'Active Disruption Report' },
    { 'Disruption ID': `Report Generated: ${formattedIST} IST` },
    { 'Disruption ID': activeFiltersDescription ? `Filters Applied: ${activeFiltersDescription}` : 'All Active Records' },
    { 'Disruption ID': `Total Active Disruptions: ${disruptions.length}` },
    {}, // empty row
  ];

  const dataRows = disruptions.map((d) => ({
    'Disruption ID': d.disruptionId,
    'Outlet ID': d.outletId,
    'Store Name': d.storeName,
    'City': d.city,
    'Mode': d.mode,
    'Vendor': d.vendor,
    'POC Name': d.pocName,
    'POC Contact': d.pocContact,
    'CC POC': d.ccPoc,
    'Bucket': d.bucket,
    'Ticket ID': d.ticketId || 'N/A',
    'Disruption Start Time (IST)': d.disruptionStartDateTime,
    'Disruption End Time (IST)': d.endTime || '',
    'Disruption Duration (Hrs)': disruptionDurationHours(d) ?? '',
    'Ticket Run No': ticketRunNo(d, rollups),
    'Ticket Runs': rollups.get(d.disruptionId)?.occurrences ?? 1,
    'Ticket Total Duration (Hrs)': rollups.get(d.disruptionId)?.totalHours ?? '',
    'Current Status': d.currentStatus,
    'Issue': readIssues(d).join(' | ') || 'N/A',
    'Sub Issues': readSubIssues(d).join(' | ') || 'N/A',
    'Sub Issue Count': readSubIssues(d).length,
    'Live Updates': liveUpdateReportBlock(d),
    'Last Updated By': d.lastUpdatedBy,
    'Last Updated At': d.lastUpdatedAt,
  }));

  const worksheet = XLSX.utils.json_to_sheet([...metadataRows, ...dataRows]);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 24 }, // Disruption ID
    { wch: 14 }, // Outlet ID
    { wch: 28 }, // Store Name
    { wch: 16 }, // City
    { wch: 14 }, // Mode
    { wch: 14 }, // Vendor
    { wch: 18 }, // POC Name
    { wch: 18 }, // POC Contact
    { wch: 14 }, // CC POC
    { wch: 18 }, // Bucket
    { wch: 16 }, // Ticket ID
    { wch: 22 }, // Start Time
    { wch: 22 }, // End Time
    { wch: 20 }, // Duration (Hrs)
    { wch: 13 }, // Ticket Run No
    { wch: 12 }, // Ticket Runs
    { wch: 24 }, // Ticket Total Duration (Hrs)
    { wch: 18 }, // Current Status
    { wch: 24 }, // Issue
    { wch: 26 }, // Sub Issues
    { wch: 16 }, // Sub Issue Count
    { wch: 60 }, // Live Updates - holds the detail block plus the running log
    { wch: 16 }, // Last Updated By
    { wch: 22 }, // Last Updated At
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Active Disruptions');
  XLSX.writeFile(workbook, `Active_Disruptions_Report_${formattedIST.replace(/[\/\s:]/g, '_')}.xlsx`);
}


// ---------------------------------------------------------------------------
// Store instances
// ---------------------------------------------------------------------------

const INSTANCE_HEADERS = [
  'Rank',
  'Outlet ID',
  'Store Name',
  'City',
  'Vendor',
  'Instances (Unique Tickets + Untagged)',
  'Disruption Rows',
  'Unique Ticket IDs',
  'Repeat Rows On A Ticket',
  'Rows With No Ticket ID',
  'Total Duration (Hrs)',
  'Last Disruption Start (IST)',
  'Ticket IDs',
];

/** The note that explains the one number on this report people misread. */
function instanceMethodNote(report: StoreInstanceReport): string {
  return (
    `Instance = one Ticket ID. Repeats on the same ticket (auto-disable re-runs) count once. ` +
    `A row with no Ticket ID cannot be grouped, so it counts on its own. ` +
    `Window: last ${report.months} month${report.months === 1 ? '' : 's'}, from ${report.fromLabel}.`
  );
}

export function exportStoreInstancesToCSV(report: StoreInstanceReport, filterNote?: string) {
  const { formattedIST } = getCurrentISTDate();

  const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const rows = report.rows.map((r, i) =>
    [
      String(i + 1),
      r.outletId,
      quoted(r.storeName),
      quoted(r.city),
      quoted(r.vendor),
      String(r.instances),
      String(r.records),
      String(r.uniqueTickets),
      String(r.repeatRecords),
      String(r.untaggedRecords),
      r.totalHours === null ? '' : r.totalHours.toFixed(2),
      r.lastDisruptionAt,
      quoted(r.tickets.join(' | ')),
    ].join(',')
  );

  const csvContent = [
    quoted(REPORT_BRAND),
    '"Store Instance Report"',
    quoted(`Report Generated: ${formattedIST} IST`),
    quoted(instanceMethodNote(report)),
    quoted(filterNote || 'All stores in the window'),
    quoted(`Total Instances: ${report.totalInstances}`),
    quoted(`Total Disruption Rows: ${report.totalRecords}`),
    quoted(`Stores Affected: ${report.rows.length}`),
    ...(report.undatedRecords > 0
      ? [quoted(`Excluded (no readable start time): ${report.undatedRecords}`)]
      : []),
    '',
    INSTANCE_HEADERS.join(','),
    ...rows,
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute(
    'download',
    `Store_Instances_${report.months}M_${formattedIST.replace(/[\/\s:]/g, '_')}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportStoreInstancesToExcel(report: StoreInstanceReport, filterNote?: string) {
  const { formattedIST } = getCurrentISTDate();

  const metadataRows = [
    { Rank: REPORT_BRAND },
    { Rank: 'Store Instance Report' },
    { Rank: `Report Generated: ${formattedIST} IST` },
    { Rank: instanceMethodNote(report) },
    { Rank: filterNote || 'All stores in the window' },
    { Rank: `Total Instances: ${report.totalInstances}` },
    { Rank: `Total Disruption Rows: ${report.totalRecords}` },
    { Rank: `Stores Affected: ${report.rows.length}` },
    ...(report.undatedRecords > 0
      ? [{ Rank: `Excluded (no readable start time): ${report.undatedRecords}` }]
      : []),
    {},
  ];

  const dataRows = report.rows.map((r, i) => ({
    Rank: i + 1,
    'Outlet ID': r.outletId,
    'Store Name': r.storeName,
    City: r.city,
    Vendor: r.vendor,
    'Instances (Unique Tickets + Untagged)': r.instances,
    'Disruption Rows': r.records,
    'Unique Ticket IDs': r.uniqueTickets,
    'Repeat Rows On A Ticket': r.repeatRecords,
    'Rows With No Ticket ID': r.untaggedRecords,
    'Total Duration (Hrs)': r.totalHours ?? '',
    'Last Disruption Start (IST)': r.lastDisruptionAt,
    'Ticket IDs': r.tickets.join(' | '),
  }));

  const worksheet = XLSX.utils.json_to_sheet([...metadataRows, ...dataRows], {
    header: INSTANCE_HEADERS,
  });

  worksheet['!cols'] = [
    { wch: 6 }, // Rank
    { wch: 14 }, // Outlet ID
    { wch: 30 }, // Store Name
    { wch: 16 }, // City
    { wch: 18 }, // Vendor
    { wch: 34 }, // Instances
    { wch: 16 }, // Rows
    { wch: 18 }, // Unique tickets
    { wch: 24 }, // Repeats
    { wch: 22 }, // No ticket
    { wch: 20 }, // Total hours
    { wch: 26 }, // Last start
    { wch: 48 }, // Ticket IDs
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Store Instances');
  XLSX.writeFile(
    workbook,
    `Store_Instances_${report.months}M_${formattedIST.replace(/[\/\s:]/g, '_')}.xlsx`
  );
}
