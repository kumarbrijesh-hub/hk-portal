import React, { useMemo, useState } from 'react';
import { X, Send, Activity, AlertCircle } from 'lucide-react';
import {
  CurrentStatus,
  Disruption,
  RESOLVED_STATUSES_REQUIRING_ISSUE,
  STATUS_REQUIRING_RAC_FRT,
} from '../types';
import { hoursBetween } from '../utils/dateUtils';
import { StatusBadge } from './StatusBadge';
import { SubIssuePicker } from './SubIssuePicker';
import { readSubIssues } from '../utils/issueTaxonomy';

interface LiveUpdateModalProps {
  disruption: Disruption;
  currentUser: string;
  issueMaster: Record<string, string[]>;
  /** The Current Status dropdown, as configured by an admin. */
  statusOptions: string[];
  onClose: () => void;
  onSuccess: (updatedDisruption: Disruption) => void;
}

export const LiveUpdateModal: React.FC<LiveUpdateModalProps> = ({
  disruption,
  currentUser,
  issueMaster,
  statusOptions,
  onClose,
  onSuccess,
}) => {
  const [updateText, setUpdateText] = useState('');
  // Seeded from the record so an update that does not touch it keeps the
  // previous shift's note instead of blanking it.
  const [internalRemarks, setInternalRemarks] = useState(disruption.internalRemarks ?? '');
  const [targetStatus, setTargetStatus] = useState<CurrentStatus>(disruption.currentStatus);
  const [selectedSubIssues, setSelectedSubIssues] = useState<string[]>(readSubIssues(disruption));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIssueRequired = RESOLVED_STATUSES_REQUIRING_ISSUE.includes(targetStatus);

  /**
   * Asked only on the update that first marks the technician as arrived. Once
   * it is on the record it is never asked again, and it is not asked at all if
   * the record already came through RAC Visited.
   */
  const needsRacFrt =
    targetStatus === STATUS_REQUIRING_RAC_FRT &&
    disruption.currentStatus !== STATUS_REQUIRING_RAC_FRT &&
    disruption.mstFrtMins === undefined;

  /**
   * Either type the minutes, or pick the arrival time and let it work them out
   * from the disruption's own start - whichever the person has to hand.
   */
  const [racFrtMode, setRacFrtMode] = useState<'minutes' | 'time'>('minutes');
  const [racFrtMinutes, setRacFrtMinutes] = useState('');
  const [racArrivalAt, setRacArrivalAt] = useState('');

  const racFrtFromArrival = useMemo(() => {
    if (!racArrivalAt) return null;
    // datetime-local gives YYYY-MM-DDTHH:MM, which parseISTTimestamp reads.
    const hrs = hoursBetween(disruption.disruptionStartDateTime, racArrivalAt.replace('T', ' '));
    return hrs === null ? null : Math.max(0, Math.round(hrs * 60));
  }, [racArrivalAt, disruption.disruptionStartDateTime]);

  const racFrtValue = racFrtMode === 'minutes' ? racFrtMinutes.trim() : racFrtFromArrival;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!updateText.trim()) {
      setError('Please provide live update remarks.');
      return;
    }

    if (isIssueRequired && selectedSubIssues.length === 0) {
      setError(`Select at least one sub-issue for status "${targetStatus}".`);
      return;
    }

    if (needsRacFrt && (racFrtValue === null || racFrtValue === '' || Number(racFrtValue) < 0)) {
      setError(
        racFrtMode === 'minutes'
          ? 'Enter how many minutes the RAC technician took to reach site.'
          : 'Pick the time the RAC technician reached site.'
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/disruptions/${encodeURIComponent(disruption.disruptionId)}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateText: updateText.trim(),
          internalRemarks,
          updatedBy: currentUser || disruption.ccPoc || 'Operator',
          newStatus: targetStatus,
          subIssues: selectedSubIssues,
          ...(needsRacFrt ? { racFrtMins: Number(racFrtValue) } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to append live update');
      }

      const result = await res.json();
      onSuccess(result.disruption);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error saving update');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Add Live Operational Update
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {disruption.disruptionId} — {disruption.storeName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Current Status Info */}
          <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
            <span className="text-slate-500">Current Disruption Status:</span>
            <StatusBadge status={disruption.currentStatus} />
          </div>

          {/* Target Status Selection */}
          <div>
            <label htmlFor="modal-status-select" className="block text-xs font-semibold text-slate-700 mb-1">
              Update Current Status (Optional)
            </label>
            <select
              id="modal-status-select"
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value as CurrentStatus)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-red-500 font-medium"
            >
              {statusOptions.map((st) => (
                <option key={st} value={st}>
                  {st} {st === disruption.currentStatus ? '(No Change)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Resolution taxonomy. Shown whenever anything has been tagged so a
              correction does not need the status to be flipped first. */}
          {(isIssueRequired || selectedSubIssues.length > 0) && (
            <div
              className={`p-3 rounded-lg border space-y-3 ${
                isIssueRequired ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <SubIssuePicker
                issueMaster={issueMaster}
                selected={selectedSubIssues}
                onChange={setSelectedSubIssues}
                required={isIssueRequired}
                idPrefix="modal-sub-issue"
              />
              <p className="text-[11px] text-slate-600">
                Pick every sub-issue that applied. The issue category is filled in from the master automatically.
              </p>
            </div>
          )}

          {/* Only appears on the update that first marks the technician arrived,
              because that is the one moment anyone knows the answer. */}
          {needsRacFrt && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-900">
                  How long did the RAC technician take to reach site?{' '}
                  <span className="text-rose-600">*</span>
                </p>
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setRacFrtMode('minutes')}
                    className={`px-2 py-0.5 rounded font-semibold ${
                      racFrtMode === 'minutes'
                        ? 'bg-amber-900 text-white'
                        : 'bg-white text-amber-900 border border-amber-300'
                    }`}
                  >
                    Minutes
                  </button>
                  <button
                    type="button"
                    onClick={() => setRacFrtMode('time')}
                    className={`px-2 py-0.5 rounded font-semibold ${
                      racFrtMode === 'time'
                        ? 'bg-amber-900 text-white'
                        : 'bg-white text-amber-900 border border-amber-300'
                    }`}
                  >
                    Arrival time
                  </button>
                </div>
              </div>

              {racFrtMode === 'minutes' ? (
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={racFrtMinutes}
                  onChange={(e) => setRacFrtMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  aria-label="RAC arrival time in minutes"
                  className="w-full p-2 text-xs rounded-lg border border-amber-300 font-mono bg-white focus:ring-2 focus:ring-amber-500"
                />
              ) : (
                <div className="space-y-1">
                  <input
                    type="datetime-local"
                    value={racArrivalAt}
                    onChange={(e) => setRacArrivalAt(e.target.value)}
                    aria-label="Time the RAC technician reached site"
                    className="w-full p-2 text-xs rounded-lg border border-amber-300 bg-white focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="text-[10px] text-amber-800">
                    {racFrtFromArrival === null
                      ? `Disruption started ${disruption.disruptionStartDateTime}`
                      : `Works out to ${racFrtFromArrival} minutes from the ${disruption.disruptionStartDateTime} start.`}
                  </p>
                </div>
              )}

              <p className="text-[10px] text-amber-800">
                Asked once. It is stored on the record and feeds the RAC FRT column and the Active
                Disruptions report.
              </p>
            </div>
          )}

          {/* Live Update Remarks */}
          <div>
            <label htmlFor="modal-update-text" className="block text-xs font-semibold text-slate-700 mb-1">
              Live Update Text <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="modal-update-text"
              rows={4}
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              placeholder="e.g. Technician reached site at 11:15 AM. Identified motor contactor burnout..."
              className="w-full p-2.5 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
              required
            />
          </div>

          {/* Team-only. Kept out of every report and export. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="modal-internal-remarks" className="block text-xs font-semibold text-slate-700">
                Internal Remarks <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span className="text-[11px] text-slate-400">Team only - never appears in any report</span>
            </div>
            <textarea
              id="modal-internal-remarks"
              rows={2}
              value={internalRemarks}
              onChange={(e) => setInternalRemarks(e.target.value)}
              placeholder="Handover note for the next shift (e.g. MST Rajesh 98XXXXXX21, call before 9pm...)"
              className="w-full p-2.5 text-xs rounded-lg border border-dashed border-slate-300 focus:ring-2 focus:ring-slate-400 focus:border-slate-400 bg-slate-50/60"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500">
              Posting as: <strong className="text-slate-700">{currentUser || disruption.ccPoc}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Saving...' : 'Post Update'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
