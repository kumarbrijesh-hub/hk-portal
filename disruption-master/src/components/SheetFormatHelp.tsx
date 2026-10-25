/**
 * "What should my sheet look like?" for one feed.
 *
 * Collapsed by default so it does not crowd the settings page, and it renders
 * straight from the format spec the server's parser is documented against, so
 * what this shows is what the parser actually looks for.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Download, FileSpreadsheet } from 'lucide-react';
import {
  SheetFormatSpec,
  TIMESTAMP_FORMAT_HELP,
  TIMESTAMP_TIMEZONE_NOTE,
  templateCsvFor,
  templateRowsFor,
} from '../data/sheetFormats';

interface SheetFormatHelpProps {
  spec: SheetFormatSpec;
}

/** Feeds that take a timestamp need the date-format note; the master does not. */
function usesTimestamps(spec: SheetFormatSpec): boolean {
  return spec.columns.some((c) => /time|closed|resolved/i.test(c.name));
}

export const SheetFormatHelp: React.FC<SheetFormatHelpProps> = ({ spec }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = templateRowsFor(spec);

  const copyHeaderRow = async () => {
    try {
      // Tab-separated, so pasting into a sheet lands one value per cell.
      await navigator.clipboard.writeText(rows[0].join('\t'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked; the table below is still readable and selectable.
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([templateCsvFor(spec)], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${spec.title.replace(/\s+/g, '_')}_Template.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const requiredCols = spec.columns.filter((c) => c.required);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          What should this sheet look like?
        </span>
        <span className="text-[11px] text-slate-500">
          {requiredCols.length} required column{requiredCols.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-200 pt-3">
          <div className="space-y-1">
            <p className="text-[11px] text-slate-600">{spec.purpose}</p>
            <p className="text-[11px] text-slate-600">
              <span className="font-semibold">Tab name:</span>{' '}
              <code className="px-1 py-0.5 rounded bg-white border border-slate-200 font-mono">
                {spec.defaultTab}
              </code>
            </p>
            <p className="text-[11px] text-slate-600">
              <span className="font-semibold">How rows are matched:</span> {spec.matching}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyHeaderRow}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Header row copied' : 'Copy header row'}
            </button>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3 h-3" />
              Download template CSV
            </button>
            <span className="text-[11px] text-slate-400">
              Paste the header row into row 1 of the sheet, then fill rows below it.
            </span>
          </div>

          {/* Exactly what row 1 and row 2 should hold */}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="text-[11px] whitespace-nowrap">
              <tbody>
                <tr className="bg-slate-100">
                  <td className="px-2 py-1 font-bold text-slate-500 border-r border-slate-200 sticky left-0 bg-slate-100">
                    Row 1
                  </td>
                  {rows[0].map((h) => (
                    <td key={h} className="px-2 py-1 font-bold text-slate-800 border-r border-slate-100 last:border-0">
                      {h}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-2 py-1 font-bold text-slate-500 border-r border-slate-200 sticky left-0 bg-white">
                    Row 2
                  </td>
                  {rows[1].map((v, i) => (
                    <td
                      key={`${rows[0][i]}-ex`}
                      className="px-2 py-1 font-mono text-slate-600 border-r border-slate-100 last:border-0"
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Per-column detail */}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-slate-800 text-white text-left">
                  <th className="px-2 py-1.5 font-semibold">Column</th>
                  <th className="px-2 py-1.5 font-semibold">Required</th>
                  <th className="px-2 py-1.5 font-semibold">What goes in it</th>
                  <th className="px-2 py-1.5 font-semibold">Also accepted as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {spec.columns.map((c) => (
                  <tr key={c.name}>
                    <td className="px-2 py-1.5 font-semibold text-slate-800 whitespace-nowrap">{c.name}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {c.required ? (
                        <span className="font-bold text-rose-700">Yes</span>
                      ) : (
                        <span className="text-slate-400">Optional</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{c.description}</td>
                    <td className="px-2 py-1.5 text-slate-500 font-mono">
                      {c.alsoAccepts?.length ? c.alsoAccepts.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {usesTimestamps(spec) && (
            <div className="rounded border border-slate-200 bg-white p-2.5">
              <p className="text-[11px] font-semibold text-slate-700 mb-1">Accepted date and time formats</p>
              <ul className="space-y-0.5">
                {TIMESTAMP_FORMAT_HELP.map((f) => (
                  <li key={f} className="text-[11px] text-slate-600 font-mono">
                    {f}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-800 mt-1.5">{TIMESTAMP_TIMEZONE_NOTE}</p>
            </div>
          )}

          <div className="rounded border border-slate-200 bg-white p-2.5">
            <p className="text-[11px] font-semibold text-slate-700 mb-1">Good to know</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li className="text-[11px] text-slate-600">
                Column order does not matter, and extra columns are ignored.
              </li>
              <li className="text-[11px] text-slate-600">
                Header matching ignores case, spaces and punctuation, so{' '}
                <code className="font-mono">Outlet ID</code>, <code className="font-mono">outlet_id</code> and{' '}
                <code className="font-mono">OUTLET-ID</code> are the same column.
              </li>
              {spec.notes.map((n) => (
                <li key={n} className="text-[11px] text-slate-600">
                  {n}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-sky-200 bg-sky-50 p-2.5">
            <p className="text-[11px] font-semibold text-sky-900 mb-1 inline-flex items-center gap-1.5">
              <FileSpreadsheet className="w-3 h-3" />
              For the Google Sheet sync to work
            </p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li className="text-[11px] text-sky-900">
                Open the sheet, click Share, and set General access to{' '}
                <strong>Anyone with the link — Viewer</strong>. The app reads the sheet anonymously, so a
                restricted sheet comes back as HTTP 401.
              </li>
              <li className="text-[11px] text-sky-900">
                Paste the sheet link into Sheet link above, and put the tab's exact name in Tab name.
              </li>
              <li className="text-[11px] text-sky-900">
                Press Sync now once to check it, then leave auto-sync on to pick up changes every interval.
              </li>
            </ol>
            <p className="text-[11px] text-sky-800 mt-1.5">
              Not allowed to share the sheet? Use Upload rows instead and paste the same columns in.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
