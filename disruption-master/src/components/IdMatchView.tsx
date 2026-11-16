import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Unlink,
  Search,
  Info,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Ticket,
  Clock,
  Wand2,
} from 'lucide-react';
import { Disruption, IdAlignMode, IdMatchReport, SHEET_SOURCE_LABELS } from '../types';
import { buildIdMatchRows, IdMatchRow, summariseIdMatch } from '../utils/idMatch';
import { describeMinuteGap } from '../utils/idAlignment';
import { alignDisruptionId, fetchIdMatchReport, triggerSyncNow } from '../services/api';
import { BrandMark } from './BrandMark';

interface IdMatchViewProps {
  disruptions: Disruption[];
  isOwner: boolean;
  /** Reloads the disruption list after an ID has been changed. */
  onRefresh: () => Promise<void> | void;
}

/**
 * Where the sheet's Disruption IDs and this console's disagree.
 *
 * A Disruption ID is generated, not typed: OUTLETID-YYMMDDHHMM, from the outlet
 * and the minute the disruption started. The timings sheet and the ticket sheet
 * both find a record by that ID, so when the minute someone entered here is even
 * one digit off the minute the sheet recorded, the IDs differ, the lookup misses
 * and every end time and ticket state on that row is dropped. Silently - both
 * feeds skip a row they cannot place and report success for the rest.
 *
 * This page is the other half of that: the rows that were skipped, the outlet
 * and minute each sheet ID is asking for, and the records here that are close
 * enough to be the same incident. Fixing one moves the record's start to the
 * minute the sheet has and regenerates the ID from it, so the two agree because
 * they are derived the same way, not because a label was overwritten.
 *
 * Owner-only, in the header and on the server both. It rewrites the key other
 * records and both sheets join on.
 */
