import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Database,
  Lock,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  SheetSourceKey,
  SheetSources,
  SHEET_SOURCE_DESCRIPTIONS,
  SHEET_SOURCE_KEYS,
  SHEET_SOURCE_LABELS,
  SyncStatus,
  SyncStatuses,
} from '../types';
import { formatSpecFor } from '../data/sheetFormats';
import { countDataRows, readSpreadsheetAsCsv } from '../utils/spreadsheetFile';
import { SheetFormatHelp } from './SheetFormatHelp';

/**
 * The three sheet feeds, side by side.
 *
 * They are deliberately independent: store details, disruption timings and
 * ticket state come from different sheets kept by different people, each has
 * its own link, tab and on/off switch, and one failing never stops the others.
 */

interface SheetSourcesPanelProps {
  sources: SheetSources;
  statuses: SyncStatuses;
  /** Only the owner account can change a sheet link or switch a feed off. */
  isOwner: boolean;
  /** Updates the draft held by the parent form; saved with the rest of Settings. */
  onChange: (sources: SheetSources) => void;
  onSyncSource: (key: SheetSourceKey) => Promise<void>;
  /** Paste path for the timing and ticket feeds. */
  onUploadCsv: (key: SheetSourceKey, csvText: string) => Promise<void>;
  syncingSource: SheetSourceKey | null;
}

/** Expected column headers, shown so the sheet owner knows what to supply. */
const EXPECTED_COLUMNS: Record<SheetSourceKey, string> = {
  outletMaster: 'Outlet ID, Store Name, City, Mode, Vendor, AMC Coverage, POC Name, POC Contact',
  disruptionTimings: 'Disruption ID, End Time',
  tickets: 'Disruption ID, Ticket ID, Ticket Status, Closure Time',
};

const StatusPill: React.FC<{ status: SyncStatus; busy: boolean }> = ({ status, busy }) => {
  if (busy || status.status === 'Syncing') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Syncing
      </span>
    );
  }
  if (status.status === 'Success') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
        <CheckCircle className="w-3.5 h-3.5" /> Synced
      </span>
    );
  }
  if (status.status === 'Failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
        <AlertCircle className="w-3.5 h-3.5" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" /> Not configured
    </span>
  );
};

