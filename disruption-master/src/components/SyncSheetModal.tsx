import React, { useState, useId } from 'react';
import {
  FileSpreadsheet,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Clipboard,
  X,
  Database,
  ArrowRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { OutletMaster, SyncStatus } from '../types';

interface SyncSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  isSyncing: boolean;
  onSyncNow: () => Promise<void>;
  onBulkUploadOutlets: (outlets: OutletMaster[]) => Promise<void>;
  sheetUrl: string;
  tabName: string;
}

export const SyncSheetModal: React.FC<SyncSheetModalProps> = ({
  isOpen,
  onClose,
  syncStatus,
  isSyncing,
  onSyncNow,
  onBulkUploadOutlets,
  sheetUrl,
  tabName,
}) => {
  const [activeMode, setActiveMode] = useState<'paste' | 'url'>('paste');
  const [pastedText, setPastedText] = useState('');
  const [parsedOutlets, setParsedOutlets] = useState<OutletMaster[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<{ [key: string]: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const fileInputId = useId();

  if (!isOpen) return null;

  // Helper to parse CSV or TSV text
  const parseDelimitedText = (text: string) => {
    setParseError(null);
    if (!text.trim()) {
      setParsedOutlets([]);
      setDetectedColumns({});
      return;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setParseError('Please provide at least a header row and 1 data row.');
      return;
    }

    // Detect delimiter: tab or comma
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = tabCount >= commaCount ? '\t' : ',';

    const parseLine = (line: string): string[] => {
      if (delimiter === '\t') {
        return line.split('\t').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      }
      // Simple CSV split handling quotes
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim().replace(/^["']|["']$/g, ''));
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim().replace(/^["']|["']$/g, ''));
      return result;
    };

    const headers = parseLine(lines[0]);
    const cleanHeaders = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    const findHeader = (aliases: string[]): number => {
      for (const alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        const idx = cleanHeaders.indexOf(cleanAlias);
        if (idx !== -1) return idx;
      }
      for (const alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanAlias.length < 3) continue;
        const idx = cleanHeaders.findIndex((h) => h.includes(cleanAlias) || cleanAlias.includes(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idxOutlet = findHeader(['outlet_id', 'outlet id', 'outletid', 'store_id', 'storeid', 'outlet', 'hub_id', 'code']);
    const idxCity = findHeader(['city', 'location', 'region', 'zone']);
    const idxStore = findHeader(['store name', 'store_name', 'storename', 'store', 'hub name', 'hub']);
    const idxPoc = findHeader([
      'cold poc name-2',
      'cold poc name 2',
      'cold poc name',
      'cold_poc_name_2',
      'poc name-2',
      'poc name',
      'poc_name',
      'manager name',
      'poc',
    ]);
    const idxContact = findHeader([
      'cold poc contact-2',
      'cold poc contact 2',
      'cold poc contact',
      'cold_poc_contact_2',
      'poc contact-2',
      'poc contact number',
      'poc contact',
      'poc_contact',
      'phone',
      'mobile',
    ]);
    const idxMode = findHeader(['mode', 'store mode', 'format', 'store type', 'type']);
    const idxVendor = findHeader(['vendor', 'partner', 'agency', 'oem']);
    const idxAmc = findHeader(['amc coverage', 'amc', 'coverage', 'amc status']);
    const idxCurrentVendor = findHeader([
      'current vendor (amc or warranty)',
      'current vendor',
      'vendor (amc or warranty)',
      'vendor (auto)',
    ]);
    const idxL1Name = findHeader(['lod - 2 l1 name', 'lod 2 l1 name', 'lod-2 l1 name', 'lod l1 name', 'l1 name']);
    const idxL1Email = findHeader(['lod - 2 l1 email', 'lod 2 l1 email', 'lod-2 l1 email', 'lod l1 email', 'l1 email']);
    const idxL1Contact = findHeader([
      'lod - 2 l1 contact no',
      'lod 2 l1 contact no',
      'lod - 2 l1 contact',
      'lod 2 l1 contact',
      'lod l1 contact no',
      'lod l1 contact',
      'l1 contact no',
      'l1 contact',
    ]);
    const idxL2Name = findHeader(['lod - 2 l2 name', 'lod 2 l2 name', 'lod-2 l2 name', 'lod l2 name', 'l2 name']);
    const idxL2Email = findHeader(['lod - 2 l2 email', 'lod 2 l2 email', 'lod-2 l2 email', 'lod l2 email', 'l2 email']);
    const idxL2Contact = findHeader([
      'lod - 2 l2 contact no',
      'lod 2 l2 contact no',
      'lod - 2 l2 contact',
      'lod 2 l2 contact',
      'lod l2 contact no',
      'lod l2 contact',
      'l2 contact no',
      'l2 contact',
    ]);
    const idxL3Name = findHeader(['lod - 2 l3 name', 'lod 2 l3 name', 'lod-2 l3 name', 'lod l3 name', 'l3 name']);
    const idxL3Email = findHeader(['lod - 2 l3 email', 'lod 2 l3 email', 'lod-2 l3 email', 'lod l3 email', 'l3 email']);
    const idxL3Contact = findHeader([
      'lod - 2 l3 contact no.',
      'lod - 2 l3 contact no',
      'lod 2 l3 contact no.',
      'lod 2 l3 contact no',
      'lod - 2 l3 contact',
      'lod 2 l3 contact',
      'lod l3 contact no',
      'lod l3 contact',
      'l3 contact no',
      'l3 contact',
    ]);
    const idxRegion = findHeader(['region (auto)', 'region', 'zone']);
    const idxMstRacName = findHeader(['mst/rac name (auto)', 'mst/rac name', 'mst rac name', 'mst name']);
    const idxMstRacContact = findHeader(['mst/rac contact no. (auto)', 'mst/rac contact no', 'mst rac contact']);

    if (idxOutlet === -1) {
      setParseError('Could not locate "outlet_id" column. Header row must include outlet_id or Outlet ID.');
      return;
    }

    setDetectedColumns({
      'Outlet ID': headers[idxOutlet] || 'outlet_id',
      City: idxCity !== -1 ? headers[idxCity] : '(Default)',
      'Store Name': idxStore !== -1 ? headers[idxStore] : '(Default)',
      'Cold POC Name-2': idxPoc !== -1 ? headers[idxPoc] : '(Default)',
      'Cold POC Contact-2': idxContact !== -1 ? headers[idxContact] : '(Default)',
      'AMC Coverage': idxAmc !== -1 ? headers[idxAmc] : '(Auto)',
      'Current Vendor': idxCurrentVendor !== -1 ? headers[idxCurrentVendor] : '(Auto)',
      'LOD L1 Name': idxL1Name !== -1 ? headers[idxL1Name] : '(Optional)',
    });

    const results: OutletMaster[] = [];
    const seen = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const row = parseLine(lines[i]);
      const rawId = (row[idxOutlet] || '').trim();
      if (!rawId) continue;
      const upperId = rawId.toUpperCase();
      if (seen.has(upperId)) continue;
      seen.add(upperId);

      const storeName = (idxStore !== -1 ? row[idxStore] : '') || `Store ${upperId}`;
      const city = (idxCity !== -1 ? row[idxCity] : '') || 'Delhi NCR';
      const pocName = (idxPoc !== -1 ? row[idxPoc] : '') || 'Operations POC';
      const pocContact = (idxContact !== -1 ? row[idxContact] : '') || '+91 98000 00000';
      const mode = (idxMode !== -1 ? row[idxMode] : '') || 'Dark Store';
      const vendor = (idxVendor !== -1 ? row[idxVendor] : '') || 'RAC';

      const amcCoverage = (idxAmc !== -1 ? row[idxAmc] : '') || '';
      const currentVendor = (idxCurrentVendor !== -1 ? row[idxCurrentVendor] : '') || vendor;
      const lodL1Name = (idxL1Name !== -1 ? row[idxL1Name] : '') || '';
      const lodL1Email = (idxL1Email !== -1 ? row[idxL1Email] : '') || '';
      const lodL1Contact = (idxL1Contact !== -1 ? row[idxL1Contact] : '') || '';
      const lodL2Name = (idxL2Name !== -1 ? row[idxL2Name] : '') || '';
      const lodL2Email = (idxL2Email !== -1 ? row[idxL2Email] : '') || '';
      const lodL2Contact = (idxL2Contact !== -1 ? row[idxL2Contact] : '') || '';
      const lodL3Name = (idxL3Name !== -1 ? row[idxL3Name] : '') || '';
      const lodL3Email = (idxL3Email !== -1 ? row[idxL3Email] : '') || '';
      const lodL3Contact = (idxL3Contact !== -1 ? row[idxL3Contact] : '') || '';
      const region = (idxRegion !== -1 ? row[idxRegion] : '') || '';
      const mstRacName = (idxMstRacName !== -1 ? row[idxMstRacName] : '') || '';
      const mstRacContact = (idxMstRacContact !== -1 ? row[idxMstRacContact] : '') || '';

      results.push({
        outletId: upperId,
        storeName,
        city,
        mode,
        vendor,
        pocName,
        pocContact,
        coldPocName2: pocName,
        coldPocContact2: pocContact,
        amcCoverage,
        currentVendor,
        lodL1Name,
        lodL1Email,
        lodL1Contact,
        lodL2Name,
        lodL2Email,
        lodL2Contact,
        lodL3Name,
        lodL3Email,
        lodL3Contact,
        region,
        mstRacName,
        mstRacContact,
      });
    }

    if (results.length === 0) {
      setParseError('No valid data rows found under header.');
      return;
    }

    setParsedOutlets(results);
  };

  // Handle file upload (.xlsx, .csv)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt') || file.name.endsWith('.tsv')) {
        const text = await file.text();
        setPastedText(text);
        parseDelimitedText(text);
      } else {
        // Excel file
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        setPastedText(csv);
        parseDelimitedText(csv);
      }
    } catch (err: any) {
      setParseError(`Error reading file: ${err.message}`);
    }
  };

  // Save parsed outlets into DMS database
  const handleConfirmSave = async () => {
    if (parsedOutlets.length === 0) return;
    setIsSaving(true);
    setParseError(null);
    try {
      await onBulkUploadOutlets(parsedOutlets);
      onClose();
    } catch (err: any) {
      setParseError(err.message || 'Failed to save outlets to database.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="sync-sheet-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div
        id="sync-sheet-modal-card"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-3xl w-full overflow-hidden my-6"
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                Sync Full Google Sheet (Outlet Master)
              </h2>
              <p className="text-xs text-slate-300">
                Sync outlet_id, City, Store Name, Cold POC Name-2, Cold POC Contact-2 into database
              </p>
            </div>
          </div>
          <button
            id="close-sync-sheet-modal-button"
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveMode('paste')}
            className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 transition cursor-pointer ${
              activeMode === 'paste'
                ? 'bg-white text-emerald-700 border-b-2 border-emerald-600 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clipboard className="w-4 h-4" />
            <span>1-Click Paste / Upload Full Sheet (Recommended)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('url')}
            className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 transition cursor-pointer ${
              activeMode === 'url'
                ? 'bg-white text-emerald-700 border-b-2 border-emerald-600 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ExternalLink className="w-4 h-4" />
            <span>Direct Google Sheet Link Sync</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* MODE 1: 1-Click Paste / File Upload */}
          {activeMode === 'paste' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 text-xs text-emerald-950">
                <p className="font-bold flex items-center gap-1.5 mb-1 text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Instant Full Sheet Sync — Works Even With Restricted Google Org Permissions:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-emerald-900/90 ml-1">
                  <li>
                    Open your Google Sheet tab in your browser (
                    <a
                      href={sheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline hover:text-emerald-700 inline-flex items-center gap-0.5"
                    >
                      Open Google Sheet <ExternalLink className="w-3 h-3 inline" />
                    </a>
                    )
                  </li>
                  <li>Press <kbd className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono text-[11px]">Ctrl+A</kbd> then <kbd className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono text-[11px]">Ctrl+C</kbd> to copy the sheet</li>
                  <li>Paste (<kbd className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono text-[11px]">Ctrl+V</kbd>) below or drag & drop an Excel/CSV file!</li>
                </ol>
              </div>

              {/* Paste Textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="sheet-raw-data-textarea" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Clipboard className="w-3.5 h-3.5 text-slate-500" />
                    Paste Google Sheet Data Rows (Tab or Comma separated):
                  </label>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={fileInputId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium cursor-pointer transition"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload File (.xlsx, .csv)</span>
                    </label>
                    <input
                      id={fileInputId}
                      type="file"
                      accept=".csv, .tsv, .xlsx, .xls, .txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                <textarea
                  id="sheet-raw-data-textarea"
                  rows={6}
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    parseDelimitedText(e.target.value);
                  }}
                  placeholder="outlet_id	City	Store Name	Cold POC Name-2	Cold POC Contact-2&#10;OUT10021	Bengaluru	Koramangala 4th Block Hub	Ramesh Sharma	+91 98112 34501&#10;OUT12345	Gurugram	Cyber City Sector 24	Vikram Rajput	+91 98450 12345"
                  className="w-full p-3 font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 transition"
                />
              </div>

              {/* Error Callout */}
              {parseError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Detected Summary */}
              {parsedOutlets.length > 0 && (
                <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-bold text-slate-800">
                        {parsedOutlets.length} Outlets Ready to Sync
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-700 bg-emerald-100 font-semibold px-2 py-0.5 rounded">
                      Detected & Validated
                    </span>
                  </div>

                  {/* Column Mapping Badges */}
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(detectedColumns).map(([key, val]) => (
                      <span
                        key={key}
                        className="bg-white border border-slate-200 px-2 py-1 rounded text-slate-700 flex items-center gap-1 shadow-2xs"
                      >
                        <strong className="text-emerald-700">{key}:</strong> {val}
                      </span>
                    ))}
                  </div>

                  {/* Preview Table */}
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Data Preview (First {Math.min(parsedOutlets.length, 5)} of {parsedOutlets.length} records):
                    </span>
                    <div className="overflow-x-auto border border-slate-200 rounded bg-white max-h-40">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold sticky top-0">
                          <tr>
                            <th className="p-2 font-mono">outlet_id</th>
                            <th className="p-2">Store Name</th>
                            <th className="p-2">City</th>
                            <th className="p-2">Cold POC Name-2</th>
                            <th className="p-2">Cold POC Contact-2</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-600 font-medium">
                          {parsedOutlets.slice(0, 5).map((o, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2 font-mono font-bold text-slate-900">{o.outletId}</td>
                              <td className="p-2">{o.storeName}</td>
                              <td className="p-2">{o.city}</td>
                              <td className="p-2 text-slate-800">{o.pocName}</td>
                              <td className="p-2 font-mono">{o.pocContact}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE 2: Direct URL Sync */}
          {activeMode === 'url' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Target Google Sheet URL:</span>
                  <a
                    href={sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Open Sheet in Google Drive <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="p-2.5 bg-white border border-slate-200 rounded font-mono text-xs text-slate-700 break-all select-all">
                  {sheetUrl || 'No Google Sheet URL configured'}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Tab Name: <strong>{tabName || 'Default'}</strong></span>
                  <span>GID extracted automatically</span>
                </div>
              </div>

              {/* Access note */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5 text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  Requirement for Direct URL Sync:
                </p>
                <p>
                  Because Google Sheets by default blocks external automated servers from reading private sheets, you must set:
                </p>
                <ul className="list-disc list-inside space-y-1 text-amber-900 ml-1">
                  <li>In Google Sheets: Click <strong>Share</strong> (top right)</li>
                  <li>Under <strong>General access</strong>, change to <strong>Anyone with the link can view</strong></li>
                  <li>(Or use the <strong>1-Click Paste / Upload</strong> tab above which requires 0 permission changes!)</li>
                </ul>
              </div>

              {/* Sync Status Callout */}
              <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-700 block">Current Sync Status:</span>
                  <span
                    className={`text-xs font-bold ${
                      syncStatus.status === 'Success'
                        ? 'text-emerald-600'
                        : syncStatus.status === 'Syncing'
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {syncStatus.status} ({syncStatus.recordsCount} outlets cached)
                  </span>
                  {syncStatus.errorDetails && (
                    <p className="text-[11px] text-rose-600 mt-0.5 line-clamp-2">
                      {syncStatus.errorDetails}
                    </p>
                  )}
                </div>
                <button
                  id="direct-url-sync-button"
                  type="button"
                  onClick={onSyncNow}
                  disabled={isSyncing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'SYNCING FROM SHEET...' : 'FETCH & SYNC NOW'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition cursor-pointer"
          >
            Cancel
          </button>

          {activeMode === 'paste' ? (
            <button
              id="confirm-sync-full-sheet-button"
              type="button"
              onClick={handleConfirmSave}
              disabled={parsedOutlets.length === 0 || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>SAVING OUTLETS...</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>
                    SYNC & SAVE ALL {parsedOutlets.length > 0 ? `${parsedOutlets.length} OUTLETS` : 'OUTLETS'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