export const IdMatchView: React.FC<IdMatchViewProps> = ({ disruptions, isOwner, onRefresh }) => {
  const [report, setReport] = useState<IdMatchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchIdMatchReport();
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the ID match report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) {
      setLoading(false);
      return;
    }
    void load();
  }, [isOwner, load]);

  const recheck = async () => {
    setRechecking(true);
    setNotice(null);
    try {
      // Re-running the feeds is what regenerates the list: the server only
      // learns which IDs a sheet carries while it is reading that sheet.
      const result = await triggerSyncNow();
      await load();
      await onRefresh();
      setNotice(
        result.success
          ? 'Sheets re-read. The list below is what the latest run could not place.'
          : `Sheets re-read, but at least one feed failed: ${result.error || 'see the sync status in the header'}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not re-read the sheets.');
    } finally {
      setRechecking(false);
    }
  };

  const allRows = useMemo(
    () => buildIdMatchRows(report?.rows ?? [], disruptions),
    [report, disruptions]
  );

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) =>
      [r.sheetDisruptionId, r.outletId, r.ticketId, r.ticketStatus, r.sheetDate]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [allRows, searchQuery]);

  const summary = useMemo(() => summariseIdMatch(allRows), [allRows]);

  const applyFix = async (row: IdMatchRow, record: Disruption, mode: IdAlignMode) => {
    const key = `${row.key}|${record.disruptionId}|${mode}`;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const result = await alignDisruptionId(record.disruptionId, row.sheetDisruptionId, mode);
      setNotice(result.message);
      setExpanded(null);
      await onRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the Disruption ID.');
    } finally {
      setBusyKey(null);
    }
  };

  if (!isOwner) {
    return (
      <div id="id-match-page" className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center">
        <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-700">Owner only</h2>
        <p className="text-sm text-slate-500 mt-1">
          This page rewrites the Disruption ID that both sheets join on, so it stays with the owner account.
        </p>
      </div>
    );
  }

  const neverChecked = !report || report.lastCheckedAt === null;

  return (
    <div id="id-match-page" className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Title bar */}
        <div className="bg-slate-800 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-600/20 border border-rose-500/40 flex items-center justify-center shrink-0">
              <Unlink className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Sheet ID Match</h2>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-200 text-[10px] font-bold uppercase tracking-wider">
                  Owner only
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Disruption IDs the sheets use that no record here answers to — and the records they were meant for.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3" data-export-exclude="true">
            <BrandMark size="sm" />
            <button
              id="id-match-recheck"
              type="button"
              onClick={recheck}
              disabled={rechecking}
              className="px-3.5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-xs transition flex items-center gap-1.5"
              title="Re-read every sheet and rebuild this list"
            >
              <RefreshCw className={`w-4 h-4 ${rechecking ? 'animate-spin' : ''}`} />
              <span>{rechecking ? 'Re-reading sheets…' : 'Re-check now'}</span>
            </button>
          </div>
        </div>

        {/* What this page is. The mechanism is the whole point: without it the
            list looks like a list of typos rather than a list of dropped data. */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 leading-relaxed">
            A Disruption ID is built as{' '}
            <strong className="font-semibold font-mono">OUTLETID-YYMMDDHHMM</strong> — the outlet, then the
            minute the disruption started. The Disruption Timings and Ticket Status sheets look a record up by
            that ID, so if the start minute entered here differs from the one in the sheet, the IDs differ and{' '}
            <strong className="font-semibold">that row's end time and ticket are dropped without a word</strong>.
            Fixing a row below moves the record's start to the minute the sheet has and regenerates its ID, so
            both sides compute the same string from then on.
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 p-5 bg-slate-50 border-b border-slate-200">
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-rose-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Unmatched IDs</span>
            <div id="id-match-total" className="text-4xl font-black text-rose-600 my-1 font-mono">
              {summary.total}
            </div>
            <span className="text-[11px] text-slate-500">in the last sheet read</span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-emerald-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Likely Match Here</span>
            <div id="id-match-fixable" className="text-4xl font-black text-emerald-600 my-1 font-mono">
              {summary.withCandidate}
            </div>
            <span className="text-[11px] text-slate-500">same outlet, a record to point at</span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-amber-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">No Record Found</span>
            <div className="text-4xl font-black text-amber-600 my-1 font-mono">{summary.withoutCandidate}</div>
            <span className="text-[11px] text-slate-500">outlet never logged here</span>
          </div>
          <div className="bg-white rounded-xl border-x border-b border-slate-200 border-t-4 border-t-blue-500 p-3.5 text-center">
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase block">Last Sheet Read</span>
            <div className="text-base font-black text-blue-700 my-2 font-mono">
              {report?.lastCheckedAt || 'not since restart'}
            </div>
            <span className="text-[11px] text-slate-500">
              {summary.byFeed.disruptionTimings} timings · {summary.byFeed.tickets} ticket
            </span>
          </div>
        </div>

        {/* A list that is empty because nothing has been read is not a clean
            bill of health, and must not be allowed to look like one. */}
        {neverChecked && (
          <div
            id="id-match-never-checked"
            className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-700 leading-relaxed">
              No sheet has been read since the server last restarted, so there is nothing to compare yet — an
              empty list below does <strong className="font-semibold">not</strong> mean the IDs agree. Press{' '}
              <strong className="font-semibold">Re-check now</strong> to read the sheets and build the list.
            </p>
          </div>
        )}

        {notice && (
          <div id="id-match-notice" className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 flex items-start gap-2">
            <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-700 leading-relaxed">{notice}</p>
          </div>
        )}

        {error && (
          <div id="id-match-error" className="px-6 py-3 bg-rose-50 border-b border-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <p className="text-xs text-rose-800 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Search */}
        <div className="px-6 py-3 border-b border-slate-200">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="id-match-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sheet ID, outlet, ticket or date"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />
          </div>
        </div>

        {/* The list */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 border-b border-slate-200">
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3">Sheet Disruption ID</th>
                <th className="px-4 py-3">Feed</th>
                <th className="px-4 py-3">Outlet</th>
                <th className="px-4 py-3">Start the sheet expects</th>
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">End time in sheet</th>
                <th className="px-4 py-3">Closest record here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Reading the report…
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-700">
                      {neverChecked
                        ? 'Nothing read yet'
                        : allRows.length === 0
                        ? 'Every sheet ID matched a record here'
                        : 'No unmatched ID matches that search'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {neverChecked
                        ? 'Press Re-check now to read the sheets.'
                        : allRows.length === 0
                        ? 'The timings and ticket feeds placed every row they carried.'
                        : 'Clear the search to see all of them.'}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((row) => {
                  const isOpen = expanded === row.key;
                  const closest = row.candidates[0];
                  return (
                    <React.Fragment key={row.key}>
                      <tr
                        id={`id-match-row-${row.sheetDisruptionId}`}
                        className={`transition-colors ${isOpen ? 'bg-rose-50/60' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : row.key)}
                            className="p-1 rounded hover:bg-slate-200 text-slate-500"
                            title={isOpen ? 'Hide the records for this outlet' : 'Show the records for this outlet'}
                            aria-expanded={isOpen}
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {row.sheetDisruptionId}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              row.feed === 'tickets'
                                ? 'bg-indigo-100 text-indigo-700'
                                : 'bg-teal-100 text-teal-700'
                            }`}
                          >
                            {row.feedLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">{row.outletId || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.sheetDate ? (
                            <span className="font-mono text-slate-700">
                              {row.sheetDate} {row.sheetTime.slice(0, 5)}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-700">ID carries no start minute</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.ticketId ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-700">
                              <Ticket className="w-3.5 h-3.5 text-indigo-500" />
                              {row.ticketId}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {row.endTime || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {closest ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-mono text-xs text-slate-700">
                                {closest.disruption.disruptionId}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  closest.minuteGap !== null && Math.abs(closest.minuteGap) <= 120
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-amber-100 text-amber-700'
                                }`}
                              >
                                {describeMinuteGap(closest.minuteGap)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-amber-700">
                              no record for outlet {row.outletId || '—'}
                            </span>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-6 py-4">
                            {row.candidates.length === 0 ? (
                              <p className="text-xs text-slate-600">
                                Nothing has ever been logged here for outlet{' '}
                                <strong className="font-mono">{row.outletId || '—'}</strong>. Either the sheet row
                                belongs to another team, or the disruption was never entered in this console — in
                                which case the row below is a record to create, not an ID to fix.
                              </p>
                            ) : (
                              <>
                                <p className="text-xs text-slate-600 mb-3">
                                  Records logged here for outlet{' '}
                                  <strong className="font-mono">{row.outletId}</strong>, nearest start first. Picking
                                  one sets its start to{' '}
                                  <strong className="font-mono">
                                    {row.sheetDate ? `${row.sheetDate} ${row.sheetTime.slice(0, 5)}` : 'the sheet value'}
                                  </strong>{' '}
                                  and regenerates its ID as{' '}
                                  <strong className="font-mono">{row.sheetDisruptionId}</strong>.
                                </p>
                                <div className="space-y-2">
                                  {row.candidates.map((candidate) => {
                                    const d = candidate.disruption;
                                    const alignKey = `${row.key}|${d.disruptionId}|align`;
                                    const idOnlyKey = `${row.key}|${d.disruptionId}|idOnly`;
                                    const anyBusy = busyKey !== null;
                                    return (
                                      <div
                                        key={d.disruptionId}
                                        className="bg-white rounded-lg border border-slate-200 px-3.5 py-3 flex flex-col lg:flex-row lg:items-center gap-3"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono font-bold text-sm text-slate-800">
                                              {d.disruptionId}
                                            </span>
                                            <span
                                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                candidate.sameDay
                                                  ? 'bg-emerald-100 text-emerald-700'
                                                  : 'bg-slate-100 text-slate-600'
                                              }`}
                                            >
                                              {candidate.sameDay ? 'same day' : 'different day'}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                                              {d.currentStatus}
                                            </span>
                                          </div>
                                          <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                                            <span className="inline-flex items-center gap-1">
                                              <Clock className="w-3.5 h-3.5" />
                                              starts {d.disruptionStartDate} {(d.disruptionStartTime || '').slice(0, 5)}
                                            </span>
                                            <span className="font-semibold text-slate-600">
                                              {describeMinuteGap(candidate.minuteGap)}
                                            </span>
                                            {d.ticketId && (
                                              <span className="font-mono">ticket {d.ticketId}</span>
                                            )}
                                            {d.storeName && <span className="truncate">{d.storeName}</span>}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                          <button
                                            id={`id-match-align-${d.disruptionId}`}
                                            type="button"
                                            disabled={anyBusy || !row.sheetDate}
                                            onClick={() => applyFix(row, d, 'align')}
                                            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition flex items-center gap-1.5"
                                            title={
                                              row.sheetDate
                                                ? `Move this record's start to ${row.sheetDate} ${row.sheetTime.slice(0, 5)} and regenerate its ID as ${row.sheetDisruptionId}`
                                                : 'This sheet ID carries no start minute, so there is nothing to align to'
                                            }
                                          >
                                            <Wand2 className="w-3.5 h-3.5" />
                                            <span>{busyKey === alignKey ? 'Fixing…' : 'Fix start + ID'}</span>
                                          </button>
                                          <button
                                            id={`id-match-idonly-${d.disruptionId}`}
                                            type="button"
                                            disabled={anyBusy}
                                            onClick={() => applyFix(row, d, 'idOnly')}
                                            className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold text-xs transition border border-slate-200"
                                            title="Change the ID only and leave this record's start time as it is"
                                          >
                                            {busyKey === idOnlyKey ? 'Saving…' : 'ID only'}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-3">
                                  <strong className="font-semibold">Fix start + ID</strong> is the one to use: it
                                  corrects the start the duration and TAT are measured from, and the matching ID
                                  falls out of that.{' '}
                                  <strong className="font-semibold">ID only</strong> leaves the start as it is, so
                                  the record will keep reporting the old duration — use it only when the sheet's
                                  start is the wrong one.
                                </p>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
          Reading {SHEET_SOURCE_LABELS.disruptionTimings} and {SHEET_SOURCE_LABELS.tickets}. The list is rebuilt
          every time a feed runs and is not kept across a restart, so it always describes the latest read.
        </div>
      </div>
    </div>
  );
};
