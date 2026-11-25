import React, { useState } from 'react';
import { X, Save, AlertCircle, Tag, Ticket, ShieldCheck, Timer } from 'lucide-react';
import {
  BUCKET_OPTIONS,
  BucketType,
  Disruption,
  OemCoverage,
  OEM_COVERAGE_OPTIONS,
  requiresOemCoverage,
} from '../types';
import { StatusBadge } from './StatusBadge';

interface EditDetailsModalProps {
  disruption: Disruption;
  currentUser: string;
  /** Gates the response-time fields. Everything else here is open to the team. */
  isOwner: boolean;
  onClose: () => void;
  onSuccess: (updatedDisruption: Disruption) => void;
}

/**
 * Corrects the Bucket, the Ticket ID and the OEM coverage on a disruption that
 * is already logged.
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
 * The response-time figures are the exception, and are shown to the owner only.
 * CC FRT and RAC FRT are derived, not typed, so editing one overrides what the
 * app worked out; they also feed the FRT averages the console is judged on, so
 * a member correcting their own response time is the one edit that cannot be
 * left to the audit trail. The server enforces the same rule, so it holds for a
 * hand-written API call too.
 *
 * The start time and outlet stay fixed: the Disruption ID is generated from
 * them, so changing either would leave the ID naming a disruption that no
 * longer matches it.
 */