export const SheetSourcesPanel: React.FC<SheetSourcesPanelProps> = ({
  sources,
  statuses,
  isOwner,
  onChange,
  onSyncSource,
  onUploadCsv,
  syncingSource,
}) => {
  const [pasteOpenFor, setPasteOpenFor] = useState<SheetSourceKey | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteResult, setPasteResult] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pickedFile, setPickedFile] = useState<string | null>(null);

  const updateSource = (key: SheetSourceKey, patch: Partial<SheetSources[SheetSourceKey]>) => {
    onChange({ ...sources, [key]: { ...sources[key], ...patch } });
  };

  /** Clears whatever the last upload drawer was left holding. */
  const resetUploadState = () => {
    setPasteText('');
    setPasteError(null);
    setPasteResult(null);
    setPickedFile(null);
  };

  /**
   * Reads the picked file into the paste box rather than sending it straight
   * on, so the rows can be eyeballed before they replace anything.
   */
  const handlePickFile = async (key: SheetSourceKey, file: File | undefined) => {
    if (!file) return;
    setPasteError(null);
    setPasteResult(null);
    try {
      const csvText = await readSpreadsheetAsCsv(file, sources[key].tabName);
      if (!csvText.trim()) {
        setPickedFile(null);
        setPasteError('That file came back empty.');
        return;
      }
      setPasteText(csvText);
      setPickedFile(`${file.name} — ${countDataRows(csvText)} rows`);
    } catch (err) {
      setPickedFile(null);
      setPasteError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  /**
   * A store master upload replaces every outlet, so it is owner-only and the
   * server rejects it from anyone else. The other two only touch rows they can
   * match by Disruption ID, so anyone signed in may upload those.
   */
  const canUpload = (key: SheetSourceKey) => key !== 'outletMaster' || isOwner;

  const handleUpload = async (key: SheetSourceKey) => {
    setPasteError(null);
    setPasteResult(null);
    if (!pasteText.trim()) {
      setPasteError('Choose a CSV file, or paste the rows including the header row.');
      return;
    }
    setIsUploading(true);
    try {
      await onUploadCsv(key, pasteText);
      setPasteResult('Rows applied.');
      setPasteText('');
      setPickedFile(null);
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Could not read the uploaded rows.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-600" />
          1. Sheet Feeds
        </h3>
        <span className="text-[11px] text-slate-500">
          Three separate feeds, each independent. Upload a CSV for any of them, or point one at a
          sheet that is shared with <span className="font-semibold">Anyone with the link</span>.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {SHEET_SOURCE_KEYS.map((key) => {
          const source = sources[key];
          const status = statuses[key];
          const busy = syncingSource === key;

          return (
            <section
              key={key}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-3"
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">{SHEET_SOURCE_LABELS[key]}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {SHEET_SOURCE_DESCRIPTIONS[key]}
                  </p>
                </div>
                <StatusPill status={status} busy={busy} />
              </header>

              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  disabled={!isOwner}
                  onChange={(e) => updateSource(key, { enabled: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-slate-300 disabled:opacity-50"
                />
                Include in auto-sync
              </label>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Sheet link</label>
                <input
                  type="text"
                  value={source.url}
                  disabled={!isOwner}
                  onChange={(e) => updateSource(key, { url: e.target.value })}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  className="w-full p-2 rounded-lg border border-slate-300 font-mono text-[11px] bg-white focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Tab name</label>
                <input
                  type="text"
                  value={source.tabName}
                  disabled={!isOwner}
                  onChange={(e) => updateSource(key, { tabName: e.target.value })}
                  className="w-full p-2 rounded-lg border border-slate-300 text-[11px] bg-white focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <p className="text-[10px] text-slate-500 leading-snug">
                <span className="font-semibold text-slate-600">Columns:</span> {EXPECTED_COLUMNS[key]}
              </p>

              <dl className="text-[11px] text-slate-600 space-y-0.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Last sync</dt>
                  <dd className="font-mono">{status.lastSyncTime || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Rows applied</dt>
                  <dd className="font-semibold tabular-nums">{status.recordsCount}</dd>
                </div>
              </dl>

              {status.errorDetails && (
                <p
                  className={`text-[10px] leading-snug rounded-lg px-2 py-1.5 border ${
                    status.status === 'Failed'
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {status.errorDetails}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSyncSource(key)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-lg transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                  {busy ? 'Syncing' : 'Sync now'}
                </button>

                {canUpload(key) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPasteOpenFor(pasteOpenFor === key ? null : key);
                      resetUploadState();
                    }}
                    className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold rounded-lg transition flex items-center gap-1.5"
                  >
                    <Upload className="w-3 h-3" />
                    Upload CSV
                  </button>
                )}
              </div>

              <SheetFormatHelp spec={formatSpecFor(key)} />

              {pasteOpenFor === key && (
                <div className="space-y-2 border-t border-slate-200 pt-2">
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Choose a CSV or Excel file
                    </span>
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.xlsx,.xls"
                      onChange={(e) => {
                        void handlePickFile(key, e.target.files?.[0]);
                        // Lets the same file be picked again after a failed read.
                        e.target.value = '';
                      }}
                      className="w-full text-[10px] text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border file:border-slate-300 file:bg-white file:text-[10px] file:font-semibold file:text-slate-700 hover:file:bg-slate-50"
                    />
                  </label>

                  {pickedFile && (
                    <p className="text-[10px] font-semibold text-slate-600">{pickedFile}</p>
                  )}

                  <p className="text-[10px] text-slate-500">
                    Or paste the rows in directly:
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      setPickedFile(null);
                    }}
                    rows={5}
                    placeholder={`${EXPECTED_COLUMNS[key]}\n...paste the rows here`}
                    className="w-full p-2 rounded-lg border border-slate-300 font-mono text-[10px] bg-white focus:ring-2 focus:ring-emerald-500"
                  />

                  {key === 'outletMaster' && (
                    <p className="text-[10px] text-amber-800 leading-snug">
                      This replaces the whole store master. A store missing from the file
                      disappears from the outlet picker.
                    </p>
                  )}

                  {pasteError && <p className="text-[10px] text-rose-700">{pasteError}</p>}
                  {pasteResult && <p className="text-[10px] text-emerald-700">{pasteResult}</p>}
                  <button
                    type="button"
                    onClick={() => handleUpload(key)}
                    disabled={isUploading || !pasteText.trim()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {isUploading ? 'Applying…' : 'Apply rows'}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {!isOwner && (
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
          <Lock className="w-3 h-3" />
          Sheet links and the store master are owner-only. You can still run a sync, and upload
          timing and ticket rows.
        </p>
      )}
    </div>
  );
};
