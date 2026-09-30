import React, { useState, useMemo } from 'react';
import {
  Search,
  ArrowUpDown,
  MessageSquarePlus,
  History,
  AlertTriangle,
  FileText,
  Download,
  Copy,
  Check,
  Columns,
  Pin,
  FileSpreadsheet,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Disruption } from '../types';
import { StatusBadge, BucketBadge } from './StatusBadge';

interface LiveTrackerTableProps {
  disruptions: Disruption[];
  onOpenLiveUpdate: (disruption: Disruption) => void;
  onOpenHistory: (disruption: Disruption) => void;
}

export const LiveTrackerTable: React.FC<LiveTrackerTableProps> = ({
  disruptions,
  onOpenLiveUpdate,
  onOpenHistory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [sortField, setSortField] = useState<'createdAt' | 'disruptionId' | 'outletId'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  // UX Highlighting state: Active cursor row pinned on click or hover
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [showLODColumns, setShowLODColumns] = useState(true);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState<string | null>(null);

  // Filtered and sorted disruptions
  const filteredDisruptions = useMemo(() => {
    let result = [...disruptions];

    // Status filter
    if (statusFilter !== 'ALL') {
      result = result.filter((d) => d.currentStatus === statusFilter);
    }

    // Bucket filter
    if (bucketFilter !== 'ALL') {
      result = result.filter((d) => d.bucket === bucketFilter);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (d) =>
          d.disruptionId.toLowerCase().includes(q) ||
          d.outletId.toLowerCase().includes(q) ||
          d.storeName.toLowerCase().includes(q) ||
          d.city.toLowerCase().includes(q) ||
          d.ccPoc.toLowerCase().includes(q) ||
          d.vendor.toLowerCase().includes(q) ||
          (d.currentVendor && d.currentVendor.toLowerCase().includes(q)) ||
          (d.amcCoverage && d.amcCoverage.toLowerCase().includes(q)) ||
          (d.lodL1Name && d.lodL1Name.toLowerCase().includes(q)) ||
          (d.ticketId && d.ticketId.toLowerCase().includes(q)) ||
          d.latestLiveUpdate.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'createdAt') {
        cmp = (b.createdAt || '').localeCompare(a.createdAt || '');
      } else if (sortField === 'disruptionId') {
        cmp = a.disruptionId.localeCompare(b.disruptionId);
      } else if (sortField === 'outletId') {
        cmp = a.outletId.localeCompare(b.outletId);
      }
      return sortAsc ? -cmp : cmp;
    });

    return result;
  }, [disruptions, searchQuery, statusFilter, bucketFilter, sortField, sortAsc]);

  const toggleSort = (field: 'createdAt' | 'disruptionId' | 'outletId') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Google Sheet 'Live_data' Tab Export Header and Row generator
  const getLiveDataExportData = () => {
    const headers = [
      'Ticket Missing',
      'Disruption ID (Auto)',
      'Region (Auto)',
      'City (Auto)',
      'Store Name (Auto)',
      'Mode (Auto)',
      'Vendor (Auto)',
      'AMC Coverage',
      'Current Vendor (AMC or Warranty)',
      'POC Name (Auto)',
      'POC Contact No. (Auto)',
      'MST/RAC Name (Auto)',
      'MST/RAC contact no. (Auto)',
      'LOD - 2 L1 Name',
      'LOD - 2 L1 Email',
      'LOD - 2 L1 Contact No',
      'LOD - 2 L2 Name',
      'LOD - 2 L2 Email',
      'LOD - 2 L2 Contact No',
      'LOD - 2 L3 Name',
      'LOD - 2 L3 Email',
      'LOD - 2 L3 Contact No.',
      'CC POC',
      'Outlet ID',
      'Start time\n(Paste from Serviceabilty)',
      'Bucket',
      'Parent Ticket ID\n(Only If Machine Breakdown)',
      'Current Status',
      'Live updates',
      'Remark',
      'Issue Identified (Mandatory)',
      'Sub-issue Identified (Mandatory)',
      'End time (Auto)',
      'Duration (Auto)',
      'Ticket Closed At (Auto)',
      'City Lead',
      'Regional Head',
      'Week',
      'Store Type',
      'Shift',
    ];

    const rows = filteredDisruptions.map((d) => {
      const isMissing = !d.ticketId || d.ticketId.trim() === '' ? 'Yes' : 'No';
      return [
        d.ticketMissing || isMissing,
        d.disruptionId,
        d.region || '',
        d.city,
        d.storeName,
        d.mode,
        d.vendor,
        d.amcCoverage || '',
        d.currentVendor || d.vendor,
        d.coldPocName2 || d.pocName,
        d.coldPocContact2 || d.pocContact,
        d.mstRacName || '',
        d.mstRacContact || '',
        d.lodL1Name || '',
        d.lodL1Email || '',
        d.lodL1Contact || '',
        d.lodL2Name || '',
        d.lodL2Email || '',
        d.lodL2Contact || '',
        d.lodL3Name || '',
        d.lodL3Email || '',
        d.lodL3Contact || '',
        d.ccPoc,
        d.outletId,
        d.disruptionStartDateTime,
        d.bucket,
        d.parentTicketId || d.ticketId || '',
        d.currentStatus,
        d.latestLiveUpdate,
        d.remark || '',
        d.issue || '',
        d.subIssue || '',
        d.endTime || '',
        d.duration || '',
        d.ticketClosedAt || '',
        d.cityLead || '',
        d.regionalHead || '',
        d.week || '',
        d.storeType || d.mode,
        d.shift || '',
      ];
    });

    return { headers, rows };
  };

  // 1. Download CSV for Google Sheet 'Live_data'
  const handleDownloadCSV = () => {
    const { headers, rows } = getLiveDataExportData();
    const csvContent =
      '\uFEFF' +
      [
        headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
        ...rows.map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')),
      ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Live_data_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setDownloadNotification(`Downloaded Live_data.csv (${rows.length} rows for Google Sheet tab: Live_data)`);
    setTimeout(() => setDownloadNotification(null), 4000);
  };

  // 2. Copy TSV directly to clipboard to paste into Google Sheet tab 'Live_data'
  const handleCopyForSheet = async () => {
    const { headers, rows } = getLiveDataExportData();
    const tsvContent = [
      headers.map((h) => h.replace(/[\t\r\n]+/g, ' ')).join('\t'),
      ...rows.map((r) => r.map((cell) => String(cell || '').replace(/[\t\r\n]+/g, ' ')).join('\t')),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(tsvContent);
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 3500);
    } catch {
      // Fallback
      handleDownloadCSV();
    }
  };

  return (
    <div id="live-tracker-table-section" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden space-y-4">
      {/* Table Control Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-700" />
              Live Tracker Master Log
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 font-semibold">
                {filteredDisruptions.length} of {disruptions.length} Incidents
              </span>
            </h3>
            <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded border border-emerald-300 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Google Sheet Tab: Live_data
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Hover over any row to highlight. Click any row to lock/pin focus while scrolling across columns.
          </p>
        </div>

        {/* Action Buttons: Download & Copy for Google Sheet */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Download Live_data CSV */}
          <button
            id="btn-download-live-tracker-csv"
            type="button"
            onClick={handleDownloadCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            title="Download CSV for Google Sheet Live_data tab"
          >
            <Download className="w-4 h-4" />
            <span>Download All Data (Live_data.csv)</span>
          </button>

          {/* Copy for Google Sheet Tab */}
          <button
            id="btn-copy-live-tracker-tsv"
            type="button"
            onClick={handleCopyForSheet}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold shadow-2xs transition cursor-pointer"
            title="Copy formatted rows to clipboard to paste directly into Google Sheet 'Live_data' tab"
          >
            {copiedNotification ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-700 font-bold">Copied for Live_data!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-500" />
                <span>Copy for Sheet (Live_data)</span>
              </>
            )}
          </button>

          {/* Toggle LOD Columns */}
          <button
            id="btn-toggle-lod-columns"
            type="button"
            onClick={() => setShowLODColumns(!showLODColumns)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold transition cursor-pointer"
            title="Toggle AMC and LOD-2 Escalation Columns"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>{showLODColumns ? 'Hide LOD/AMC Cols' : 'Show LOD/AMC Cols'}</span>
          </button>
        </div>
      </div>

      {/* Notifications Toast */}
      {downloadNotification && (
        <div className="mx-4 p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg text-xs font-medium flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{downloadNotification}</span>
        </div>
      )}
      {copiedNotification && (
        <div className="mx-4 p-2.5 bg-blue-50 border border-blue-300 text-blue-900 rounded-lg text-xs font-medium flex items-center gap-2">
          <Check className="w-4 h-4 text-blue-600 shrink-0" />
          <span>All data copied! Open Google Sheet, select tab <strong>Live_data</strong> cell A1, and press Ctrl+V / Cmd+V to paste.</span>
        </div>
      )}

      {/* Filter Controls Bar */}
      <div className="px-4 sm:px-5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Search */}
          <div className="relative min-w-[220px] flex-1 sm:flex-initial">
            <input
              id="live-tracker-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, store, vendor, AMC, LOD..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-red-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          </div>

          {/* Status Filter */}
          <select
            id="live-tracker-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium focus:ring-2 focus:ring-red-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="RAC Aligned">RAC Aligned</option>
            <option value="RAC Visited">RAC Visited</option>
            <option value="OEM Aligned">OEM Aligned</option>
            <option value="OEM Visited">OEM Visited</option>
            <option value="Auto Disable">Auto Disable</option>
            <option value="Known Admin Issue">Known Admin Issue</option>
            <option value="Disruption">Disruption</option>
            <option value="Audit in Process">Audit in Process</option>
            <option value="Resolved by RAC">Resolved by RAC</option>
            <option value="Resolved by OEM">Resolved by OEM</option>
            <option value="Resolved by Dealer">Resolved by Dealer</option>
            <option value="Resolved by CC">Resolved by CC</option>
            <option value="Disable">Disable</option>
          </select>

          {/* Bucket Filter */}
          <select
            id="live-tracker-bucket-filter"
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium focus:ring-2 focus:ring-red-500"
          >
            <option value="ALL">All Buckets</option>
            <option value="Breakdown">Breakdown</option>
            <option value="Non Breakdown">Non Breakdown</option>
            <option value="False Alarm / Invalid">False Alarm / Invalid</option>
          </select>
        </div>

        {activeRowId && (
          <div className="flex items-center gap-2 bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-lg text-xs">
            <Pin className="w-3.5 h-3.5 text-amber-700" />
            <span>Row <strong>{activeRowId}</strong> is pinned.</span>
            <button
              type="button"
              onClick={() => setActiveRowId(null)}
              className="text-amber-800 hover:text-amber-950 underline font-bold ml-1 cursor-pointer"
            >
              Clear Pin
            </button>
          </div>
        )}
      </div>

      {/* Desktop & Tablet Table with Horizontal Scroll & Cursor Highlighting */}
      <div className="hidden lg:block overflow-x-auto border-t border-slate-200">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th
                onClick={() => toggleSort('disruptionId')}
                className="py-3 px-3 cursor-pointer hover:bg-slate-200 transition select-none sticky left-0 bg-slate-100 z-20 shadow-sm"
              >
                <div className="flex items-center gap-1">
                  <span>Disruption ID</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th
                onClick={() => toggleSort('outletId')}
                className="py-3 px-3 cursor-pointer hover:bg-slate-200 transition select-none"
              >
                <div className="flex items-center gap-1">
                  <span>Outlet / Store</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </div>
              </th>
              <th className="py-3 px-3 whitespace-nowrap">City / Mode</th>
              <th className="py-3 px-3 whitespace-nowrap">Vendor (Auto)</th>
              <th className="py-3 px-3 whitespace-nowrap">Cold POC Name-2 / Contact</th>
              <th className="py-3 px-3 whitespace-nowrap">Start Time (IST)</th>
              <th className="py-3 px-3 whitespace-nowrap">CC POC</th>
              <th className="py-3 px-3 whitespace-nowrap">Bucket</th>
              <th className="py-3 px-3 whitespace-nowrap">Ticket ID</th>
              <th className="py-3 px-3 whitespace-nowrap">Current Status</th>
              <th className="py-3 px-3 whitespace-nowrap">Issue / Sub Issue</th>
              <th className="py-3 px-4 min-w-[240px]">Latest Live Update</th>
              <th className="py-3 px-3 whitespace-nowrap">Last Updated By / At</th>

              {/* LOD & AMC Escalation Matrix Columns (Placed at the LAST of data columns as requested) */}
              {showLODColumns && (
                <>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/80 text-amber-900 font-bold border-l border-amber-200">
                    AMC Coverage
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/80 text-amber-900 font-bold">
                    Current Vendor (AMC or Warranty)
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/80 text-amber-900 font-bold">
                    Region (Auto)
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/50 text-slate-800">
                    LOD - 2 L1 Name
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/50 text-slate-800">
                    LOD - 2 L1 Email
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/50 text-slate-800">
                    LOD - 2 L1 Contact No
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/30 text-slate-800">
                    LOD - 2 L2 Name
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/30 text-slate-800">
                    LOD - 2 L2 Email
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/30 text-slate-800">
                    LOD - 2 L2 Contact No
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/10 text-slate-800">
                    LOD - 2 L3 Name
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/10 text-slate-800">
                    LOD - 2 L3 Email
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/10 text-slate-800">
                    LOD - 2 L3 Contact No.
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/20 text-slate-800">
                    MST/RAC Name (Auto)
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap bg-amber-50/20 text-slate-800 border-r border-slate-200">
                    MST/RAC Contact No. (Auto)
                  </th>
                </>
              )}

              <th className="py-3 px-3 text-right sticky right-0 bg-slate-100 z-20 shadow-sm">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {filteredDisruptions.length === 0 ? (
              <tr>
                <td colSpan={showLODColumns ? 28 : 14} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertTriangle className="w-6 h-6 text-slate-300" />
                    <span>No disruption records matching your criteria.</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredDisruptions.map((d) => {
                const isPinned = activeRowId === d.disruptionId;

                return (
                  <tr
                    key={d.disruptionId}
                    id={`live-tracker-row-${d.disruptionId}`}
                    onClick={() => setActiveRowId(isPinned ? null : d.disruptionId)}
                    title="Click row to lock highlight for horizontal scrolling"
                    className={`transition-colors duration-150 cursor-pointer group ${
                      isPinned
                        ? 'bg-amber-100 hover:bg-amber-100 font-medium border-y-2 border-amber-400 shadow-xs'
                        : 'hover:bg-amber-50/90'
                    }`}
                  >
                    {/* Disruption ID - Sticky left for scrolling ease */}
                    <td
                      className={`py-3 px-3 font-mono font-bold whitespace-nowrap sticky left-0 z-10 transition-colors ${
                        isPinned ? 'bg-amber-100 text-amber-950' : 'bg-white group-hover:bg-amber-50/90 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isPinned ? (
                          <Pin className="w-3.5 h-3.5 text-amber-600 shrink-0 fill-amber-500" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 group-hover:bg-amber-500 transition-colors" />
                        )}
                        <span>{d.disruptionId}</span>
                      </div>
                    </td>

                    {/* Outlet / Store */}
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-slate-800">{d.outletId}</div>
                      <div className="text-[11px] text-slate-600 truncate max-w-[150px]" title={d.storeName}>
                        {d.storeName}
                      </div>
                    </td>

                    {/* City / Mode */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{d.city}</div>
                      <div className="text-[11px] text-slate-500">{d.mode}</div>
                    </td>

                    {/* Vendor */}
                    <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">{d.vendor}</td>

                    {/* Cold POC Name-2 Details */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{d.coldPocName2 || d.pocName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{d.coldPocContact2 || d.pocContact}</div>
                    </td>

                    {/* Start Time (IST) */}
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-600">
                      {d.disruptionStartDateTime}
                    </td>

                    {/* CC POC */}
                    <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-800">{d.ccPoc}</td>

                    {/* Bucket */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <BucketBadge bucket={d.bucket} />
                    </td>

                    {/* Ticket ID */}
                    <td className="py-3 px-3 whitespace-nowrap font-mono font-medium text-slate-700">
                      {d.ticketId || '—'}
                    </td>

                    {/* Current Status */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <StatusBadge status={d.currentStatus} />
                    </td>

                    {/* Issue / Sub Issue */}
                    <td className="py-3 px-3">
                      {d.issue ? (
                        <div>
                          <div className="font-semibold text-slate-800 text-[11px]">{d.issue}</div>
                          <div className="text-[10px] text-slate-500">{d.subIssue}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Latest Live Update */}
                    <td className="py-3 px-4">
                      <p className="text-xs text-slate-700 line-clamp-2" title={d.latestLiveUpdate}>
                        {d.latestLiveUpdate}
                      </p>
                    </td>

                    {/* Last Updated By / At */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{d.lastUpdatedBy}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{d.lastUpdatedAt}</div>
                    </td>

                    {/* Requested Columns: AMC & LOD Escalation Matrix placed at the LAST as requested */}
                    {showLODColumns && (
                      <>
                        <td className="py-3 px-3 whitespace-nowrap bg-amber-50/30 border-l border-amber-200/60 font-medium text-amber-950">
                          {d.amcCoverage ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px]">
                              {d.amcCoverage}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap bg-amber-50/30 font-medium text-amber-950">
                          {d.currentVendor || d.vendor || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap bg-amber-50/30 font-medium text-amber-950">
                          {d.region || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">
                          {d.lodL1Name || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                          {d.lodL1Email || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700 font-mono">
                          {d.lodL1Contact || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">
                          {d.lodL2Name || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                          {d.lodL2Email || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700 font-mono">
                          {d.lodL2Contact || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">
                          {d.lodL3Name || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                          {d.lodL3Email || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700 font-mono">
                          {d.lodL3Contact || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-700">
                          {d.mstRacName || '—'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700 font-mono border-r border-slate-200">
                          {d.mstRacContact || '—'}
                        </td>
                      </>
                    )}

                    {/* Actions - Sticky right */}
                    <td
                      className={`py-3 px-3 text-right whitespace-nowrap sticky right-0 z-10 transition-colors ${
                        isPinned ? 'bg-amber-100' : 'bg-white group-hover:bg-amber-50/90'
                      }`}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLiveUpdate(d);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-medium text-[11px] transition border border-red-200 cursor-pointer"
                          title="Add Live Update"
                        >
                          <MessageSquarePlus className="w-3 h-3" />
                          <span>Update</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenHistory(d);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition border border-slate-200 cursor-pointer"
                          title="View Full Update History / Audit Trail"
                        >
                          <History className="w-3 h-3" />
                          <span>History ({d.updateHistory?.length || 1})</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile / Tablet Responsive Cards */}
      <div className="lg:hidden p-4 space-y-4">
        {filteredDisruptions.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            No disruption records matching your criteria.
          </div>
        ) : (
          filteredDisruptions.map((d) => (
            <div
              key={d.disruptionId}
              onClick={() => setActiveRowId(activeRowId === d.disruptionId ? null : d.disruptionId)}
              className={`p-4 rounded-xl border transition-all space-y-3 cursor-pointer ${
                activeRowId === d.disruptionId
                  ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400'
                  : 'bg-white border-slate-200 hover:bg-amber-50/40'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-sm text-slate-900">
                  {d.disruptionId}
                </span>
                <StatusBadge status={d.currentStatus} />
              </div>

              {/* Outlet Info */}
              <div className="grid grid-cols-2 gap-2 text-xs border-y border-slate-100 py-2">
                <div>
                  <span className="text-slate-400 block text-[10px]">Outlet / Store</span>
                  <span className="font-bold text-slate-800">{d.outletId}</span>
                  <span className="text-slate-600 block text-[11px] truncate">{d.storeName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">City / Mode</span>
                  <span className="font-medium text-slate-800">{d.city}</span>
                  <span className="text-slate-500 block text-[11px]">{d.mode}</span>
                </div>
              </div>

              {/* Vendor & AMC Info */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-amber-50/50 p-2 rounded border border-amber-200/50">
                <div>
                  <span className="text-amber-900 block text-[10px] font-semibold">Vendor</span>
                  <span className="font-bold text-slate-800">{d.vendor}</span>
                  {d.currentVendor && <span className="text-[10px] text-slate-600 block">Current: {d.currentVendor}</span>}
                </div>
                <div>
                  <span className="text-amber-900 block text-[10px] font-semibold">AMC Coverage</span>
                  <span className="font-medium text-slate-800">{d.amcCoverage || 'N/A'}</span>
                </div>
              </div>

              {/* LOD L1 Escalation */}
              {d.lodL1Name && (
                <div className="text-[11px] bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="font-bold text-slate-700 block">LOD-2 L1: {d.lodL1Name}</span>
                  <span className="text-slate-500 block">{d.lodL1Email} • {d.lodL1Contact}</span>
                </div>
              )}

              {/* Latest Live Update */}
              <div className="text-xs bg-slate-50 p-2 rounded border border-slate-200">
                <span className="text-[10px] text-slate-500 block font-semibold">Latest Live Update:</span>
                <p className="text-slate-700 italic mt-0.5">{d.latestLiveUpdate}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLiveUpdate(d);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-xs transition"
                >
                  Add Update
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenHistory(d);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition border border-slate-200"
                >
                  History
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
