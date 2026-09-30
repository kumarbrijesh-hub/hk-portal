import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Save,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Layers,
  Database,
  Plus,
  Trash2,
  Upload,
  Info,
  ExternalLink,
} from 'lucide-react';
import { AppConfig, OutletMaster, SyncStatus } from '../types';

interface ConfigViewProps {
  config: AppConfig;
  syncStatus: SyncStatus;
  outlets: OutletMaster[];
  isSyncing: boolean;
  onSaveConfig: (updated: AppConfig) => Promise<void>;
  onSyncNow: () => void;
  onBulkUploadOutlets: (outlets: OutletMaster[]) => Promise<void>;
}

export const ConfigView: React.FC<ConfigViewProps> = ({
  config,
  syncStatus,
  outlets,
  isSyncing,
  onSaveConfig,
  onSyncNow,
  onBulkUploadOutlets,
}) => {
  // Local config form state
  const [googleSheetUrl, setGoogleSheetUrl] = useState(config.googleSheetUrl || '');
  const [sheetTabName, setSheetTabName] = useState(config.sheetTabName || 'Master_Data');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(config.syncIntervalMinutes || 5);
  const [columnMapping, setColumnMapping] = useState({ ...config.columnMapping });
  const [ccPocs, setCcPocs] = useState<string[]>([...config.ccPocOptions]);
  const [newPocInput, setNewPocInput] = useState('');
  const [issueMaster, setIssueMaster] = useState<Record<string, string[]>>({ ...config.issueMaster });
  const [newIssueCategory, setNewIssueCategory] = useState('');
  const [newSubIssueInput, setNewSubIssueInput] = useState('');
  const [selectedIssueCategory, setSelectedIssueCategory] = useState<string>(
    Object.keys(config.issueMaster)[0] || ''
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [csvUploadError, setCsvUploadError] = useState<string | null>(null);
  const [csvUploadSuccess, setCsvUploadSuccess] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const updatedConfig: AppConfig = {
        ...config,
        googleSheetUrl: googleSheetUrl.trim(),
        sheetTabName: sheetTabName.trim(),
        syncIntervalMinutes: Number(syncIntervalMinutes) || 5,
        columnMapping,
        ccPocOptions: ccPocs,
        issueMaster,
      };

      await onSaveConfig(updatedConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPoc = () => {
    if (!newPocInput.trim()) return;
    const clean = newPocInput.trim();
    if (!ccPocs.includes(clean)) {
      setCcPocs([...ccPocs, clean]);
    }
    setNewPocInput('');
  };

  const handleRemovePoc = (name: string) => {
    setCcPocs(ccPocs.filter((p) => p !== name));
  };

  const handleAddIssueCategory = () => {
    if (!newIssueCategory.trim()) return;
    const clean = newIssueCategory.trim();
    if (!issueMaster[clean]) {
      setIssueMaster({ ...issueMaster, [clean]: [] });
      setSelectedIssueCategory(clean);
    }
    setNewIssueCategory('');
  };

  const handleAddSubIssue = () => {
    if (!newSubIssueInput.trim() || !selectedIssueCategory) return;
    const clean = newSubIssueInput.trim();
    const existing = issueMaster[selectedIssueCategory] || [];
    if (!existing.includes(clean)) {
      setIssueMaster({
        ...issueMaster,
        [selectedIssueCategory]: [...existing, clean],
      });
    }
    setNewSubIssueInput('');
  };

  const handleRemoveSubIssue = (sub: string) => {
    if (!selectedIssueCategory) return;
    setIssueMaster({
      ...issueMaster,
      [selectedIssueCategory]: (issueMaster[selectedIssueCategory] || []).filter((s) => s !== sub),
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvUploadError(null);
    setCsvUploadSuccess(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          throw new Error('CSV file has no data rows.');
        }

        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        const newOutlets: OutletMaster[] = [];

        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
          if (row.length < 2) continue;
          newOutlets.push({
            outletId: row[0].toUpperCase(),
            storeName: row[1] || `Store ${row[0]}`,
            city: row[2] || 'Default City',
            mode: row[3] || 'Dark Store',
            vendor: row[4] || 'RAC',
            pocName: row[5] || 'Operations Lead',
            pocContact: row[6] || '+91 98000 00000',
            syncedAt: new Date().toLocaleTimeString(),
          });
        }

        if (newOutlets.length === 0) {
          throw new Error('No valid outlet rows found in CSV.');
        }

        await onBulkUploadOutlets(newOutlets);
        setCsvUploadSuccess(`Successfully loaded ${newOutlets.length} outlets into cache.`);
      } catch (err: any) {
        setCsvUploadError(err.message || 'Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div id="config-view-container" className="space-y-6 max-w-5xl mx-auto">
      {/* Title Card */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Google Sheet Master Data & Configuration
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Configure Google Sheets sync parameters, column header mappings, CC POC operators, and issue taxonomy.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow transition flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'SYNCING...' : 'SYNC NOW'}</span>
          </button>
        </div>
      </div>

      {/* Sync Diagnostics & Status Card */}
      <div className="bg-slate-900 text-white rounded-xl shadow-xs border border-slate-800 p-5 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="text-slate-400 block text-[11px]">Sync Status</span>
          <div className="flex items-center gap-2 mt-1">
            {syncStatus.status === 'Success' ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                <CheckCircle className="w-4 h-4" /> Operational / Synced
              </span>
            ) : syncStatus.status === 'Syncing' ? (
              <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                <RefreshCw className="w-4 h-4 animate-spin" /> Syncing in Progress
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                <AlertCircle className="w-4 h-4" /> Sync Warning / Fallback
              </span>
            )}
          </div>
        </div>

        <div>
          <span className="text-slate-400 block text-[11px]">Last Successful Sync</span>
          <span className="font-mono text-slate-200 mt-1 block">
            {syncStatus.lastSyncTime || '—'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[11px]">Master Records in Cache</span>
          <span className="font-bold text-emerald-400 text-sm mt-1 block">
            {outlets.length} Outlets
          </span>
        </div>

        <div>
          <span className="text-slate-400 block text-[11px]">Sync Interval</span>
          <span className="text-slate-200 mt-1 block font-medium">
            Every {config.syncIntervalMinutes} minutes (Background Auto-Sync)
          </span>
        </div>

        {syncStatus.errorDetails && (
          <div className="col-span-full pt-2 border-t border-slate-800 text-amber-300 text-[11px]">
            <strong>Note:</strong> {syncStatus.errorDetails}
          </div>
        )}
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: Google Sheet Source */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-600" />
              1. Google Sheet Connection Details
            </h3>
            <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded border border-amber-200 font-medium">
              Configurable Placeholder
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Google Sheet URL
              </label>
              <input
                type="text"
                value={googleSheetUrl}
                onChange={(e) => setGoogleSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                className="w-full p-2.5 rounded-lg border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                Provide the link to the master Google Sheet. The sheet must be shared with "Anyone with link can view".
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tab / Sheet Name
              </label>
              <input
                type="text"
                value={sheetTabName}
                onChange={(e) => setSheetTabName(e.target.value)}
                placeholder="Master_Data"
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Auto-Sync Interval (Minutes)
              </label>
              <select
                value={syncIntervalMinutes}
                onChange={(e) => setSyncIntervalMinutes(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-emerald-500"
              >
                <option value={5}>Every 5 minutes (Recommended)</option>
                <option value={10}>Every 10 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Column Mappings */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-600" />
              2. Google Sheet Column Mappings
            </h3>
            <span className="text-xs text-slate-500">
              Matches your sheet's column header names
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Outlet ID Column</label>
              <input
                type="text"
                value={columnMapping.outletId}
                onChange={(e) => setColumnMapping({ ...columnMapping, outletId: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Store Name Column</label>
              <input
                type="text"
                value={columnMapping.storeName}
                onChange={(e) => setColumnMapping({ ...columnMapping, storeName: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">City Column</label>
              <input
                type="text"
                value={columnMapping.city}
                onChange={(e) => setColumnMapping({ ...columnMapping, city: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Mode Column</label>
              <input
                type="text"
                value={columnMapping.mode}
                onChange={(e) => setColumnMapping({ ...columnMapping, mode: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Vendor Column</label>
              <input
                type="text"
                value={columnMapping.vendor}
                onChange={(e) => setColumnMapping({ ...columnMapping, vendor: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">POC Name Column</label>
              <input
                type="text"
                value={columnMapping.pocName}
                onChange={(e) => setColumnMapping({ ...columnMapping, pocName: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">POC Contact Number Column</label>
              <input
                type="text"
                value={columnMapping.pocContact}
                onChange={(e) => setColumnMapping({ ...columnMapping, pocContact: e.target.value })}
                className="w-full p-2 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        </div>

        {/* Section 3: CC POC Masters */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              3. CC POC Operator Master List
            </h3>
            <span className="text-xs text-slate-500">
              Configured operators permitted in the CC POC dropdown
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {ccPocs.map((poc) => (
              <span
                key={poc}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-medium border border-slate-200"
              >
                <span>{poc}</span>
                <button
                  type="button"
                  onClick={() => handleRemovePoc(poc)}
                  className="text-slate-400 hover:text-rose-600 transition ml-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 max-w-sm">
            <input
              type="text"
              value={newPocInput}
              onChange={(e) => setNewPocInput(e.target.value)}
              placeholder="Add new operator name..."
              className="flex-1 p-2 rounded-lg border border-slate-300 text-xs"
            />
            <button
              type="button"
              onClick={handleAddPoc}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Section 4: Issue & Sub-Issue Master */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              4. Issue & Sub-Issue Taxonomy Master
            </h3>
            <span className="text-xs text-slate-500">
              Hierarchical master data required for resolved statuses
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Category selection */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Issue Categories</label>
              <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50">
                {Object.keys(issueMaster).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedIssueCategory(category)}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition flex items-center justify-between ${
                      selectedIssueCategory === category
                        ? 'bg-red-600 text-white font-semibold'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span>{category}</span>
                    <span className="text-[10px] opacity-75">
                      ({issueMaster[category]?.length || 0})
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 mt-2">
                <input
                  type="text"
                  value={newIssueCategory}
                  onChange={(e) => setNewIssueCategory(e.target.value)}
                  placeholder="New Category..."
                  className="flex-1 p-1.5 text-xs rounded border border-slate-300"
                />
                <button
                  type="button"
                  onClick={handleAddIssueCategory}
                  className="px-2.5 py-1.5 bg-slate-800 text-white rounded text-xs font-semibold"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Sub Issues for selected category */}
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Sub-Issues under <span className="text-red-600">{selectedIssueCategory}</span>
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-white">
                {(issueMaster[selectedIssueCategory] || []).length === 0 ? (
                  <div className="text-slate-400 py-4 text-center">No sub-issues added yet.</div>
                ) : (
                  (issueMaster[selectedIssueCategory] || []).map((sub) => (
                    <div
                      key={sub}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200 text-slate-800"
                    >
                      <span>{sub}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubIssue(sub)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={newSubIssueInput}
                  onChange={(e) => setNewSubIssueInput(e.target.value)}
                  placeholder={`Add sub-issue for ${selectedIssueCategory}...`}
                  className="flex-1 p-2 rounded-lg border border-slate-300 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddSubIssue}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Sub-Issue</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 5: Direct CSV Master Outlets Upload */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Upload className="w-4 h-4 text-slate-600" />
              5. Direct Master Data CSV Import / Backup
            </h3>
            <span className="text-xs text-slate-500">
              Upload outlet records directly if Google Sheets is not yet provisioned
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 shadow-2xs transition">
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Select CSV File</span>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <span className="text-[11px] text-slate-500">
              Columns: Outlet ID, Store Name, City, Mode, Vendor, POC Name, POC Contact
            </span>
          </div>

          {csvUploadSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{csvUploadSuccess}</span>
            </div>
          )}

          {csvUploadError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{csvUploadError}</span>
            </div>
          )}
        </div>

        {/* Save Bar */}
        <div className="sticky bottom-4 z-20 bg-slate-900/90 backdrop-blur-md p-4 rounded-xl shadow-xl flex items-center justify-between text-white border border-slate-700">
          <div className="flex items-center gap-2">
            {saveSuccess ? (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" />
                Configuration updated and background sync scheduled!
              </span>
            ) : (
              <span className="text-xs text-slate-300">
                All settings are stored in application state and cloud database.
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-md transition flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'SAVING...' : 'SAVE CONFIGURATION'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
