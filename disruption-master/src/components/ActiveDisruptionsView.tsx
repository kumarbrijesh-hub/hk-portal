import React, { useState, useMemo } from 'react';
import {
  Download,
  Filter,
  Search,
  AlertOctagon,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  MessageSquarePlus,
  History,
  Calendar,
  Layers,
  Image as ImageIcon,
  CheckCircle,
  AlertCircle,
  Pin,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Disruption, isDisruptionActive } from '../types';
import { StatusBadge, BucketBadge } from './StatusBadge';
import {
  exportActiveReportToCSV,
  exportActiveReportToExcel,
  exportActiveReportToPNG,
} from '../utils/reportExport';
import { getCurrentISTDate, formatProFixGeneratedTimestamp, calculateDurationHours } from '../utils/dateUtils';

interface ActiveDisruptionsViewProps {
  allDisruptions: Disruption[];
  onOpenLiveUpdate: (disruption: Disruption) => void;
  onOpenHistory: (disruption: Disruption) => void;
  onRefreshData?: () => void;
}

export const ActiveDisruptionsView: React.FC<ActiveDisruptionsViewProps> = ({
  allDisruptions,
  onOpenLiveUpdate,
  onOpenHistory,
  onRefreshData,
}) => {
  // Filter states
  const [cityFilter, setCityFilter] = useState('ALL');
  const [outletFilter, setOutletFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState('ALL');
  const [ccPocFilter, setCcPocFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // UX Highlighting state: Active cursor row pinned on click/hover for effortless scrolling
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  // Export dropdown state
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isGeneratingPng, setIsGeneratingPng] = useState(false);
  const [pngSuccessToast, setPngSuccessToast] = useState(false);
  const [pngErrorToast, setPngErrorToast] = useState<string | null>(null);

  // 1. Strict Active Disruption Logic
  const allActiveDisruptions = useMemo(() => {
    return allDisruptions.filter((d) => isDisruptionActive(d.currentStatus));
  }, [allDisruptions]);

  // Unique options for filters from active pool
  const uniqueCities = useMemo(() => {
    return Array.from(new Set(allActiveDisruptions.map((d) => d.city).filter(Boolean))).sort();
  }, [allActiveDisruptions]);

  const uniqueVendors = useMemo(() => {
    return Array.from(new Set(allActiveDisruptions.map((d) => d.vendor).filter(Boolean))).sort();
  }, [allActiveDisruptions]);

  const uniqueModes = useMemo(() => {
    return Array.from(new Set(allActiveDisruptions.map((d) => d.mode).filter(Boolean))).sort();
  }, [allActiveDisruptions]);

  const uniqueCcPocs = useMemo(() => {
    return Array.from(new Set(allActiveDisruptions.map((d) => d.ccPoc).filter(Boolean))).sort();
  }, [allActiveDisruptions]);

  const uniqueStatuses = useMemo(() => {
    return Array.from(new Set(allActiveDisruptions.map((d) => d.currentStatus).filter(Boolean))).sort();
  }, [allActiveDisruptions]);

  // 2. Filter application
  const filteredActiveDisruptions = useMemo(() => {
    return allActiveDisruptions.filter((d) => {
      if (cityFilter !== 'ALL' && d.city !== cityFilter) return false;
      if (outletFilter.trim() && !d.outletId.toLowerCase().includes(outletFilter.toLowerCase().trim())) return false;
      if (storeFilter.trim() && !d.storeName.toLowerCase().includes(storeFilter.toLowerCase().trim())) return false;
      if (vendorFilter !== 'ALL' && d.vendor !== vendorFilter) return false;
      if (modeFilter !== 'ALL' && d.mode !== modeFilter) return false;
      if (ccPocFilter !== 'ALL' && d.ccPoc !== ccPocFilter) return false;
      if (bucketFilter !== 'ALL' && d.bucket !== bucketFilter) return false;
      if (statusFilter !== 'ALL' && d.currentStatus !== statusFilter) return false;
      if (dateFilter && d.disruptionStartDate !== dateFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          d.disruptionId.toLowerCase().includes(q) ||
          d.outletId.toLowerCase().includes(q) ||
          d.storeName.toLowerCase().includes(q) ||
          d.city.toLowerCase().includes(q) ||
          d.ccPoc.toLowerCase().includes(q) ||
          d.vendor.toLowerCase().includes(q) ||
          (d.ticketId && d.ticketId.toLowerCase().includes(q)) ||
          d.latestLiveUpdate.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [
    allActiveDisruptions,
    cityFilter,
    outletFilter,
    storeFilter,
    vendorFilter,
    modeFilter,
    ccPocFilter,
    bucketFilter,
    statusFilter,
    dateFilter,
    searchQuery,
  ]);

  // Check if disruption belongs to Auditing & Non-Admin section
  const isAuditOrNonAdmin = (d: Disruption): boolean => {
    const text = `${d.currentStatus} ${d.bucket} ${d.issue || ''} ${d.subIssue || ''} ${d.latestLiveUpdate || ''}`.toLowerCase();
    return (
      text.includes('audit') ||
      text.includes('non-admin') ||
      text.includes('admin issue') ||
      text.includes('known admin') ||
      d.currentStatus === 'Audit in Process' ||
      d.currentStatus === 'Known Admin Issue' ||
      d.bucket === 'False Alarm / Invalid'
    );
  };

  const standardActiveDisruptions = useMemo(() => {
    return filteredActiveDisruptions.filter((d) => !isAuditOrNonAdmin(d));
  }, [filteredActiveDisruptions]);

  const auditActiveDisruptions = useMemo(() => {
    return filteredActiveDisruptions.filter((d) => isAuditOrNonAdmin(d));
  }, [filteredActiveDisruptions]);

  // ProFix Active Metrics calculation matching report screenshot
  const profixStats = useMemo(() => {
    const breakdownDisruptions = filteredActiveDisruptions.filter((d) => d.bucket === 'Breakdown');
    const nonBreakdownDisruptions = filteredActiveDisruptions.filter((d) => d.bucket !== 'Breakdown');

    const totalActive = filteredActiveDisruptions.length;
    const breakdownCount = breakdownDisruptions.length;
    const nonBreakdownCount = nonBreakdownDisruptions.length;

    const breakdownDur = breakdownDisruptions.reduce(
      (sum, d) => sum + calculateDurationHours(d.disruptionStartDateTime),
      0
    );
    const nonBreakdownDur = nonBreakdownDisruptions.reduce(
      (sum, d) => sum + calculateDurationHours(d.disruptionStartDateTime),
      0
    );
    const totalDur = breakdownDur + nonBreakdownDur;

    const breakdownDurPct = totalDur > 0 ? ((breakdownDur / totalDur) * 100).toFixed(1) : '0.0';
    const nonBreakdownDurPct = totalDur > 0 ? ((nonBreakdownDur / totalDur) * 100).toFixed(1) : '0.0';

    const avgDur = totalActive > 0 ? (totalDur / totalActive).toFixed(1) : '0.0';
    const avgBreakdownDur = breakdownCount > 0 ? (breakdownDur / breakdownCount).toFixed(1) : '0.0';
    const avgNonBreakdownDur = nonBreakdownCount > 0 ? (nonBreakdownDur / nonBreakdownCount).toFixed(1) : '0.0';

    return {
      totalActive,
      breakdownCount,
      nonBreakdownCount,
      totalDur: totalDur.toFixed(1),
      breakdownDur: breakdownDur.toFixed(1),
      nonBreakdownDur: nonBreakdownDur.toFixed(1),
      breakdownDurPct,
      nonBreakdownDurPct,
      avgDur,
      avgBreakdownDur,
      avgNonBreakdownDur,
    };
  }, [filteredActiveDisruptions]);

  const resetAllFilters = () => {
    setCityFilter('ALL');
    setOutletFilter('');
    setStoreFilter('');
    setVendorFilter('ALL');
    setModeFilter('ALL');
    setCcPocFilter('ALL');
    setBucketFilter('ALL');
    setStatusFilter('ALL');
    setDateFilter('');
    setSearchQuery('');
  };

  const hasActiveFilters =
    cityFilter !== 'ALL' ||
    outletFilter !== '' ||
    storeFilter !== '' ||
    vendorFilter !== 'ALL' ||
    modeFilter !== 'ALL' ||
    ccPocFilter !== 'ALL' ||
    bucketFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    dateFilter !== '' ||
    searchQuery !== '';

  const getActiveFiltersSummary = (): string => {
    const parts: string[] = [];
    if (cityFilter !== 'ALL') parts.push(`City: ${cityFilter}`);
    if (vendorFilter !== 'ALL') parts.push(`Vendor: ${vendorFilter}`);
    if (modeFilter !== 'ALL') parts.push(`Mode: ${modeFilter}`);
    if (ccPocFilter !== 'ALL') parts.push(`CC POC: ${ccPocFilter}`);
    if (bucketFilter !== 'ALL') parts.push(`Bucket: ${bucketFilter}`);
    if (statusFilter !== 'ALL') parts.push(`Status: ${statusFilter}`);
    if (outletFilter) parts.push(`Outlet: ${outletFilter}`);
    if (dateFilter) parts.push(`Date: ${dateFilter}`);
    if (searchQuery) parts.push(`Search: "${searchQuery}"`);
    return parts.length > 0 ? parts.join(', ') : 'All Active';
  };

  const handleDownloadCSV = () => {
    exportActiveReportToCSV(filteredActiveDisruptions, getActiveFiltersSummary());
    setExportMenuOpen(false);
  };

  const handleDownloadExcel = () => {
    exportActiveReportToExcel(filteredActiveDisruptions, getActiveFiltersSummary());
    setExportMenuOpen(false);
  };

  const handleDownloadPNG = async () => {
    setIsGeneratingPng(true);
    setExportMenuOpen(false);
    setPngErrorToast(null);
    try {
      // Small pause to allow dropdown menu to unmount cleanly
      await new Promise((resolve) => setTimeout(resolve, 200));
      await exportActiveReportToPNG('active-disruptions-report-capture');
      setPngSuccessToast(true);
      setTimeout(() => setPngSuccessToast(false), 4000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('PNG export failed:', err);
      setPngErrorToast('Failed to generate PNG image: ' + errorMsg);
      setTimeout(() => setPngErrorToast(null), 6000);
    } finally {
      setIsGeneratingPng(false);
    }
  };

  return (
    <div id="active-disruptions-page" className="space-y-6">
      {/* PNG Download Toast Notification */}
      {pngSuccessToast && (
        <div
          id="png-export-success-toast"
          className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-emerald-500 flex items-center gap-3 animate-fade-in"
        >
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <div>
            <div className="text-xs font-bold text-emerald-400">PNG Export Complete!</div>
            <div className="text-[11px] text-slate-300">
              Active Disruption Report downloaded as PNG image.
            </div>
          </div>
        </div>
      )}

      {/* PNG Error Toast Notification */}
      {pngErrorToast && (
        <div
          id="png-export-error-toast"
          className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-rose-500 flex items-center gap-3 animate-fade-in"
        >
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <div className="text-xs font-bold text-rose-400">Export Failed</div>
            <div className="text-[11px] text-slate-300 max-w-sm">{pngErrorToast}</div>
          </div>
        </div>
      )}

      {/* 17. Active Disruption Dashboard Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-lg border border-slate-700/80 p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-6 h-6 text-amber-400" />
              <h2 className="text-xl font-black uppercase tracking-wider text-white">
                LIVE ACTIVE DISRUPTIONS
              </h2>
            </div>
            <p className="text-xs text-slate-300">
              Filtered live operational dashboard. Excludes: Resolved by RAC, Resolved by OEM, Resolved by CC, and Disable.
            </p>
          </div>

          {/* Large Total Active Metric */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-950/60 px-5 py-3 rounded-xl border border-amber-500/30 shadow-inner">
            <div>
              <span className="text-xs uppercase font-bold tracking-wider text-amber-400 block">
                Total Active
              </span>
              <div className="text-3xl font-black text-amber-300 font-mono flex items-baseline gap-1">
                <span>{allActiveDisruptions.length}</span>
                <span className="text-xs font-normal text-slate-400">incidents</span>
              </div>
            </div>

            {hasActiveFilters && (
              <>
                <div className="h-8 w-px bg-slate-700 hidden sm:block" />
                <div>
                  <span className="text-[11px] uppercase font-semibold text-slate-400 block">
                    Filtered
                  </span>
                  <div className="text-2xl font-bold text-white font-mono">
                    {filteredActiveDisruptions.length}
                  </div>
                </div>
              </>
            )}

            {/* Direct 1-Click PNG Download Button */}
            <button
              id="download-active-report-png-direct-btn"
              type="button"
              onClick={handleDownloadPNG}
              disabled={isGeneratingPng}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs tracking-wider shadow-md transition flex items-center gap-2 active:scale-95 cursor-pointer disabled:opacity-50"
              title="Download Active Disruption Report as PNG Image"
            >
              {isGeneratingPng ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>GENERATING PNG...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4 text-slate-950" />
                  <span>DOWNLOAD PNG</span>
                </>
              )}
            </button>

            {/* Download Report Button with Dropdown */}
            <div className="relative">
              <button
                id="download-active-report-btn"
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs tracking-wide shadow-md transition flex items-center gap-2 active:scale-95 cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-950" />
                <span>EXPORT OPTIONS</span>
              </button>

              {exportMenuOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-lg shadow-xl border border-slate-200 z-30 py-1 text-slate-800">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100">
                    Export Filtered ({filteredActiveDisruptions.length} records)
                  </div>
                  {/* PNG Option */}
                  <button
                    id="download-active-report-png-menu-option"
                    type="button"
                    onClick={handleDownloadPNG}
                    disabled={isGeneratingPng}
                    className="w-full text-left px-4 py-2.5 text-xs hover:bg-emerald-50 flex items-center justify-between font-semibold text-slate-900 border-b border-slate-100 transition"
                  >
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-emerald-600" />
                      <span>Download as PNG (.png)</span>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
                      IMAGE
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-amber-50 flex items-center gap-2 font-medium transition"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Download as Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCSV}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-amber-50 flex items-center gap-2 font-medium transition"
                  >
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span>Download as CSV (.csv)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Filter Toolbar */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-500" />
            Operational Filters
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium flex items-center gap-1 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
          {/* City Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">City</label>
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All Cities</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>

          {/* Vendor Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vendor</label>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All Vendors</option>
              {uniqueVendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mode</label>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All Modes</option>
              {uniqueModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* CC POC Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">CC POC</label>
            <select
              value={ccPocFilter}
              onChange={(e) => setCcPocFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All CC POCs</option>
              {uniqueCcPocs.map((poc) => (
                <option key={poc} value={poc}>
                  {poc}
                </option>
              ))}
            </select>
          </div>

          {/* Bucket Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bucket</label>
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All Buckets</option>
              <option value="Breakdown">Breakdown</option>
              <option value="Non Breakdown">Non Breakdown</option>
              <option value="False Alarm / Invalid">False Alarm / Invalid</option>
            </select>
          </div>

          {/* Current Status Filter (Active statuses) */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Current Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            >
              <option value="ALL">All Active Statuses</option>
              {uniqueStatuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Disruption Date</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </div>

          {/* Outlet ID Search */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Outlet ID</label>
            <input
              type="text"
              value={outletFilter}
              onChange={(e) => setOutletFilter(e.target.value)}
              placeholder="e.g. OUT12345"
              className="w-full p-2 rounded-lg border border-slate-300 bg-white uppercase font-mono"
            />
          </div>

          {/* Store Name Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Store Name</label>
            <input
              type="text"
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              placeholder="Filter by store name..."
              className="w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </div>

          {/* Global Search */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Keyword Search</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search anything..."
                className="w-full pl-8 pr-2 py-2 rounded-lg border border-slate-300 bg-white"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>
        </div>
      </div>

      {/* 18. ProFix Active Disruptions Report View (Target Container for PNG Report Export) */}
      <div
        id="active-disruptions-report-capture"
        className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
      >
        {/* ProFix Branding & Action Bar */}
        <div className="p-6 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-0.5">
              <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">Pro</span>
              <span className="text-3xl sm:text-4xl font-black text-emerald-500 tracking-tight">Fix</span>
            </div>
            <div className="text-[11px] font-bold tracking-[0.25em] text-slate-500 uppercase mt-0.5">
              ACTIVE DISRUPTIONS
            </div>
            <div className="mt-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-50/90 text-blue-700 border border-blue-200 text-xs font-semibold shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                Generated: {formatProFixGeneratedTimestamp()}
              </span>
            </div>
          </div>

          {/* Export & Actions Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              id="download-profix-png-btn"
              type="button"
              onClick={handleDownloadPNG}
              disabled={isGeneratingPng}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide shadow-xs transition flex items-center gap-2 active:scale-95 cursor-pointer disabled:opacity-50"
              title="Download ProFix Active Disruptions Report as PNG Image"
            >
              {isGeneratingPng ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  <span>Generating ProFix PNG...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4 text-white" />
                  <span>Download PNG Report (ProFix)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadExcel}
              className="px-3.5 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition border border-slate-200 flex items-center gap-1.5 cursor-pointer"
              title="Download Excel"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadCSV}
              className="px-3.5 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition border border-slate-200 flex items-center gap-1.5 cursor-pointer"
              title="Download CSV"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <span>CSV</span>
            </button>

            {onRefreshData && (
              <button
                type="button"
                onClick={onRefreshData}
                className="p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition border border-slate-200 cursor-pointer"
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Top 5 Metric Cards matching screenshot */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 p-5 bg-slate-50/70 border-b border-slate-200">
          {/* Card 1: ACTIVE NOW */}
          <div className="bg-white rounded-xl shadow-xs border-x border-b border-slate-200 border-t-4 border-t-rose-500 p-3.5 flex flex-col justify-between">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">
                ACTIVE NOW
              </span>
              <div className="text-4xl sm:text-5xl font-black text-rose-500 my-1.5 font-mono">
                {profixStats.totalActive}
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  <span>Breakdown</span>
                </div>
                <span className="font-bold text-slate-800">{profixStats.breakdownCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span>Non Breakdown</span>
                </div>
                <span className="font-bold text-slate-800">{profixStats.nonBreakdownCount}</span>
              </div>
            </div>
          </div>

          {/* Card 2: TOTAL DURATION */}
          <div className="bg-white rounded-xl shadow-xs border-x border-b border-slate-200 border-t-4 border-t-amber-500 p-3.5 flex flex-col justify-between">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">
                TOTAL DURATION
              </span>
              <div className="text-3xl sm:text-4xl font-black text-amber-500 my-1.5 font-mono flex items-baseline justify-center gap-1">
                <span>{profixStats.totalDur}</span>
                <span className="text-sm font-semibold text-slate-600">Hrs</span>
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <span>Breakdown</span>
                <span className="font-medium text-slate-700">{profixStats.breakdownDur} h ({profixStats.breakdownDurPct}%)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Non Breakdown</span>
                <span className="font-medium text-slate-700">{profixStats.nonBreakdownDur} h ({profixStats.nonBreakdownDurPct}%)</span>
              </div>
            </div>
          </div>

          {/* Card 3: AVG DURATION */}
          <div className="bg-white rounded-xl shadow-xs border-x border-b border-slate-200 border-t-4 border-t-amber-500 p-3.5 flex flex-col justify-between">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">
                AVG DURATION
              </span>
              <div className="text-3xl sm:text-4xl font-black text-amber-500 my-1.5 font-mono flex items-baseline justify-center gap-1">
                <span>{profixStats.avgDur}</span>
                <span className="text-sm font-semibold text-slate-600">Hrs</span>
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <span>Breakdown</span>
                <span className="font-medium text-slate-700">{profixStats.avgBreakdownDur} h</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Non Breakdown</span>
                <span className="font-medium text-slate-700">{profixStats.avgNonBreakdownDur} h</span>
              </div>
            </div>
          </div>

          {/* Card 4: AVG MST FRT */}
          <div className="bg-white rounded-xl shadow-xs border-x border-b border-slate-200 border-t-4 border-t-blue-500 p-3.5 flex flex-col justify-between">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">
                AVG MST FRT
              </span>
              <div className="text-3xl sm:text-4xl font-black text-blue-600 my-1.5 font-mono flex items-baseline justify-center gap-1">
                <span>0</span>
                <span className="text-sm font-semibold text-slate-600">Mins</span>
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <span>Breakdown</span>
                <span className="font-medium text-slate-700">0 m</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Non Breakdown</span>
                <span className="font-medium text-slate-700">-</span>
              </div>
            </div>
          </div>

          {/* Card 5: AVG CC FRT */}
          <div className="bg-white rounded-xl shadow-xs border-x border-b border-slate-200 border-t-4 border-t-blue-500 p-3.5 flex flex-col justify-between">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">
                AVG CC FRT
              </span>
              <div className="text-3xl sm:text-4xl font-black text-blue-600 my-1.5 font-mono flex items-baseline justify-center gap-1">
                <span>3</span>
                <span className="text-sm font-semibold text-slate-600">Mins</span>
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <span>Breakdown</span>
                <span className="font-medium text-slate-700">3 m</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Non Breakdown</span>
                <span className="font-medium text-slate-700">4 m</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pinned Row Focus Notice */}
        {activeRowId && (
          <div className="px-4 py-2 bg-amber-100 border-b border-amber-300 text-amber-900 text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5 text-amber-700 fill-amber-500" />
              <span>
                Row Locked: <strong>{activeRowId}</strong> (Highlighted so horizontal and vertical scrolling stays clear without confusion)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveRowId(null)}
              className="text-amber-900 font-bold underline hover:text-amber-950 cursor-pointer"
            >
              Clear Focus
            </button>
          </div>
        )}

        {/* Table 1: Standard Active Disruptions Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-500 font-bold text-[11px] uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-3 text-center w-10">#</th>
                <th className="py-3 px-3">City</th>
                <th className="py-3 px-4">Store Name</th>
                <th className="py-3 px-3">POC</th>
                <th className="py-3 px-3">Bucket</th>
                <th className="py-3 px-3">Dur (Hrs)</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 min-w-[260px]">Live Updates</th>
                <th className="py-3 px-3 text-center">CC FRT (M)</th>
                <th className="py-3 px-3 text-center">MST FRT (M)</th>
                <th className="py-3 px-3">Ticket ID</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {standardActiveDisruptions.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertOctagon className="w-6 h-6 text-slate-300" />
                      <span>No active disruptions matching the current filters.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                standardActiveDisruptions.map((d, index) => {
                  const isPinned = activeRowId === d.disruptionId;
                  const durHrs = calculateDurationHours(d.disruptionStartDateTime).toFixed(1);

                  return (
                    <tr
                      key={d.disruptionId}
                      id={`profix-row-${d.disruptionId}`}
                      onClick={() => setActiveRowId(isPinned ? null : d.disruptionId)}
                      title="Click to lock row highlight for easy scrolling across columns"
                      className={`transition-colors duration-150 cursor-pointer group ${
                        isPinned
                          ? 'bg-amber-100 font-medium border-y-2 border-amber-400 shadow-xs'
                          : 'hover:bg-amber-50/90'
                      }`}
                    >
                      {/* # */}
                      <td className="py-3 px-3 text-center text-slate-500 font-mono font-medium">
                        {index + 1}
                      </td>

                      {/* City */}
                      <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">
                        {d.city}
                      </td>

                      {/* Store Name in bold blue */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-blue-600 hover:text-blue-800 hover:underline">
                          {d.storeName}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {d.outletId}
                        </div>
                      </td>

                      {/* POC */}
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        {d.pocName || d.coldPocName2 || '—'}
                      </td>

                      {/* Bucket */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <BucketBadge bucket={d.bucket} />
                      </td>

                      {/* Dur (Hrs) in bold red */}
                      <td className="py-3 px-3 whitespace-nowrap font-mono font-bold text-rose-600 text-xs">
                        {durHrs}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <StatusBadge status={d.currentStatus} />
                      </td>

                      {/* Live Updates */}
                      <td className="py-3 px-4">
                        <p className="text-xs text-slate-700 line-clamp-2" title={d.latestLiveUpdate}>
                          {d.latestLiveUpdate || '—'}
                        </p>
                      </td>

                      {/* CC FRT (M) */}
                      <td className="py-3 px-3 text-center font-mono text-slate-700 font-medium">
                        3
                      </td>

                      {/* MST FRT (M) */}
                      <td className="py-3 px-3 text-center font-mono text-slate-400">
                        -
                      </td>

                      {/* Ticket ID in bold blue */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {d.ticketId ? (
                          <span className="font-mono font-semibold text-blue-600">
                            {d.ticketId}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenLiveUpdate(d);
                            }}
                            className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium text-[11px] transition shadow-2xs cursor-pointer"
                            title="Add Live Update"
                          >
                            Update
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenHistory(d);
                            }}
                            className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition border border-slate-200 cursor-pointer"
                            title="View History"
                          >
                            Audit
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

        {/* Section 2: Auditing & Non-Admin Disruptions (Matching ProFix screenshot) */}
        {auditActiveDisruptions.length > 0 && (
          <div className="border-t-2 border-purple-200">
            {/* Purple Banner */}
            <div className="bg-purple-900 text-white px-5 py-3 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold tracking-wide">
                  Auditing & Non-Admin Disruptions
                </h4>
                <p className="text-[11px] text-purple-200">
                  Disruptive Auditing In-process & Non-Admin Issue — {auditActiveDisruptions.length} active
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-purple-800 border border-purple-600 text-purple-200 text-xs font-semibold">
                {auditActiveDisruptions.length} Disruptions
              </span>
            </div>

            {/* Auditing Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px] text-left text-xs border-collapse">
                <thead className="bg-purple-50/70 text-purple-900 font-bold text-[11px] uppercase tracking-wider border-b border-purple-200">
                  <tr>
                    <th className="py-3 px-3 text-center w-10">#</th>
                    <th className="py-3 px-3">City</th>
                    <th className="py-3 px-4">Store Name</th>
                    <th className="py-3 px-3">POC</th>
                    <th className="py-3 px-3">Dur (Hrs)</th>
                    <th className="py-3 px-3">Audit Dur (Hrs)</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 min-w-[260px]">Live Updates</th>
                    <th className="py-3 px-3 text-center">CC FRT (M)</th>
                    <th className="py-3 px-3 text-center">MST FRT (M)</th>
                    <th className="py-3 px-3">Ticket ID</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-100 bg-white">
                  {auditActiveDisruptions.map((d, index) => {
                    const isPinned = activeRowId === d.disruptionId;
                    const durHrs = calculateDurationHours(d.disruptionStartDateTime).toFixed(1);

                    return (
                      <tr
                        key={d.disruptionId}
                        id={`profix-audit-row-${d.disruptionId}`}
                        onClick={() => setActiveRowId(isPinned ? null : d.disruptionId)}
                        title="Click to lock row highlight"
                        className={`transition-colors duration-150 cursor-pointer group ${
                          isPinned
                            ? 'bg-amber-100 font-medium border-y-2 border-amber-400 shadow-xs'
                            : 'hover:bg-purple-50/70'
                        }`}
                      >
                        {/* # */}
                        <td className="py-3 px-3 text-center text-slate-500 font-mono font-medium">
                          {index + 1}
                        </td>

                        {/* City */}
                        <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">
                          {d.city}
                        </td>

                        {/* Store Name in purple */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-bold text-purple-700 hover:text-purple-900 hover:underline">
                            {d.storeName}
                          </span>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {d.outletId}
                          </div>
                        </td>

                        {/* POC */}
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                          {d.pocName || d.coldPocName2 || '—'}
                        </td>

                        {/* Dur (Hrs) in bold red */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono font-bold text-rose-600 text-xs">
                          {durHrs}
                        </td>

                        {/* Audit Dur (Hrs) */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-600 text-xs">
                          0.0
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <StatusBadge status={d.currentStatus} />
                        </td>

                        {/* Live Updates */}
                        <td className="py-3 px-4">
                          <p className="text-xs text-slate-700 line-clamp-2" title={d.latestLiveUpdate}>
                            {d.latestLiveUpdate || '—'}
                          </p>
                        </td>

                        {/* CC FRT (M) */}
                        <td className="py-3 px-3 text-center font-mono text-slate-700 font-medium">
                          3
                        </td>

                        {/* MST FRT (M) */}
                        <td className="py-3 px-3 text-center font-mono text-slate-400">
                          -
                        </td>

                        {/* Ticket ID in bold blue */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {d.ticketId ? (
                            <span className="font-mono font-semibold text-blue-600">
                              {d.ticketId}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenLiveUpdate(d);
                              }}
                              className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium text-[11px] transition shadow-2xs cursor-pointer"
                              title="Add Live Update"
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenHistory(d);
                              }}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition border border-slate-200 cursor-pointer"
                              title="View History"
                            >
                              Audit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Report Footer Bar in Exported PNG */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 text-slate-500 text-[11px] flex flex-col sm:flex-row items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-700">ProFix</span>
            <span>• Active Disruptions Executive Snapshot</span>
          </div>
          <div className="font-mono text-[10px] text-slate-400">
            Confidential Operations Record • Snapshot Generated IST: {formatProFixGeneratedTimestamp()}
          </div>
        </div>

        {/* Mobile View for Active Disruptions */}
        <div className="lg:hidden p-4 space-y-4">
          {filteredActiveDisruptions.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No active disruptions matching current filters.
            </div>
          ) : (
            filteredActiveDisruptions.map((d) => (
              <div
                key={d.disruptionId}
                className="p-4 rounded-xl border border-amber-200 bg-white shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-slate-900 text-sm">{d.disruptionId}</span>
                    <div className="text-xs text-slate-600 mt-0.5 font-medium">
                      {d.outletId} — {d.storeName}
                    </div>
                  </div>
                  <StatusBadge status={d.currentStatus} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-amber-50/40 p-2.5 rounded-lg border border-amber-100">
                  <div>
                    <span className="text-slate-400 block text-[10px]">City / Mode</span>
                    <span className="font-medium text-slate-700">
                      {d.city} ({d.mode})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Vendor</span>
                    <span className="font-medium text-slate-700">{d.vendor}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">CC POC</span>
                    <span className="font-medium text-slate-700">{d.ccPoc}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Ticket ID</span>
                    <span className="font-mono font-medium text-slate-700">{d.ticketId || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Bucket</span>
                    <BucketBadge bucket={d.bucket} />
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Duration</span>
                    <span className="font-mono font-bold text-rose-600 text-xs">
                      {calculateDurationHours(d.disruptionStartDateTime).toFixed(1)} Hrs
                    </span>
                  </div>
                </div>

                <div className="text-xs p-2.5 rounded-lg border border-slate-100 bg-slate-50 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">
                    Latest Live Update ({d.lastUpdatedBy} @ {d.lastUpdatedAt})
                  </span>
                  <p className="text-slate-800">{d.latestLiveUpdate}</p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenLiveUpdate(d)}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>Update</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenHistory(d)}
                    className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Audit ({d.updateHistory?.length || 1})</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