export const EditDetailsModal: React.FC<EditDetailsModalProps> = ({
  disruption,
  currentUser,
  isOwner,
  onClose,
  onSuccess,
}) => {
  const [bucket, setBucket] = useState<BucketType | ''>(disruption.bucket);
  const [ticketId, setTicketId] = useState(disruption.ticketId ?? '');
  // Shown only on records that were closed by OEM. It is the one field here that
  // is mandatory once it applies, so a mis-click on the resolving update can be
  // put right, and a record resolved before this field existed can be filled in.
  const [oemCoverage, setOemCoverage] = useState<OemCoverage | ''>(disruption.oemCoverage ?? '');
  // Held as text, not a number, so the box can be emptied to put the figure
  // back to "not reported" rather than being forced to some stand-in value.
  const [ccFrt, setCcFrt] = useState(
    disruption.ccFrtMins === undefined ? '' : String(disruption.ccFrtMins)
  );
  const [mstFrt, setMstFrt] = useState(
    disruption.mstFrtMins === undefined ? '' : String(disruption.mstFrtMins)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTicket = ticketId.trim();
  const showOemCoverage = requiresOemCoverage(disruption.currentStatus);

  /**
   * Empty clears the figure; anything else has to be a whole number of minutes.
   * `ok: false` is kept apart from `value: undefined` on purpose - typing "abc"
   * must not read as "clear it".
   */
  const parseFrt = (raw: string): { ok: boolean; value?: number } => {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: undefined };
    if (!/^\d+$/.test(trimmed)) return { ok: false };
    return { ok: true, value: Number(trimmed) };
  };

  const ccFrtEntry = parseFrt(ccFrt);
  const mstFrtEntry = parseFrt(mstFrt);
  const frtInvalid = isOwner && (!ccFrtEntry.ok || !mstFrtEntry.ok);
  const ccFrtChanged = isOwner && ccFrtEntry.ok && ccFrtEntry.value !== disruption.ccFrtMins;
  const mstFrtChanged = isOwner && mstFrtEntry.ok && mstFrtEntry.value !== disruption.mstFrtMins;

  const changed =
    bucket !== disruption.bucket ||
    trimmedTicket !== (disruption.ticketId ?? '').trim() ||
    (showOemCoverage && oemCoverage !== (disruption.oemCoverage ?? '')) ||
    ccFrtChanged ||
    mstFrtChanged;
  /** Names only what this modal is actually offering to the person reading it. */
  const heading = (() => {
    const fields = ['Bucket', 'Ticket ID'];
    if (showOemCoverage) fields.push('OEM Coverage');
    if (isOwner) fields.push('Response Times');
    const last = fields.pop() as string;
    return `Edit ${fields.join(', ')} & ${last}`;
  })();

  // Blank is what the server refuses for a Resolved by OEM record, so say so
  // here rather than letting the save bounce back with an error.
  const oemCoverageMissing = showOemCoverage && !oemCoverage;
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

    if (oemCoverageMissing) {
      setError(`Pick how the OEM job was covered - ${OEM_COVERAGE_OPTIONS.join(', ')}.`);
      return;
    }

    if (frtInvalid) {
      setError('Response times are in whole minutes. Leave a box empty to clear the figure.');
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
          ...(showOemCoverage ? { oemCoverage } : {}),
          // null, not undefined: JSON.stringify drops undefined, and the server
          // reads a missing key as "leave it alone". null is how a figure is
          // actually cleared.
          ...(ccFrtChanged ? { ccFrtMins: ccFrtEntry.value ?? null } : {}),
          ...(mstFrtChanged ? { mstFrtMins: mstFrtEntry.value ?? null } : {}),
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
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{heading}</h2>
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

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
                onChange={(e) => setBucket(e.target.value as BucketType | '')}
                className={`w-full cursor-pointer appearance-none rounded-lg border bg-white py-2 pl-9 pr-3 text-xs focus:ring-2 ${
                  bucket
                    ? 'border-slate-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-rose-400 bg-rose-50/60 text-rose-700 focus:ring-rose-500'
                }`}
              >
                <option value="">Not selected</option>
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
                Was <span className="font-semibold">{disruption.bucket || 'not set'}</span>
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

          {/* OEM coverage, only on records closed by OEM. */}
          {showOemCoverage && (
            <div>
              <label htmlFor="edit-oem-coverage" className="mb-1 block text-xs font-semibold text-slate-700">
                OEM Coverage <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <select
                  id="edit-oem-coverage"
                  value={oemCoverage}
                  onChange={(e) => setOemCoverage(e.target.value as OemCoverage | '')}
                  className={`w-full cursor-pointer appearance-none rounded-lg border bg-white py-2 pl-9 pr-3 text-xs focus:ring-2 ${
                    oemCoverage
                      ? 'border-slate-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-rose-400 bg-rose-50/60 text-rose-700 focus:ring-rose-500'
                  }`}
                >
                  <option value="">Not selected</option>
                  {OEM_COVERAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <ShieldCheck className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {oemCoverageMissing
                  ? 'Required on a record resolved by OEM.'
                  : oemCoverage !== (disruption.oemCoverage ?? '')
                  ? `Was ${disruption.oemCoverage || 'not set'}`
                  : 'How this OEM job was paid for.'}
              </p>
            </div>
          )}

          {/*
            Owner only. Everything above is a field somebody typed and can retype;
            these two are figures the app worked out, so changing one is an
            override and sits with the admin account alone.
          */}
          {isOwner && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-amber-700" />
                <p className="text-xs font-semibold text-amber-900">Correct the response times</p>
                <span className="ml-auto rounded bg-amber-200/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900">
                  Admin only
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-cc-frt" className="mb-1 block text-[10px] font-semibold text-slate-700">
                    CC FRT (min)
                  </label>
                  <input
                    id="edit-cc-frt"
                    type="text"
                    inputMode="numeric"
                    value={ccFrt}
                    onChange={(e) => setCcFrt(e.target.value)}
                    placeholder="Not reported"
                    autoComplete="off"
                    className={`w-full rounded-lg border bg-white px-2.5 py-2 font-mono text-xs focus:ring-2 ${
                      ccFrtEntry.ok
                        ? 'border-slate-300 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-rose-400 bg-rose-50/60 text-rose-700 focus:ring-rose-500'
                    }`}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    {!ccFrtEntry.ok
                      ? 'Whole minutes only.'
                      : ccFrtChanged
                      ? `Was ${disruption.ccFrtMins === undefined ? 'not set' : `${disruption.ccFrtMins} min`}`
                      : 'Derived from the start time and when CC logged it.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="edit-mst-frt" className="mb-1 block text-[10px] font-semibold text-slate-700">
                    RAC / MST FRT (min)
                  </label>
                  <input
                    id="edit-mst-frt"
                    type="text"
                    inputMode="numeric"
                    value={mstFrt}
                    onChange={(e) => setMstFrt(e.target.value)}
                    placeholder="Not reported"
                    autoComplete="off"
                    className={`w-full rounded-lg border bg-white px-2.5 py-2 font-mono text-xs focus:ring-2 ${
                      mstFrtEntry.ok
                        ? 'border-slate-300 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-rose-400 bg-rose-50/60 text-rose-700 focus:ring-rose-500'
                    }`}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    {!mstFrtEntry.ok
                      ? 'Whole minutes only.'
                      : mstFrtChanged
                      ? `Was ${disruption.mstFrtMins === undefined ? 'not set' : `${disruption.mstFrtMins} min`}`
                      : 'Reported once, when the record reached RAC Visited.'}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-amber-900/80">
                Empty a box to put the figure back to not reported. The old value is written into the audit
                trail against your name — overriding a derived number leaves no other trace.
              </p>
            </div>
          )}

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

          </div>

          {/* Pinned: never scrolls out of reach. */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
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
