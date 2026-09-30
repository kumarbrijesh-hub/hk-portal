import * as XLSX from 'xlsx';
import { toPng } from 'html-to-image';
import { Disruption } from '../types';
import { getCurrentISTDate, getProFixFileTimestamp } from './dateUtils';

export async function exportActiveReportToPNG(elementId: string, customFilename?: string): Promise<void> {
  const node = document.getElementById(elementId);
  if (!node) {
    throw new Error(`Report element with ID "${elementId}" not found for PNG generation.`);
  }

  const filename = customFilename || `ProFix_Active_Disruptions_${getProFixFileTimestamp()}.png`;

  // Measure full scroll dimensions to guarantee complete table capture without clipping
  const fullWidth = Math.max(node.scrollWidth, 1280);
  const fullHeight = node.scrollHeight;

  // Generate PNG data URL at high resolution (pixelRatio: 2)
  // skipFonts: true prevents reading cssRules on cross-origin Google Fonts stylesheets
  const dataUrl = await toPng(node, {
    quality: 0.98,
    pixelRatio: 2,
    width: fullWidth,
    height: fullHeight,
    backgroundColor: '#ffffff',
    cacheBust: true,
    skipFonts: true,
    fontEmbedCSS: '',
    filter: (domNode) => {
      // Exclude external stylesheet links if any exist inside the element
      if (domNode.nodeName === 'LINK') {
        return false;
      }
      return true;
    },
    style: {
      width: `${fullWidth}px`,
      overflow: 'visible',
      transform: 'none',
    },
  });

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportActiveReportToCSV(disruptions: Disruption[], activeFiltersDescription?: string) {
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
    'Sub Issue',
    'Latest Live Update',
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
    `"${(d.issue || '').replace(/"/g, '""')}"`,
    `"${(d.subIssue || '').replace(/"/g, '""')}"`,
    `"${(d.latestLiveUpdate || '').replace(/"/g, '""')}"`,
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

export function exportActiveReportToExcel(disruptions: Disruption[], activeFiltersDescription?: string) {
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
    'Issue': d.issue || 'N/A',
    'Sub Issue': d.subIssue || 'N/A',
    'Latest Live Update': d.latestLiveUpdate,
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
    { wch: 26 }, // Sub Issue
    { wch: 45 }, // Latest Live Update
    { wch: 16 }, // Last Updated By
    { wch: 22 }, // Last Updated At
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Active Disruptions');
  XLSX.writeFile(workbook, `Active_Disruptions_Report_${formattedIST.replace(/[\/\s:]/g, '_')}.xlsx`);
}
