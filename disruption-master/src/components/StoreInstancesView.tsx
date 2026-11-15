import React, { useMemo, useState } from 'react';
import {
  Store,
  Search,
  FileSpreadsheet,
  FileText,
  Repeat,
  Ticket,
  Info,
  CalendarRange,
} from 'lucide-react';
import { Disruption } from '../types';
import {
  buildStoreInstanceReport,
  hoursLabel,
  INSTANCE_WINDOW_OPTIONS,
  InstanceWindowMonths,
} from '../utils/ticketInstances';
import { exportStoreInstancesToCSV, exportStoreInstancesToExcel } from '../utils/reportExport';
import { formatReportGeneratedTimestamp } from '../utils/dateUtils';
import { BrandMark } from './BrandMark';

interface StoreInstancesViewProps {
  disruptions: Disruption[];
}

/**
 * How often a store has actually broken.
 *
 * The raw row count overstates it. One fault produces a row, then another when
 * the store auto-disables and comes back on the same ticket, then another. Four
 * rows on two tickets is two problems, not four, and a store ranked on rows
 * looks twice as bad as it is.
 *
 * So the number on this page counts tickets, not rows. A row carrying no ticket
 * cannot be grouped with anything, so it counts on its own and is reported
 * separately rather than being quietly folded in - that gap is a data-entry
 * problem worth seeing, not something to average away.
 */
export const StoreInstancesView: React.FC<StoreInstancesViewProps> = ({ disruptions }) => {
  const [months, setMonths] = useState<InstanceWindowMonths>(3);
  const [searchQuery, setSearchQuery] = useState('');

  const report = useMemo(() => buildStoreInstanceReport(disruptions, months), [disruptions, months]);

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return report.rows;
    return report.rows.filter((r) =>
      [r.outletId, r.storeName, r.city, r.vendor, ...r.tickets]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [report, searchQuery]);

  const windowLabel = `Last ${months} month${months === 1 ? '' : 's'}`;
  const filterNote = searchQuery.trim() ? `Search: ${searchQuery.trim()}` : undefined;

  return (
    <div id="store-instances-page" className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Title bar */}
        <div className="bg-slate-800 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <Store className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-wider text-white">Store Instances</h2>
              <p className="text-xs text-slate-400">
                Separate breakdowns per store, counted by unique Ticket ID — repeats on one ticket count once.
              </p>
            </div>
          </div>

          {/* Window selector */}
          <div className="flex items-center gap-2" data-export-exclude="true">
            <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase hidden sm:inline">
              Window
            </span>
            <div className="flex items-center gap-1 bg-slate-900/60 rounded-lg p-1 border border-slate-700">
              {INSTANCE_WINDOW_OPTIONS.map((option) => (
                <button
                  key={option}
                  id={`instance-window-${option}m`}
                  type="button"
                  onClick={() => setMonths(option)}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                    months === option
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {option}M
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* How the count works. Spelled out because "instances" is the whole
            point of the page and it is not the number people are used to. */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 leading-relaxed">
            An <strong className="font-semibold">instance</strong> is one Ticket ID. A store that went down, auto
            disabled and went down again on the same ticket is <strong className="font-semibold">one</strong>{' '}
            instance however many rows it produced. Four rows carrying two ticket IDs is two instances. A row with
            no Ticket ID cannot be grouped, so it counts on its own and is listed under{' '}
            <strong className="font-semibold">No Ticket</strong>.
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 p-5 bg-slate-50 border-b border-slate-200">
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-emerald-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Instances</span>
            <div className="text-4xl font-black text-emerald-600 my-1 font-mono">{report.totalInstances}</div>
            <span className="text-[11px] text-slate-500">{windowLabel}</span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-slate-400 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Disruption Rows</span>
            <div className="text-4xl font-black text-slate-700 my-1 font-mono">{report.totalRecords}</div>
            <span className="text-[11px] text-slate-500">
              {Math.max(0, report.totalRecords - report.totalInstances)} are repeats on a ticket
            </span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-amber-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Stores Affected</span>
            <div className="text-4xl font-black text-amber-600 my-1 font-mono">{report.rows.length}</div>
            <span className="text-[11px] text-slate-500">with at least one instance</span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-blue-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Counted From</span>
            <div className="text-xl font-black text-blue-700 my-2 font-mono">{report.fromLabel}</div>
            <span className="text-[11px] text-slate-500">
              {report.undatedRecords > 0
                ? `${report.undatedRecords} row(s) have no readable start time and are excluded`
                : 'every row has a readable start time'}
            </span>
          </div>
        </div>

        {/* Search + exports */}
        <div className="px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-200">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="store-instances-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search outlet, store, city, vendor or ticket"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2" data-export-exclude="true">
            <button
              id="download-instances-excel-btn"
              type="button"
              onClick={() => exportStoreInstancesToExcel(report, filterNote)}
              className="px-3.5 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition border border-slate-200 flex items-center gap-1.5"
              title="Download the instance report as Excel"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Excel</span>
            </button>
            <button
              id="download-instances-csv-btn"
              type="button"
              onClick={() => exportStoreInstancesToCSV(report, filterNote)}
              className="px-3.5 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition border border-slate-200 flex items-center gap-1.5"
              title="Download the instance report as CSV"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Report header line, carried into the export too. */}
        <div className="px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <BrandMark size="sm" />
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
            {windowLabel} · from {report.fromLabel} · generated {formatReportGeneratedTimestamp()}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-bold">#</th>
                <th className="px-4 py-3 text-left font-bold">Outlet</th>
                <th className="px-4 py-3 text-left font-bold">Store</th>
                <th className="px-4 py-3 text-left font-bold">City</th>
                <th className="px-4 py-3 text-left font-bold">Vendor</th>
                <th className="px-4 py-3 text-right font-bold">Instances</th>
                <th className="px-4 py-3 text-right font-bold">Rows</th>
                <th className="px-4 py-3 text-right font-bold">Unique Tickets</th>
                <th className="px-4 py-3 text-right font-bold">Repeats</th>
                <th className="px-4 py-3 text-right font-bold">No Ticket</th>
                <th className="px-4 py-3 text-right font-bold">Total Hrs</th>
                <th className="px-4 py-3 text-left font-bold">Last Disruption</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                    {report.rows.length === 0
                      ? `No disruption was logged in the last ${months} month${months === 1 ? '' : 's'}.`
                      : 'No store matches that search.'}
                  </td>
                </tr>
              )}

              {rows.map((r, i) => (
                <tr key={r.outletId} className="hover:bg-slate-50 align-top">
                  <td className="px-4 py-3 font-mono text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">{r.outletId}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700">{r.storeName || '—'}</div>
                    {r.tickets.length > 0 && (
                      <div
                        className="text-[11px] text-slate-400 font-mono mt-0.5 line-clamp-2"
                        title={r.tickets.join(', ')}
                      >
                        <Ticket className="w-3 h-3 inline mr-1 -mt-0.5" />
                        {r.tickets.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.city || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.vendor || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold">
                      {r.instances}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{r.records}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{r.uniqueTickets}</td>
                  <td className="px-4 py-3 text-right">
                    {r.repeatRecords > 0 ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-mono font-bold text-[11px]">
                        <Repeat className="w-3 h-3" />
                        {r.repeatRecords}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-mono">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.untaggedRecords > 0 ? (
                      <span className="font-mono font-bold text-rose-600">{r.untaggedRecords}</span>
                    ) : (
                      <span className="text-slate-400 font-mono">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                    {hoursLabel(r.totalHours) || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                    {r.lastDisruptionAt || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
