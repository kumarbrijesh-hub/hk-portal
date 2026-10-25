import * as XLSX from 'xlsx';
import { toPng } from 'html-to-image';
import { Disruption } from '../types';
import { getCurrentISTDate, getReportFileTimestamp } from './dateUtils';
import { readIssues, readSubIssues } from './issueTaxonomy';
import { liveUpdateReportBlock } from './liveUpdateLog';

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

export function exportActiveReportToCSV(unorderedDisruptions: Disruption[], activeFiltersDescription?: string) {
  const disruptions = orderByDisruptionVolume(unorderedDisruptions);
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
    d.currentStatus,
    `"${readIssues(d).join(' | ').replace(/"/g, '""')}"`,
    `"${readSubIssues(d).join(' | ').replace(/"/g, '""')}"`,
    String(readSubIssues(d).length),
    `"${liveUpdateReportBlock(d).replace(/"/g, '""')}"`,
    d.lastUpdatedBy,
    d.lastUpdatedAt,
  ]);

  const csvContent = [
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

export function exportActiveReportToExcel(unorderedDisruptions: Disruption[], activeFiltersDescription?: string) {
  const disruptions = orderByDisruptionVolume(unorderedDisruptions);
  const { formattedIST } = getCurrentISTDate();

  const metadataRows = [
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
