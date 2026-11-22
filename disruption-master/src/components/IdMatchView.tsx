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
  ArrowRight,
  Link2,
} from 'lucide-react';
import {
  Disruption,
  IdAlignMode,
  IdMatchReport,
  MatchedSheetId,
  SHEET_SOURCE_LABELS,
} from '../types';
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
 * Where the sheet's Disruption IDs and this console's agree, and where they do
 * not.
 *
 * A Disruption ID is generated, not typed: OUTLETID-YYMMDDHHMM, from the outlet
 * and the minute the disruption started. The timings sheet and the ticket sheet
 * both find a record by that ID, so when the minute someone entered here is even
 * one digit off the minute the sheet recorded, the IDs differ, the lookup misses
 * and every end time and ticket state on that row is dropped. Silently - both
 * feeds skip a row they cannot place and report success for the rest.
 *
 * The page used to list only the misses, and that was the thing that made it
 * confusing rather than useful: after uploading a sheet, a short list of
 * failures cannot tell you whether the other nine hundred rows landed or whether
 * the file was ignored wholesale. So both sides are here, as two tabs with their
 * counts on them - "these matched, these did not" - and the fix for a miss is on
 * the row itself rather than behind an expander.
 *
 * Owner-only, in the header and on the server both. It rewrites the key other
 * records and both sheets join on.
 */

/** A candidate this close is almost certainly the same incident typed twice. */
const CONFIDENT_GAP_MINUTES = 120;

type Tab = 'unmatched' | 'matched';

/** "2026-11-16" + "14:05:00" -> "16 Nov, 14:05", for reading at a glance. */
function prettyStart(date: string, time: string): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return `${date} ${time.slice(0, 5)}`.trim();
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return time ? `${label}, ${time.slice(0, 5)}` : label;
}

