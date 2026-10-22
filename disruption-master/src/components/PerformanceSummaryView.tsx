import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Download,
  Filter,
  Store,
  Timer,
  TrendingDown,
  TrendingUp,
  Minus,
  X,
  Image as ImageIcon,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import { Disruption } from '../types';
import {
  buildPerformanceSummary,
  parseOutletFilter,
  DailySummary,
} from '../utils/performanceSummary';
import { TrendChart } from './TrendChart';
import { exportActiveReportToPNG } from '../utils/reportExport';
import { formatReportGeneratedTimestamp, getReportFileTimestamp } from '../utils/dateUtils';

/**
 * Date-wise performance view.
 *
 * Built for two audiences: the ops team checking whether closures are getting
 * faster, and a management readout, which is why the whole thing exports as one
 * image and as a spreadsheet.
 */

// Categorical slots 1 and 2 from the validated palette. Verified with the
// palette validator against a white surface: CVD ΔE 24.7, normal-vision 33.6.
const SERIES_BLUE = '#2a78d6';
const SERIES_ORANGE = '#eb6834';

const REPORT_ELEMENT_ID = 'performance-summary-report';

interface PerformanceSummaryViewProps {
  disruptions: Disruption[];
}

/** Headline figure with an optional direction indicator. */
const StatTile: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent: string;
}> = ({ label, value, hint, icon, accent }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4">
    <div className="flex items-center gap-2 text-slate-500">
      <span className={accent}>{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
    </div>
    <div className="mt-2 text-3xl font-black text-slate-900 tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
  </div>
);

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export const PerformanceSummaryView: React.FC<PerformanceSummaryViewProps> = ({ disruptions }) => {
  const [outletInput, setOutletInput] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isGeneratingPng, setIsGeneratingPng] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const outletIds = useMemo(() => parseOutletFilter(outletInput), [outletInput]);

  const summary = useMemo(
    () => buildPerformanceSummary(disruptions, { outletIds, fromDate, toDate }),
    [disruptions, outletIds, fromDate, toDate]
  );

  const { days, totals, closureTrendDelta } = summary;

  const shortDates = useMemo(
    () => days.map((d) => d.displayDate.replace(/ \d{4}$/, '')),
    [days]
  );

  const filterDescription = useMemo(() => {
    const bits: string[] = [];
    if (outletIds.length) bits.push(`Outlets: ${outletIds.join(', ')}`);
    if (fromDate) bits.push(`From ${fromDate}`);
    if (toDate) bits.push(`To ${toDate}`);
    return bits.length ? bits.join(' · ') : 'All outlets, all dates';
  }, [outletIds, fromDate, toDate]);

  const handleDownloadPng = async () => {
    setIsGeneratingPng(true);
    setExportNote(null);
    try {
      await exportActiveReportToPNG(
        REPORT_ELEMENT_ID,
        `Performance_Summary_${getReportFileTimestamp()}.png`
      );
      setExportNote('PNG downloaded.');
    } catch (err: any) {
      setExportNote(err?.message || 'Could not generate the PNG.');
    } finally {
      setIsGeneratingPng(false);
      setTimeout(() => setExportNote(null), 4000);
    }
  };

  const handleDownloadCsv = () => {
    const header = [
      'Date',
      'Disruptions',
      'Unique Stores',
      'Breakdown',
      'Non Breakdown',
      'Closed',
      'Still Open',
      'Closed Downtime (Hrs)',
      'Mean Closure (Hrs)',
      'Longest Closure (Hrs)',
      'Open Elapsed (Hrs)',
    ];
    const rows = days.map((d) => [
      d.date,
      d.disruptionCount,
      d.uniqueStores,
      d.breakdownCount,
      d.nonBreakdownCount,
      d.closedCount,
      d.openCount,
      d.closedDowntimeHours,
      d.meanClosureHours,
      d.maxClosureHours,
      d.openElapsedHours,
    ]);

    const csv = [
      csvCell(`Performance Summary — generated ${formatReportGeneratedTimestamp()} IST`),
      csvCell(filterDescription),
      '',
      header.map(csvCell).join(','),
      ...rows.map((r) => r.map(csvCell).join(',')),
      '',
      [
        csvCell('TOTAL'),
        csvCell(totals.disruptionCount),
        csvCell(totals.uniqueStores),
        '',
        '',
        csvCell(totals.closedCount),
        csvCell(totals.openCount),
        csvCell(totals.closedDowntimeHours),
        csvCell(totals.meanClosureHours),
        '',
        '',
      ].join(','),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Performance_Summary_${getReportFileTimestamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    setExportNote('CSV downloaded.');
    setTimeout(() => setExportNote(null), 4000);
  };

  const trendLabel = (() => {
    if (closureTrendDelta === null) {
      return { text: 'Not enough closed data to compare', icon: <Minus className="w-4 h-4" />, tone: 'text-slate-400' };
    }
    if (closureTrendDelta < -0.05) {
      return {
        text: `Closures ${Math.abs(closureTrendDelta).toFixed(2)}h faster than earlier in the range`,
        icon: <TrendingDown className="w-4 h-4" />,
        tone: 'text-emerald-600',
      };
    }
    if (closureTrendDelta > 0.05) {
      return {
        text: `Closures ${closureTrendDelta.toFixed(2)}h slower than earlier in the range`,
        icon: <TrendingUp className="w-4 h-4" />,
        tone: 'text-rose-600',
      };
    }
    return { text: 'Closure time is holding steady', icon: <Minus className="w-4 h-4" />, tone: 'text-slate-500' };
  })();

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto">
      {/* Filters — one row above the charts */}
      <div className="bg-white rounded-xl border border-slate-200 p-4" data-export-exclude="true">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-900">Performance Summary Filters</h2>
          <span className="ml-auto text-[11px] text-slate-500">{filterDescription}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="md:col-span-2">
            <label htmlFor="summary-outlet-filter" className="block font-semibold text-slate-700 mb-1">
              Outlet IDs <span className="font-normal text-slate-400">(one or many — comma or space separated)</span>
            </label>
            <div className="relative">
              <Store className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                id="summary-outlet-filter"
                type="text"
                value={outletInput}
                onChange={(e) => setOutletInput(e.target.value)}
                placeholder="e.g. ES100, ES2, ES91"
                className="w-full pl-8 pr-8 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              />
              {outletInput && (
                <button
                  type="button"
                  onClick={() => setOutletInput('')}
                  title="Clear outlet filter"
                  className="absolute right-2 top-2 text-slate-400 hover:text-rose-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="summary-from-date" className="block font-semibold text-slate-700 mb-1">
              From Date
            </label>
            <input
              id="summary-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="summary-to-date" className="block font-semibold text-slate-700 mb-1">
              To Date
            </label>
            <input
              id="summary-to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={isGeneratingPng || days.length === 0}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            {isGeneratingPng ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5" />
            )}
            <span>{isGeneratingPng ? 'Generating...' : 'Download PNG'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={days.length === 0}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Download CSV</span>
          </button>

          {(outletInput || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setOutletInput('');
                setFromDate('');
                setToDate('');
              }}
              className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
            >
              Reset filters
            </button>
          )}

          {exportNote && <span className="text-[11px] text-slate-500">{exportNote}</span>}
        </div>
      </div>

      {/* Everything below is captured in the PNG export */}
      <div id={REPORT_ELEMENT_ID} className="space-y-5 bg-slate-50 p-5 rounded-xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-600" />
              Disruption Performance Summary
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {filterDescription} · Generated {formatReportGeneratedTimestamp()} IST
            </p>
          </div>
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${trendLabel.tone}`}>
            {trendLabel.icon}
            {trendLabel.text}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile
            label="Total Disruptions"
            value={String(totals.disruptionCount)}
            hint={`across ${totals.datesCovered} date${totals.datesCovered === 1 ? '' : 's'}`}
            icon={<BarChart3 className="w-4 h-4" />}
            accent="text-indigo-600"
          />
          <StatTile
            label="Unique Stores"
            value={String(totals.uniqueStores)}
            hint="distinct outlets affected"
            icon={<Store className="w-4 h-4" />}
            accent="text-blue-600"
          />
          <StatTile
            label="Closed Downtime"
            value={`${totals.closedDowntimeHours.toFixed(1)}h`}
            hint={`${totals.closedCount} closed record${totals.closedCount === 1 ? '' : 's'}`}
            icon={<Timer className="w-4 h-4" />}
            accent="text-amber-600"
          />
          <StatTile
            label="Mean Closure"
            value={totals.meanClosureHours === null ? '—' : `${totals.meanClosureHours.toFixed(2)}h`}
            hint="start to ticket closure"
            icon={<Timer className="w-4 h-4" />}
            accent="text-emerald-600"
          />
          <StatTile
            label="Still Open"
            value={String(totals.openCount)}
            hint="no closure recorded yet"
            icon={<CalendarRange className="w-4 h-4" />}
            accent="text-rose-600"
          />
        </div>

        {/* Charts — one measure per axis, never two scales on one plot */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TrendChart
            title="Downtime by date"
            subtitle="Hours from disruption start to ticket closure, closed records only"
            categories={shortDates}
            series={[
              {
                key: 'downtime',
                label: 'Closed downtime (hrs)',
                color: SERIES_BLUE,
                values: days.map((d) => d.closedDowntimeHours),
              },
            ]}
            formatValue={(n) => `${n.toFixed(1)}h`}
          />

          <TrendChart
            title="Disruptions and affected stores by date"
            subtitle="How many were raised, and how many distinct outlets they hit"
            categories={shortDates}
            series={[
              {
                key: 'count',
                label: 'Disruptions',
                color: SERIES_BLUE,
                values: days.map((d) => d.disruptionCount),
              },
              {
                key: 'stores',
                label: 'Unique stores',
                color: SERIES_ORANGE,
                values: days.map((d) => d.uniqueStores),
              },
            ]}
            formatValue={(n) => String(n)}
          />
        </div>

        <TrendChart
          title="Mean closure time by date"
          subtitle="Average hours to close a disruption raised on that date — lower is better"
          categories={shortDates}
          series={[
            {
              key: 'mttr',
              label: 'Mean closure (hrs)',
              color: SERIES_ORANGE,
              values: days.map((d) => d.meanClosureHours ?? 0),
            },
          ]}
          formatValue={(n) => `${n.toFixed(2)}h`}
          height={220}
        />

        {/* The table view — every value the charts show, readable without colour */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Date-wise detail</h3>
            <span className="text-[11px] text-slate-500">
              {days.length} date{days.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 font-bold text-[11px] uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3 text-center">Disruptions</th>
                  <th className="py-2.5 px-3 text-center">Unique Stores</th>
                  <th className="py-2.5 px-3 text-center">Breakdown</th>
                  <th className="py-2.5 px-3 text-center">Non Breakdown</th>
                  <th className="py-2.5 px-3 text-center">Closed</th>
                  <th className="py-2.5 px-3 text-center">Open</th>
                  <th className="py-2.5 px-3 text-right">Closed Downtime</th>
                  <th className="py-2.5 px-3 text-right">Mean Closure</th>
                  <th className="py-2.5 px-3 text-right">Longest Closure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {days.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      No disruptions match these filters.
                    </td>
                  </tr>
                ) : (
                  days.map((d: DailySummary) => (
                    <tr key={d.date} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                        {d.displayDate}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold">{d.disruptionCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{d.uniqueStores}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-rose-700">{d.breakdownCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-amber-700">{d.nonBreakdownCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-emerald-700">{d.closedCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-500">{d.openCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{d.closedDowntimeHours.toFixed(1)}h</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold">
                        {d.meanClosureHours === null ? '—' : `${d.meanClosureHours.toFixed(2)}h`}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {d.maxClosureHours === null ? '—' : `${d.maxClosureHours.toFixed(2)}h`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {days.length > 0 && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-300 font-bold">
                  <tr>
                    <td className="py-2.5 px-3 text-slate-900">Total</td>
                    <td className="py-2.5 px-3 text-center font-mono">{totals.disruptionCount}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{totals.uniqueStores}</td>
                    <td className="py-2.5 px-3" colSpan={2} />
                    <td className="py-2.5 px-3 text-center font-mono">{totals.closedCount}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{totals.openCount}</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {totals.closedDowntimeHours.toFixed(1)}h
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {totals.meanClosureHours === null ? '—' : `${totals.meanClosureHours.toFixed(2)}h`}
                    </td>
                    <td className="py-2.5 px-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
          <Download className="w-3 h-3" />
          Downtime is measured from the disruption start to the ticket closure time. Records with no closure yet are
          counted under &ldquo;Open&rdquo; and kept out of the downtime and mean-closure figures, so those numbers do
          not drift as the page is refreshed.
        </p>
      </div>
    </div>
  );
};
