import React, { useState } from 'react';
import { X, Send, Activity, AlertCircle } from 'lucide-react';
import { CurrentStatus, CURRENT_STATUS_OPTIONS, Disruption, RESOLVED_STATUSES_REQUIRING_ISSUE } from '../types';
import { StatusBadge } from './StatusBadge';

interface LiveUpdateModalProps {
  disruption: Disruption;
  currentUser: string;
  issueMaster: Record<string, string[]>;
  onClose: () => void;
  onSuccess: (updatedDisruption: Disruption) => void;
}

export const LiveUpdateModal: React.FC<LiveUpdateModalProps> = ({
  disruption,
  currentUser,
  issueMaster,
  onClose,
  onSuccess,
}) => {
  const [updateText, setUpdateText] = useState('');
  const [targetStatus, setTargetStatus] = useState<CurrentStatus>(disruption.currentStatus);
  const [selectedIssue, setSelectedIssue] = useState(disruption.issue || '');
  const [selectedSubIssue, setSelectedSubIssue] = useState(disruption.subIssue || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIssueRequired = RESOLVED_STATUSES_REQUIRING_ISSUE.includes(targetStatus);

  const handleIssueChange = (val: string) => {
    setSelectedIssue(val);
    const subList = issueMaster[val] || [];
    setSelectedSubIssue(subList.length > 0 ? subList[0] : '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!updateText.trim()) {
      setError('Please provide live update remarks.');
      return;
    }

    if (isIssueRequired) {
      if (!selectedIssue.trim()) {
        setError(`Issue category is mandatory for status "${targetStatus}".`);
        return;
      }
      if (!selectedSubIssue.trim()) {
        setError(`Sub Issue is mandatory for status "${targetStatus}".`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/disruptions/${encodeURIComponent(disruption.disruptionId)}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateText: updateText.trim(),
          updatedBy: currentUser || disruption.ccPoc || 'Operator',
          newStatus: targetStatus,
          issue: isIssueRequired ? selectedIssue : undefined,
          subIssue: isIssueRequired ? selectedSubIssue : undefined,
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
              {CURRENT_STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st} {st === disruption.currentStatus ? '(No Change)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Conditional Issue selection if moving to Resolved */}
          {isIssueRequired && (
            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-emerald-900 mb-1">
                  Issue Category <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedIssue}
                  onChange={(e) => handleIssueChange(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-emerald-300 bg-white"
                  required
                >
                  <option value="">Select Issue</option>
                  {Object.keys(issueMaster).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-emerald-900 mb-1">
                  Sub Issue <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedSubIssue}
                  onChange={(e) => setSelectedSubIssue(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-emerald-300 bg-white"
                  required
                >
                  <option value="">Select Sub Issue</option>
                  {(issueMaster[selectedIssue] || []).map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
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
