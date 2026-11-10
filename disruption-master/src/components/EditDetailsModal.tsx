import React, { useState } from 'react';
import { X, Save, AlertCircle, Tag, Ticket } from 'lucide-react';
import { BUCKET_OPTIONS, BucketType, Disruption } from '../types';
import { StatusBadge } from './StatusBadge';

interface EditDetailsModalProps {
  disruption: Disruption;
  currentUser: string;
  onClose: () => void;
  onSuccess: (updatedDisruption: Disruption) => void;
}

/**
 * Corrects the Bucket and the Ticket ID on a disruption that is already logged.
 *
 * Both are routinely got wrong at creation and only settled later: the bucket
 * because whether something is a real breakdown is often not clear in the first
 * minutes, and the ticket because it is raised in another system after the
 * disruption is already on the board. Until now neither could be changed at
 * all, so the only fix was to delete the record - which needs the owner - and
 * type it again.
 *
 * Open to anyone signed in, deliberately. These two fields are reversible and
 * every change lands in the audit trail with a name against it, which is a
 * better control for a correction than making the team queue behind one
 * account.
 *
 * The start time and outlet stay fixed: the Disruption ID is generated from
 * them, so changing either would leave the ID naming a disruption that no
 * longer matches it.
 */
export const EditDetailsModal: React.FC<EditDetailsModalProps> = ({
  disruption,
  currentUser,
  onClose,
  onSuccess,
}) => {
  const [bucket, setBucket] = useState<BucketType>(disruption.bucket);
  const [ticketId, setTicketId] = useState(disruption.ticketId ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTicket = ticketId.trim();
  const changed = bucket !== disruption.bucket || trimmedTicket !== (disruption.ticketId ?? '').trim();
  // A Breakdown with no ticket is allowed through - it is flagged as missing in
  // the tracker and in the export, which is where it gets chased - but it is
  // worth saying so at the moment the choice is made.
  const missingBreakdownTicket = bucket === 'Breakdown' && !trimmedTicket;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!changed) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/disruptions/${encodeURIComponent(disruption.disruptionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket,
          // Sent as an empty string rather than omitted, so clearing a ticket
          // that was entered by mistake actually clears it.
          ticketId: trimmedTicket,
          updatedBy: currentUser || disruption.ccPoc || 'Operator',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save the change.');
      }

      const data = await res.json();
      onSuccess(data.disruption as Disruption);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Edit Bucket &amp; Ticket ID</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{disruption.disruptionId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-4">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">{disruption.outletId}</span>
            <span className="text-slate-300">|</span>
            <span className="truncate">{disruption.storeName || '—'}</span>
            <span className="ml-auto shrink-0">
              <StatusBadge status={disruption.currentStatus} />
            </span>
          </div>

          {/* Bucket */}
          <div>
            <label htmlFor="edit-bucket" className="mb-1 block text-xs font-semibold text-slate-700">
              Bucket
            </label>
            <div className="relative">
              <select
                id="edit-bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value as BucketType)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs focus:border-red-500 focus:ring-2 focus:ring-red-500"
              >
                {BUCKET_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Tag className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
            {bucket !== disruption.bucket && (
              <p className="mt-1 text-[10px] text-slate-500">
                Was <span className="font-semibold">{disruption.bucket}</span>
              </p>
            )}
          </div>

          {/* Ticket ID */}
          <div>
            <label htmlFor="edit-ticket-id" className="mb-1 block text-xs font-semibold text-slate-700">
              Disruption Ticket ID / Nugget Ticket ID
            </label>
            <div className="relative">
              <input
                id="edit-ticket-id"
                type="text"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Leave blank if there is no ticket"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 font-mono text-xs focus:border-red-500 focus:ring-2 focus:ring-red-500"
              />
              <Ticket className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
            {missingBreakdownTicket && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-700">
                <AlertCircle className="h-3 w-3" />
                Breakdowns normally carry a ticket. Saving without one is fine — it will show as missing until
                you add it.
              </p>
            )}
          </div>

          <p className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500">
            Outlet and disruption start time cannot be changed here — the Disruption ID is generated from them.
            This change is recorded against your name in the audit trail.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !changed}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={changed ? 'Save the change' : 'Nothing has changed yet'}
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save change'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
