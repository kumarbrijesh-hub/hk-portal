/**
 * Weekly disruption count per store.
 *
 * One row per outlet, one column per ISO week, and the cell is simply how many
 * disruptions that store had that week - three in a week reads as 3. The point
 * is to see at a glance which store keeps breaking and in which weeks, so the
 * shading runs on a single hue from light to dark with count, and the number
 * itself is always present for anyone who cannot read the shades apart.
 */

import React, { useMemo, useState } from 'react';
import { CalendarRange, Download, Image as ImageIcon, Search, X, Check } from 'lucide-react';
import { Disruption } from '../types';
import { getReportFileTimestamp, formatReportGeneratedTimestamp } from '../utils/dateUtils';
import { currentWeekIndex, isoWeekOfIndex, weekIndexOf } from '../utils/repeatOffender';
import { exportActiveReportToPNG } from '../utils/reportExport';

/**
 * How many weeks of history the grid shows, newest first. Ten covers the recent
 * picture; the longer spans exist because back-filled history can run months
 * back, and a fixed ten-week window would hide it entirely.
 */
const WEEK_SPAN_OPTIONS = [10, 20, 30, 52] as const;
const DEFAULT_WEEKS_SHOWN = 10;

const REPORT_ELEMENT_ID = 'weekly-disruption-report';

interface WeeklyDisruptionReportProps {
  disruptions: Disruption[];
}

interface OutletRow {
  outletId: string;
  storeName: string;
  city: string;
  /** Count per week index, keyed by the same indices as `weekColumns`. */
  counts: Map<number, number>;
  total: number;
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Single-hue ramp, light to dark with the count. Zero stays unshaded so a busy
 * week stands out against the empty ones rather than against a wall of colour.
 */
function cellTone(count: number): string {
  if (count <= 0) return 'text-slate-300';
  if (count === 1) return 'bg-rose-50 text-rose-900';
  if (count === 2) return 'bg-rose-100 text-rose-900';
  if (count === 3) return 'bg-rose-200 text-rose-950';
  if (count <= 5) return 'bg-rose-300 text-rose-950';
  return 'bg-rose-400 text-white';
}

export const WeeklyDisruptionReport: React.FC<WeeklyDisruptionReportProps> = ({ disruptions }) => {
  const [weeksShown, setWeeksShown] = useState<number>(DEFAULT_WEEKS_SHOWN);
  const [outletSearch, setOutletSearch] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<Set<string>>(new Set());
  const [isGeneratingPng, setIsGeneratingPng] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  /** Newest week first, which is the order the printed report uses. */
  const weekColumns = useMemo(() => {
    const now = currentWeekIndex();
    return Array.from({ length: weeksShown }, (_, i) => now - i);
  }, [weeksShown]);

  const oldestWeekShown = weekColumns[weekColumns.length - 1];

  /** Every outlet that appears in the window, with its per-week counts. */
  const allRows = useMemo<OutletRow[]>(() => {
    const byOutlet = new Map<string, OutletRow>();

    for (const d of disruptions) {
      const outletId = (d.outletId || '').trim();
      if (!outletId) continue;
      const week = weekIndexOf(d.disruptionStartDateTime);
      if (week === null || week < oldestWeekShown || week > weekColumns[0]) continue;

      let row = byOutlet.get(outletId);
      if (!row) {
        row = { outletId, storeName: d.storeName || '', city: d.city || '', counts: new Map(), total: 0 };
        byOutlet.set(outletId, row);
      }
      // A later record carries the newer store name, which is the one to show.
      if (d.storeName) row.storeName = d.storeName;
      if (d.city) row.city = d.city;
      row.counts.set(week, (row.counts.get(week) ?? 0) + 1);
      row.total += 1;
    }

    return Array.from(byOutlet.values()).sort(
      (a, b) => b.total - a.total || a.outletId.localeCompare(b.outletId)
    );
  }, [disruptions, oldestWeekShown, weekColumns]);

  /** Outlets offered in the picker, narrowed by what has been typed. */
  const pickerOptions = useMemo(() => {
    const q = outletSearch.trim().toLowerCase();
    if (!q) return allRows.slice(0, 40);
    return allRows
      .filter(
        (r) =>
          r.outletId.toLowerCase().includes(q) ||
          r.storeName.toLowerCase().includes(q) ||
          r.city.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [allRows, outletSearch]);

  const rows = useMemo(
    () => (selectedOutlets.size === 0 ? allRows : allRows.filter((r) => selectedOutlets.has(r.outletId))),
    [allRows, selectedOutlets]
  );

  const weekTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const w of weekColumns) {
      totals.set(
        w,
        rows.reduce((sum, r) => sum + (r.counts.get(w) ?? 0), 0)
      );
    }
    return totals;
  }, [rows, weekColumns]);

  const grandTotal = useMemo(() => rows.reduce((sum, r) => sum + r.total, 0), [rows]);

  const toggleOutlet = (outletId: string) => {
    setSelectedOutlets((prev) => {
      const next = new Set(prev);
      if (next.has(outletId)) next.delete(outletId);
      else next.add(outletId);
      return next;
    });
  };

  const note = (text: string) => {
    setExportNote(text);
    setTimeout(() => setExportNote(null), 4000);
  };

