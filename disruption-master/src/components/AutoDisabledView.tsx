import React, { useMemo, useState, useEffect } from 'react';
import {
  PowerOff,
  Search,
  MessageSquarePlus,
  History,
  Pencil,
  RefreshCw,
  Clock,
  Repeat,
  Ticket,
  AlertCircle,
} from 'lucide-react';
import { Disruption, isAutoDisabled } from '../types';
import { StatusBadge, BucketBadge } from './StatusBadge';
import { LiveUpdateLog } from './LiveUpdateLog';
import { ticketRollupIndex, hoursLabel, runHours } from '../utils/ticketInstances';
import { hoursSince } from '../utils/dateUtils';
import { formatHoursMinutes } from '../utils/auditHold';

interface AutoDisabledViewProps {
  allDisruptions: Disruption[];
  onOpenLiveUpdate: (disruption: Disruption) => void;
  onOpenHistory: (disruption: Disruption) => void;
  onOpenEditDetails?: (disruption: Disruption) => void;
  onRefreshData?: () => void;
}

/**
 * The parking bay.
 *
 * A store that auto-disables is not fixed - the fault is still there and the
 * ticket is still open - but nobody is working it this minute either. Leaving
 * those rows on the Active board meant the active count answered the wrong
 * question: it said "this many problems exist", when the number the floor needs
 * is "this many problems are being worked right now".
 *
 * So they live here, in full, and the way back is simply to give the record any
 * other open status. There is no "reactivate" button and deliberately so - the
 * status is already the thing being changed when RAC is aligned or the vendor
 * is sent, and a second control would be a second place for the two to disagree.
 */
export const AutoDisabledView: React.FC<AutoDisabledViewProps> = ({
  allDisruptions,
  onOpenLiveUpdate,
  onOpenHistory,
  onOpenEditDetails,
  onRefreshData,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // The "parked for" cell is relative to now, so nudge the clock to keep it
  // honest on a dashboard somebody leaves open all shift.
  const [, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const parked = useMemo(
    () => allDisruptions.filter((d) => isAutoDisabled(d.currentStatus)),
    [allDisruptions]
  );

  // Built over every record, not just the parked ones: the earlier runs of a
  // ticket are usually resolved or parked elsewhere, and leaving them out would
  // under-report the hours the store has actually been down.
  const rollups = useMemo(() => ticketRollupIndex(allDisruptions), [allDisruptions]);

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = q
      ? parked.filter((d) =>
          [d.disruptionId, d.outletId, d.storeName, d.city, d.ticketId, d.vendor]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : parked;

    // Longest parked first: the row that has been sitting here since yesterday
    // is the one somebody has stopped looking at.
    return [...matched].sort((a, b) =>
      (a.disruptionStartDateTime || '').localeCompare(b.disruptionStartDateTime || '')
    );
  }, [parked, searchQuery]);

  const repeatsOnOneTicket = useMemo(
    () => rows.filter((d) => (rollups.get(d.disruptionId)?.occurrences ?? 1) > 1).length,
    [rows, rollups]
  );

  return (
    <div id="auto-disabled-page" className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-800 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
              <PowerOff className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-wider text-white">Auto Disabled Stores</h2>
              <p className="text-xs text-slate-400">
                Parked, not closed — the ticket is still open and the fault is still there.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-3xl font-black text-amber-300 tabular-nums leading-none">{parked.length}</div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase mt-1">Parked</div>
            </div>
            {onRefreshData && (
              <button
                type="button"
                onClick={onRefreshData}
                className="p-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* How a record leaves this page. Stated on the page itself because it
            is the one thing about it that is not obvious from looking. */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 leading-relaxed">
            A record lands here the moment its status is set to{' '}
            <strong className="font-semibold">Auto Disable</strong>, and goes straight back to{' '}
            <strong className="font-semibold">Live Active Disruption</strong> as soon as it is moved to any other
            open status — RAC Aligned, RAC Visited, OEM Aligned, vendor visit, anything. Post that change from the
            Update button on the row.
          </p>
        </div>

        {/* Search + repeat counter */}
        <div className="px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-200 bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="auto-disabled-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search outlet, store, ticket or disruption ID"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          {repeatsOnOneTicket > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
              <Repeat className="w-3.5 h-3.5" />
              {repeatsOnOneTicket} on a ticket that has already run before
            </span>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-bold">Disruption</th>
                <th className="px-4 py-3 text-left font-bold">Store</th>
                <th className="px-4 py-3 text-left font-bold">Ticket</th>
                <th className="px-4 py-3 text-left font-bold">Bucket</th>
                <th className="px-4 py-3 text-right font-bold">This Run</th>
                <th className="px-4 py-3 text-right font-bold">Ticket Total</th>
                <th className="px-4 py-3 text-left font-bold">Parked For</th>
                <th className="px-4 py-3 text-left font-bold min-w-[18rem]">Live Updates</th>
                <th className="px-4 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                    {parked.length === 0
                      ? 'Nothing is parked on Auto Disable right now.'
                      : 'No parked record matches that search.'}
                  </td>
                </tr>
              )}

              {rows.map((d) => {
                const rollup = rollups.get(d.disruptionId);
                const occurrences = rollup?.occurrences ?? 1;
                const parkedHours = hoursSince(d.lastUpdatedAt);

                return (
                  <tr key={d.disruptionId} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-slate-800">{d.disruptionId}</div>
                      <div className="mt-1">
                        <StatusBadge status={d.currentStatus} />
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{d.outletId}</div>
                      <div className="text-slate-500">{d.storeName}</div>
                      <div className="text-[11px] text-slate-400">
                        {[d.city, d.currentVendor || d.vendor].filter(Boolean).join(' • ')}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {d.ticketId ? (
                        <>
                          <div className="font-mono text-slate-700 flex items-center gap-1">
                            <Ticket className="w-3 h-3 text-slate-400 shrink-0" />
                            {d.ticketId}
                          </div>
                          {occurrences > 1 && (
                            <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold">
                              <Repeat className="w-3 h-3" />
                              RUN {occurrences}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-rose-600 font-semibold">No ticket</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <BucketBadge bucket={d.bucket} />
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                      {hoursLabel(runHours(d)) || '—'}
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span
                        className={`font-mono font-bold ${
                          occurrences > 1 ? 'text-amber-700' : 'text-slate-600'
                        }`}
                        title={
                          occurrences > 1
                            ? `${occurrences} runs on ticket ${rollup?.ticket} added together`
                            : 'Only run on this ticket'
                        }
                      >
                        {hoursLabel(rollup?.totalHours ?? null) || '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                        {parkedHours === null ? '—' : formatHoursMinutes(parkedHours)}
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">{d.lastUpdatedAt || ''}</div>
                    </td>

                    <td className="px-4 py-3 min-w-[18rem]">
                      <LiveUpdateLog disruption={d} compact />
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenLiveUpdate(d)}
                          title="Post an update — change the status here to send it back to Active"
                          className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition"
                        >
                          <MessageSquarePlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenHistory(d)}
                          title="Full update history"
                          className="p-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        {onOpenEditDetails && (
                          <button
                            type="button"
                            onClick={() => onOpenEditDetails(d)}
                            title="Correct the Bucket or Ticket ID"
                            className="p-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
