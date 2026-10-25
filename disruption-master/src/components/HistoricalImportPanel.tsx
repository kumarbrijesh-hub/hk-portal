/**
 * One-off back-fill of disruptions recorded before the app existed.
 *
 * Months of hand-kept rows will have gaps and wording the app has never seen,
 * so the flow is preview-then-import: the preview says exactly what would
 * happen and writes nothing, and only then is the Import button offered. The
 * same file can be run twice safely - rows whose Disruption ID already exists
 * are skipped rather than duplicated.
 */

import React, { useState } from 'react';
import {
  History,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  FileUp,
} from 'lucide-react';
import { HISTORICAL_DISRUPTIONS_FORMAT } from '../data/sheetFormats';
import { SheetFormatHelp } from './SheetFormatHelp';
import { HistoricalImportResult, importHistoricalDisruptions } from '../services/api';

interface HistoricalImportPanelProps {
  /** Who to stamp the imported records as. */
  importedBy: string;
  /** Lets the page reload its records once rows have landed. */
  onImported: () => void;
}

export const HistoricalImportPanel: React.FC<HistoricalImportPanelProps> = ({
  importedBy,
  onImported,
}) => {
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoricalImportResult | null>(null);
  const [done, setDone] = useState<HistoricalImportResult | null>(null);

  /** Any edit invalidates a preview: it described different text. */
  const onTextChange = (text: string) => {
    setCsvText(text);
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onTextChange(String(reader.result || ''));
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const result = await importHistoricalDisruptions(csvText, dryRun, importedBy);
      if (dryRun) {
        setPreview(result);
        setDone(null);
      } else {
        setDone(result);
        setPreview(null);
        setCsvText('');
        onImported();
      }
    } catch (err: any) {
      setError(err?.message || 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  const summary = preview ?? done;

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
      <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-600" />
          6. Import Past Disruptions (one-off back-fill)
        </h3>
        <span className="text-xs text-slate-500">
          For disruptions recorded before the app, so reports cover the full history
        </span>
      </div>

      <SheetFormatHelp spec={HISTORICAL_DISRUPTIONS_FORMAT} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition">
            <FileUp className="w-3.5 h-3.5 text-slate-500" />
            <span>Select CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                e.target.value = '';
              }}
            />
          </label>
          <span className="text-[11px] text-slate-500">or paste the rows below, header row included</span>
        </div>

        <textarea
          value={csvText}
          onChange={(e) => onTextChange(e.target.value)}
          rows={7}
          placeholder={`Outlet ID,Disruption Start Date,Disruption Start Time,Bucket,Current Status,End Time\n30322,14/05/2026,09:15:00,Breakdown,Resolved by RAC,14/05/2026 13:40:00`}
          className="w-full p-2.5 rounded-lg border border-slate-300 font-mono text-[10px] bg-white focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={!csvText.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Preview (writes nothing)
          </button>

          <button
            type="button"
            onClick={() => run(false)}
            disabled={!preview || preview.wouldImport === 0 || busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
            title={preview ? undefined : 'Run the preview first'}
          >
            {busy === 'import' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {preview ? `Import ${preview.wouldImport} record${preview.wouldImport === 1 ? '' : 's'}` : 'Import'}
          </button>

          {!preview && !done && (
            <span className="text-[11px] text-slate-400">Preview first, then the Import button turns on.</span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-[11px] font-semibold text-rose-900 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {error}
          </p>
        </div>
      )}

      {done && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[11px] font-semibold text-emerald-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Imported {done.imported} record{done.imported === 1 ? '' : 's'}. They now appear in the Master
            Log, the weekly count and the performance summary.
          </p>
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
            {preview ? 'Preview' : 'Result'}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Rows read', value: summary.rowsRead },
              { label: preview ? 'Would import' : 'Imported', value: preview ? summary.wouldImport : summary.imported ?? 0 },
              { label: 'Already present', value: summary.alreadyPresent },
              { label: 'Rows with a problem', value: summary.problemCount },
            ].map((s) => (
              <div key={s.label} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                <p className="text-[10px] text-slate-500">{s.label}</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          {summary.duplicateInFile > 0 && (
            <p className="text-[11px] text-amber-800">
              {summary.duplicateInFile} row{summary.duplicateInFile === 1 ? '' : 's'} in this file share an
              outlet and start minute with another row, so only the first of each is kept. Give them
              different start times if they really are separate disruptions.
            </p>
          )}

          {summary.unknownOutlet > 0 && (
            <p className="text-[11px] text-slate-600">
              {summary.unknownOutlet} record{summary.unknownOutlet === 1 ? '' : 's'} reference an outlet that
              is not in the current store master. They still import, using the store name and city from the
              file.
            </p>
          )}

          {summary.unknownStatuses.length > 0 && (
            <p className="text-[11px] text-amber-800">
              Status values the app does not recognise, saved as No Update:{' '}
              <span className="font-mono">{summary.unknownStatuses.join(', ')}</span>
            </p>
          )}

          {summary.problems.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-700 mb-1">
                Rows skipped{summary.problemCount > summary.problems.length ? ` (first ${summary.problems.length} of ${summary.problemCount})` : ''}
              </p>
              <div className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-white divide-y divide-slate-100">
                {summary.problems.map((p) => (
                  <p key={`${p.row}-${p.reason}`} className="px-2 py-1 text-[11px] text-slate-600">
                    <span className="font-mono font-semibold text-slate-800">Row {p.row}</span> — {p.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          <details>
            <summary className="text-[11px] text-slate-500 cursor-pointer">Headers the app read</summary>
            <p className="mt-1 text-[11px] font-mono text-slate-600 break-words">
              {summary.headersSeen.join(' | ')}
            </p>
          </details>
        </div>
      )}
    </div>
  );
};