  const downloadCsv = () => {
    const header = [
      'Outlet ID',
      'Store Name',
      'City',
      ...weekColumns.map((w) => `W${isoWeekOfIndex(w).week}`),
      'Total',
    ];
    const body = rows.map((r) => [
      csvCell(r.outletId),
      csvCell(r.storeName),
      csvCell(r.city),
      ...weekColumns.map((w) => csvCell(r.counts.get(w) ?? 0)),
      csvCell(r.total),
    ]);
    const csv = [header.map(csvCell).join(','), ...body.map((cells) => cells.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Weekly_Disruption_Count_${getReportFileTimestamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    note('CSV downloaded.');
  };

  const downloadPng = async () => {
    setIsGeneratingPng(true);
    try {
      await exportActiveReportToPNG(
        REPORT_ELEMENT_ID,
        `Weekly_Disruption_Count_${getReportFileTimestamp()}.png`
      );
      note('PNG downloaded.');
    } catch (err: any) {
      note(err?.message || 'Could not generate the PNG.');
    } finally {
      setIsGeneratingPng(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar, in one row above the grid */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Weekly Disruption Count
            </h2>
            <span className="text-xs text-slate-500">Newest week first</span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="weekly-span" className="text-[11px] text-slate-500">
              Show
            </label>
            <select
              id="weekly-span"
              value={weeksShown}
              onChange={(e) => setWeeksShown(Number(e.target.value))}
              className="px-2 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-700"
            >
              {WEEK_SPAN_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n} weeks
                </option>
              ))}
            </select>
            {exportNote && <span className="text-xs font-medium text-emerald-700">{exportNote}</span>}
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={downloadPng}
              disabled={isGeneratingPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              {isGeneratingPng ? 'Generating...' : 'Download PNG'}
            </button>
          </div>
        </div>

        {/* Multi-select on outlet: pick a set of stores and the grid narrows to them */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="weekly-outlet-search" className="text-xs font-semibold text-slate-700">
              Filter by Outlet ID <span className="font-normal text-slate-400">(pick as many as you need)</span>
            </label>
            {selectedOutlets.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedOutlets(new Set())}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Clear {selectedOutlets.size} selected
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="weekly-outlet-search"
              type="text"
              value={outletSearch}
              onChange={(e) => setOutletSearch(e.target.value)}
              placeholder="Search outlet ID, store name or city..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>

          {selectedOutlets.size > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Array.from(selectedOutlets).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleOutlet(id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-900 text-white"
                  title="Remove from filter"
                >
                  {id}
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}

          {outletSearch.trim() !== '' && (
            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {pickerOptions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">No outlet matches that search.</p>
              ) : (
                pickerOptions.map((o) => {
                  const picked = selectedOutlets.has(o.outletId);
                  return (
                    <button
                      key={o.outletId}
                      type="button"
                      onClick={() => toggleOutlet(o.outletId)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${
                        picked ? 'bg-slate-50' : ''
                      }`}
                    >
                      <span>
                        <span className="font-mono font-semibold text-slate-800">{o.outletId}</span>
                        <span className="text-slate-500"> — {o.storeName || 'Unnamed'}, {o.city || '—'}</span>
                      </span>
                      {picked && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* The grid itself. Wrapped in the report element so the PNG matches. */}
      <div id={REPORT_ELEMENT_ID} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Disruption Count by Store and Week</h3>
            <p className="text-[11px] text-slate-500">
              {rows.length} store{rows.length === 1 ? '' : 's'} · {grandTotal} disruption
              {grandTotal === 1 ? '' : 's'}
              {selectedOutlets.size > 0 && ` · filtered to ${selectedOutlets.size} outlet${selectedOutlets.size === 1 ? '' : 's'}`}
            </p>
          </div>
          <p className="text-[11px] text-slate-400">{formatReportGeneratedTimestamp()}</p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            No disruptions recorded in the last {weeksShown} weeks
            {selectedOutlets.size > 0 ? ' for the selected outlets' : ''}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900 text-white text-left">
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap sticky left-0 bg-slate-900">
                    Outlet ID
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Store Name</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">City</th>
                  {weekColumns.map((w) => (
                    <th key={w} className="py-2.5 px-2 font-semibold text-center whitespace-nowrap">
                      {isoWeekOfIndex(w).week}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap bg-slate-800">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.outletId} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap sticky left-0 bg-white">
                      {r.outletId}
                    </td>
                    <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{r.storeName || '—'}</td>
                    <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.city || '—'}</td>
                    {weekColumns.map((w) => {
                      const count = r.counts.get(w) ?? 0;
                      return (
                        <td
                          key={w}
                          className={`py-2 px-2 text-center font-semibold tabular-nums ${cellTone(count)}`}
                        >
                          {count}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-center font-bold text-slate-900 tabular-nums bg-slate-50">
                      {r.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold text-slate-900">
                  <td className="py-2.5 px-3 sticky left-0 bg-slate-100" colSpan={3}>
                    All selected stores
                  </td>
                  {weekColumns.map((w) => (
                    <td key={w} className="py-2.5 px-2 text-center tabular-nums">
                      {weekTotals.get(w) ?? 0}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-center tabular-nums bg-slate-200">{grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Identity is never carried by colour alone: every cell prints its count,
            and this says what the shading means. */}
        <div className="px-4 py-2.5 border-t border-slate-200 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">Shading:</span>
          {[
            { label: '0', count: 0 },
            { label: '1', count: 1 },
            { label: '2', count: 2 },
            { label: '3', count: 3 },
            { label: '4-5', count: 4 },
            { label: '6+', count: 6 },
          ].map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span
                className={`inline-block w-5 h-4 rounded border border-slate-200 text-center leading-4 font-semibold ${cellTone(
                  s.count
                )}`}
              />
              {s.label}
            </span>
          ))}
          <span className="ml-auto">Column headings are ISO week numbers.</span>
        </div>
      </div>
    </div>
  );
};