export const IdMatchView: React.FC<IdMatchViewProps> = ({ disruptions, isOwner, onRefresh }) => {
  const [report, setReport] = useState<IdMatchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<Tab>('unmatched');

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
      // Re-running the feeds is what regenerates both lists: the server only
      // learns which IDs a sheet carries while it is reading that sheet.
      const result = await triggerSyncNow();
      await load();
      await onRefresh();
      setNotice(
        result.success
          ? 'Sheets re-read. Both tabs below describe that run.'
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

  const q = searchQuery.trim().toLowerCase();

  const rows = useMemo(() => {
    if (!q) return allRows;
    return allRows.filter((r) =>
      [r.sheetDisruptionId, r.outletId, r.ticketId, r.ticketStatus, r.sheetDate]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [allRows, q]);

  const matchedRows: MatchedSheetId[] = useMemo(() => {
    const list = report?.matched ?? [];
    if (!q) return list;
    return list.filter((r) =>
      [r.sheetDisruptionId, r.disruptionId, r.outletId, r.storeName, r.city, r.ticketId]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [report, q]);

  const summary = useMemo(() => summariseIdMatch(allRows), [allRows]);

  /** Uncapped truth from the server, not the length of the displayed list. */
  const tally = report?.tally;
  const matchedCount =
    (tally?.disruptionTimings.matched ?? 0) + (tally?.tickets.matched ?? 0);
  const appliedCount = (tally?.disruptionTimings.applied ?? 0) + (tally?.tickets.applied ?? 0);
  const unmatchedCount = summary.total;
  const totalSeen = matchedCount + unmatchedCount;
  const matchRate = totalSeen > 0 ? Math.round((matchedCount / totalSeen) * 100) : null;

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
              <Link2 className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Sheet ID Match</h2>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-200 text-[10px] font-bold uppercase tracking-wider">
                  Owner only
                </span>
              </div>
              <p className="text-xs text-slate-400">
                After an upload: which sheet rows found their record here, and which did not.
              </p>
            </div>
          </div>

          {/* The brand mark used to sit here, in dark ink on the dark bar, where
              it was unreadable. Every other page puts it on a white strip, so
              this one does too - it is on the summary row below. */}
          <div className="flex items-center gap-3" data-export-exclude="true">
            <button
              id="id-match-recheck"
              type="button"
              onClick={recheck}
              disabled={rechecking}
              className="px-3.5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
              title="Re-read every sheet and rebuild both lists"
            >
              <RefreshCw className={`w-4 h-4 ${rechecking ? 'animate-spin' : ''}`} />
              <span>{rechecking ? 'Re-reading sheets…' : 'Re-check now'}</span>
            </button>
          </div>
        </div>

        {/* The headline the page exists to give: did the upload land. */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="self-center">
              <BrandMark size="sm" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Last sheet read
              </span>
              <span className="text-sm font-bold text-slate-800 font-mono">
                {report?.lastCheckedAt || 'not since restart'}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Matched
              </span>
              <span id="id-match-matched-count" className="text-2xl font-black text-emerald-600 font-mono">
                {matchedCount}
              </span>
              <span className="text-xs text-slate-500 ml-1.5">
                of {totalSeen} row{totalSeen === 1 ? '' : 's'}
                {matchRate !== null ? ` · ${matchRate}%` : ''}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Not matched
              </span>
              <span id="id-match-total" className="text-2xl font-black text-rose-600 font-mono">
                {unmatchedCount}
              </span>
              <span className="text-xs text-slate-500 ml-1.5">dropped without a word</span>
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Changed something here
              </span>
              <span className="text-2xl font-black text-blue-700 font-mono">{appliedCount}</span>
              <span className="text-xs text-slate-500 ml-1.5">
                the rest matched and were already in step
              </span>
            </div>
          </div>

          {/* One bar, so the proportion is readable without doing the division. */}
          {totalSeen > 0 && (
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="bg-emerald-500"
                style={{ width: `${(matchedCount / totalSeen) * 100}%` }}
                title={`${matchedCount} matched`}
              />
              <div
                className="bg-rose-500"
                style={{ width: `${(unmatchedCount / totalSeen) * 100}%` }}
                title={`${unmatchedCount} not matched`}
              />
            </div>
          )}
        </div>

        {/* What this page is. The mechanism is the whole point: without it the
            list looks like a list of typos rather than a list of dropped data. */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 leading-relaxed">
            A Disruption ID is built as{' '}
            <strong className="font-semibold font-mono">OUTLETID-YYMMDDHHMM</strong> — the outlet, then the
            minute the disruption started. Both sheets look a record up by that ID, so if the start minute
            entered here differs from the one in the sheet, the IDs differ and{' '}
            <strong className="font-semibold">that row&rsquo;s end time and ticket are dropped without a word</strong>.
            Fixing a row below moves the record&rsquo;s start to the minute the sheet has and regenerates its ID,
            so both sides compute the same string from then on — and the corrected start shows on the Active
            Disruption board straight away, because it is the same record.
          </p>
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
              No sheet has been read since the server last restarted, so there is nothing to compare yet — empty
              lists below do <strong className="font-semibold">not</strong> mean the IDs agree. Press{' '}
              <strong className="font-semibold">Re-check now</strong> to read the sheets.
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

        {/* Tabs + search. The counts live on the tabs, so the answer to "did my
            upload work" is readable without choosing a tab first. */}
        <div className="px-6 py-3 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 self-start">
            <button
              id="id-match-tab-unmatched"
              type="button"
              onClick={() => setTab('unmatched')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-bold transition cursor-pointer ${
                tab === 'unmatched' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Unlink className="w-3.5 h-3.5" />
              Not matched
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  tab === 'unmatched' ? 'bg-white/20' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {unmatchedCount}
              </span>
            </button>
            <button
              id="id-match-tab-matched"
              type="button"
              onClick={() => setTab('matched')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-bold transition cursor-pointer ${
                tab === 'matched' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              Matched
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                  tab === 'matched' ? 'bg-white/20' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {matchedCount}
              </span>
            </button>
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="id-match-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sheet ID, outlet, store or ticket"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Not matched                                                       */}
        {/* ---------------------------------------------------------------- */}
        {tab === 'unmatched' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 w-8" />
                  <th className="px-4 py-3">Sheet Disruption ID</th>
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Start the sheet expects</th>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Feed</th>
                  <th className="px-4 py-3">Fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      Reading the report…
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
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
                            ? `All ${matchedCount} rows the feeds carried were placed. The Matched tab lists them.`
                            : 'Clear the search to see all of them.'}
                      </p>
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((row) => {
                    const isOpen = expanded === row.key;
                    const closest = row.candidates[0];
                    // One-click only when the nearest record is the same outlet,
                    // the same day and close in time. Anything else is a
                    // judgement, and the expander is where judgements are made.
                    const confident =
                      closest &&
                      row.sheetDate !== '' &&
                      closest.sameDay &&
                      closest.minuteGap !== null &&
                      Math.abs(closest.minuteGap) <= CONFIDENT_GAP_MINUTES;
                    const anyBusy = busyKey !== null;

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
                              className="p-1 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                              title={
                                isOpen ? 'Hide the records for this outlet' : 'Show the records for this outlet'
                              }
                              aria-expanded={isOpen}
                            >
                              {isOpen ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                            {row.sheetDisruptionId}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono font-semibold text-slate-800">
                              {row.outletId || '—'}
                            </span>
                            {closest?.disruption.storeName && (
                              <span className="block text-[11px] text-slate-500">
                                {closest.disruption.storeName}
                                {closest.disruption.city ? ` · ${closest.disruption.city}` : ''}
                              </span>
                            )}
                            {!row.outletKnown && (
                              <span className="block text-[11px] text-amber-700">
                                never logged in this console
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {row.sheetDate ? (
                              <span className="font-mono text-slate-700">
                                {prettyStart(row.sheetDate, row.sheetTime)}
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

                          {/* The fix, on the row. The old page put it two
                              clicks away behind an expander, which is most of
                              why nobody could tell what this screen was for. */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {confident ? (
                              <div className="flex items-center gap-2">
                                <button
                                  id={`id-match-quickfix-${closest!.disruption.disruptionId}`}
                                  type="button"
                                  disabled={anyBusy}
                                  onClick={() => applyFix(row, closest!.disruption, 'align')}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
                                  title={`Move ${closest!.disruption.disruptionId} from ${prettyStart(
                                    closest!.disruption.disruptionStartDate,
                                    closest!.disruption.disruptionStartTime || ''
                                  )} to ${prettyStart(
                                    row.sheetDate,
                                    row.sheetTime
                                  )} and regenerate its ID as ${row.sheetDisruptionId}`}
                                >
                                  <Wand2 className="w-3.5 h-3.5" />
                                  Set this time
                                </button>
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                                  {prettyStart(
                                    closest!.disruption.disruptionStartDate,
                                    closest!.disruption.disruptionStartTime || ''
                                  )}
                                  <ArrowRight className="w-3 h-3 text-slate-400" />
                                  {prettyStart(row.sheetDate, row.sheetTime)}
                                </span>
                              </div>
                            ) : closest ? (
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : row.key)}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 font-semibold text-xs transition cursor-pointer"
                                title="The nearest record is not an obvious match, so pick one yourself"
                              >
                                Pick a record · {describeMinuteGap(closest.minuteGap)}
                              </button>
                            ) : (
                              <span className="text-xs text-amber-700">
                                nothing logged for {row.outletId || 'this outlet'}
                              </span>
                            )}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-6 py-4">
                              {row.candidates.length === 0 ? (
                                <p className="text-xs text-slate-600">
                                  Nothing has ever been logged here for outlet{' '}
                                  <strong className="font-mono">{row.outletId || '—'}</strong>. Either the sheet
                                  row belongs to another team, or the disruption was never entered in this
                                  console — in which case the row below is a record to create, not an ID to fix.
                                </p>
                              ) : (
                                <>
                                  <p className="text-xs text-slate-600 mb-3">
                                    Records logged here for outlet{' '}
                                    <strong className="font-mono">{row.outletId}</strong>, nearest start first.
                                    Picking one sets its start to{' '}
                                    <strong className="font-mono">
                                      {row.sheetDate
                                        ? prettyStart(row.sheetDate, row.sheetTime)
                                        : 'the sheet value'}
                                    </strong>{' '}
                                    and regenerates its ID as{' '}
                                    <strong className="font-mono">{row.sheetDisruptionId}</strong>.
                                  </p>
                                  <div className="space-y-2">
                                    {row.candidates.map((candidate) => {
                                      const d = candidate.disruption;
                                      const alignKey = `${row.key}|${d.disruptionId}|align`;
                                      const idOnlyKey = `${row.key}|${d.disruptionId}|idOnly`;
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
                                              <span className="inline-flex items-center gap-1 font-mono">
                                                <Clock className="w-3.5 h-3.5" />
                                                {prettyStart(
                                                  d.disruptionStartDate,
                                                  d.disruptionStartTime || ''
                                                )}
                                                <ArrowRight className="w-3 h-3 text-slate-400" />
                                                {row.sheetDate
                                                  ? prettyStart(row.sheetDate, row.sheetTime)
                                                  : 'unchanged'}
                                              </span>
                                              <span className="font-semibold text-slate-600">
                                                {describeMinuteGap(candidate.minuteGap)}
                                              </span>
                                              {d.ticketId && <span className="font-mono">ticket {d.ticketId}</span>}
                                              {d.storeName && <span className="truncate">{d.storeName}</span>}
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0">
                                            <button
                                              id={`id-match-align-${d.disruptionId}`}
                                              type="button"
                                              disabled={anyBusy || !row.sheetDate}
                                              onClick={() => applyFix(row, d, 'align')}
                                              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
                                              title={
                                                row.sheetDate
                                                  ? `Move this record's start to ${prettyStart(row.sheetDate, row.sheetTime)} and regenerate its ID as ${row.sheetDisruptionId}`
                                                  : 'This sheet ID carries no start minute, so there is nothing to align to'
                                              }
                                            >
                                              <Wand2 className="w-3.5 h-3.5" />
                                              <span>
                                                {busyKey === alignKey ? 'Fixing…' : 'Set start + ID'}
                                              </span>
                                            </button>
                                            <button
                                              id={`id-match-idonly-${d.disruptionId}`}
                                              type="button"
                                              disabled={anyBusy}
                                              onClick={() => applyFix(row, d, 'idOnly')}
                                              className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold text-xs transition border border-slate-200 cursor-pointer"
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
                                    <strong className="font-semibold">Set start + ID</strong> is the one to use:
                                    it corrects the start the duration and TAT are measured from, and the
                                    matching ID falls out of that. The new start shows on the Active Disruption
                                    board immediately.{' '}
                                    <strong className="font-semibold">ID only</strong> leaves the start as it is,
                                    so the record keeps reporting the old duration — use it only when the
                                    sheet&rsquo;s start is the wrong one.
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
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Matched                                                           */}
        {/* ---------------------------------------------------------------- */}
        {tab === 'matched' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Sheet Disruption ID</th>
                  <th className="px-4 py-3">Matched record here</th>
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">End time in sheet</th>
                  <th className="px-4 py-3">Feed</th>
                  <th className="px-4 py-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      Reading the report…
                    </td>
                  </tr>
                )}

                {!loading && matchedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <Info className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">
                        {neverChecked
                          ? 'Nothing read yet'
                          : (report?.matched.length ?? 0) === 0
                            ? 'No sheet row found a record here'
                            : 'No matched ID matches that search'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {neverChecked
                          ? 'Press Re-check now to read the sheets.'
                          : (report?.matched.length ?? 0) === 0
                            ? 'Every row the feeds carried is on the Not matched tab.'
                            : 'Clear the search to see all of them.'}
                      </p>
                    </td>
                  </tr>
                )}

                {!loading &&
                  matchedRows.map((row) => (
                    <tr
                      key={`${row.feed}|${row.sheetDisruptionId}`}
                      id={`id-match-ok-${row.sheetDisruptionId}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {row.sheetDisruptionId}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="font-mono text-xs text-slate-700">{row.disruptionId}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono font-semibold text-slate-800">{row.outletId || '—'}</span>
                        {row.storeName && (
                          <span className="block text-[11px] text-slate-500">
                            {row.storeName}
                            {row.city ? ` · ${row.city}` : ''}
                          </span>
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
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            row.feed === 'tickets'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}
                        >
                          {SHEET_SOURCE_LABELS[row.feed]}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.applied ? (
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                            Updated the record
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold"
                            title="The row matched and carried nothing this console did not already have, or the ticket is closed and frozen"
                          >
                            Already in step
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {report?.matchedListCappedAt != null && (
              <div className="px-6 py-3 bg-amber-50 border-t border-amber-200 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-700">
                  Listing the first {report.matchedListCappedAt} matched rows of {matchedCount}. The counts above
                  are the full figures — only this list is capped, so a very large sheet does not have to be sent
                  to the browser in full.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
          Reading {SHEET_SOURCE_LABELS.disruptionTimings} and {SHEET_SOURCE_LABELS.tickets}. Both lists are
          rebuilt every time a feed runs and are not kept across a restart, so they always describe the latest
          read.
        </div>
      </div>
    </div>
  );
};
