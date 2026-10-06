/**
 * Disruption Management System
 * Production-ready operational incident tracking, master data sync, and active reporting.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { LiveTrackerForm } from './components/LiveTrackerForm';
import { LiveTrackerTable } from './components/LiveTrackerTable';
import { ActiveDisruptionsView } from './components/ActiveDisruptionsView';
import { ConfigView } from './components/ConfigView';
import { LiveUpdateModal } from './components/LiveUpdateModal';
import { UpdateHistoryModal } from './components/UpdateHistoryModal';
import { SyncSheetModal } from './components/SyncSheetModal';
import {
  AppConfig,
  Disruption,
  isDisruptionActive,
  OutletMaster,
  SyncStatus,
} from './types';
import {
  fetchConfig,
  fetchDisruptions,
  fetchOutlets,
  fetchSyncStatus,
  triggerSyncNow,
  updateConfig,
  bulkUploadOutlets,
} from './services/api';
import { DEFAULT_CONFIG, INITIAL_OUTLETS } from './data/defaultConfig';
import { INITIAL_DISRUPTIONS } from './data/initialDisruptions';

interface AuthState {
  authRequired: boolean;
  authenticated: boolean;
}

/** Shown instead of the console when APP_PASSWORD is set and there is no session. */
function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Sign in failed.');
      }
      setPassword('');
      onSignedIn();
    } catch (err: any) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden"
      >
        <div className="bg-slate-900 px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center text-white font-bold tracking-wider">
            DMS
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Disruption Management System</h1>
            <p className="text-xs text-slate-400">Sign in to continue</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">{error}</div>
          )}

          <div>
            <label htmlFor="app-password" className="block text-xs font-semibold text-slate-700 mb-1">
              Password
            </label>
            <input
              id="app-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition disabled:opacity-50"
          >
            {busy ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  // Access control: null until /api/auth/me answers, so nothing flashes first.
  const [auth, setAuth] = useState<AuthState | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      setAuth(await res.json());
    } catch {
      setAuth({ authRequired: false, authenticated: true });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Navigation
  const [activeTab, setActiveTab] = useState<'liveTracker' | 'activeDisruptions' | 'config'>('liveTracker');

  // Core Data
  const [disruptions, setDisruptions] = useState<Disruption[]>(INITIAL_DISRUPTIONS);
  const [outlets, setOutlets] = useState<OutletMaster[]>(INITIAL_OUTLETS);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSyncTime: '08/09/2026 11:30:00',
    lastAttemptedTime: '08/09/2026 11:30:00',
    status: 'Success',
    recordsCount: INITIAL_OUTLETS.length,
    errorDetails: null,
  });

  // Current logged in operator (CC POC)
  const [currentUser, setCurrentUser] = useState<string>('Chirag');

  // UI state
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncSheetModalOpen, setIsSyncSheetModalOpen] = useState(false);
  const [selectedDisruptionForUpdate, setSelectedDisruptionForUpdate] = useState<Disruption | null>(null);
  const [selectedDisruptionForHistory, setSelectedDisruptionForHistory] = useState<Disruption | null>(null);
  const [toastMessage, setToastMessage] = useState<{ title: string; desc?: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (title: string, desc?: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ title, desc, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Load initial data
  const loadInitialData = useCallback(async () => {
    try {
      const [fetchedDisruptions, fetchedOutlets, fetchedConfig, fetchedStatus] = await Promise.all([
        fetchDisruptions(),
        fetchOutlets(),
        fetchConfig(),
        fetchSyncStatus(),
      ]);

      if (fetchedDisruptions && fetchedDisruptions.length > 0) {
        setDisruptions(fetchedDisruptions);
      }
      if (fetchedOutlets && fetchedOutlets.length > 0) {
        setOutlets(fetchedOutlets);
      }
      if (fetchedConfig) {
        setConfig(fetchedConfig);
        if (fetchedConfig.ccPocOptions?.length > 0 && !fetchedConfig.ccPocOptions.includes(currentUser)) {
          setCurrentUser(fetchedConfig.ccPocOptions[0]);
        }
      }
      if (fetchedStatus) {
        setSyncStatus(fetchedStatus);
      }
    } catch (err) {
      console.warn('Error loading initial data:', err);
    }
  }, [currentUser]);

  useEffect(() => {
    // Wait for the auth answer so a gated app does not fire 401s on load.
    if (!auth || (auth.authRequired && !auth.authenticated)) return;
    loadInitialData();
  }, [loadInitialData, auth]);

  // Periodic polling for multi-user operational sync
  useEffect(() => {
    if (!auth || (auth.authRequired && !auth.authenticated)) return;
    const pollInterval = setInterval(async () => {
      try {
        const [dList, sStatus] = await Promise.all([
          fetchDisruptions(),
          fetchSyncStatus(),
        ]);
        if (dList) setDisruptions(dList);
        if (sStatus) setSyncStatus(sStatus);
      } catch {
        // silent polling catch
      }
    }, 8000);

    return () => clearInterval(pollInterval);
  }, [auth]);

  // Manual Sync Now handler
  const handleSyncNow = async () => {
    setIsSyncing(true);
    showToast('Sync in Progress', 'Connecting to Google Sheets master source...', 'info');
    try {
      const res = await triggerSyncNow();
      if (res.status) {
        setSyncStatus(res.status);
      }
      if (res.success) {
        const updatedOutlets = await fetchOutlets();
        setOutlets(updatedOutlets);
        showToast('Sync Successful', `Fetched ${res.count} master outlet records.`, 'success');
      } else {
        showToast('Sync Failed', res.error || 'Check Google Sheet URL and permissions.', 'error');
      }
    } catch (err: any) {
      showToast('Sync Error', err.message || 'Network error while syncing.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Config save handler
  const handleSaveConfig = async (updatedConfig: AppConfig) => {
    const saved = await updateConfig(updatedConfig);
    setConfig(saved);
    showToast('Configuration Saved', 'Master settings and sync rules updated.', 'success');
  };

  // Direct CSV bulk upload handler
  const handleBulkUploadOutlets = async (newOutlets: OutletMaster[]) => {
    try {
      const res = await bulkUploadOutlets(newOutlets);
      if (res.success) {
        setOutlets(newOutlets);
        if (res.status) setSyncStatus(res.status);
        showToast('Master Outlets Updated', `${newOutlets.length} outlets loaded to cache.`, 'success');
      }
    } catch (err: any) {
      showToast('Upload Error', err.message || 'Failed to save outlets', 'error');
      throw err;
    }
  };

  // Callback when a new disruption is created in the form
  const handleDisruptionCreated = (newDisruption: Disruption) => {
    setDisruptions((prev) => [newDisruption, ...prev]);
    showToast('Disruption Created', `Incident ${newDisruption.disruptionId} is now live.`, 'success');
  };

  // Callback when a disruption is updated via Live Update modal or History edit
  const handleDisruptionUpdated = (updatedDisruption: Disruption) => {
    setDisruptions((prev) =>
      prev.map((d) => (d.disruptionId === updatedDisruption.disruptionId ? updatedDisruption : d))
    );
    showToast('Update Logged', `Audit trail refreshed for ${updatedDisruption.disruptionId}`, 'success');
  };

  // Calculate live active count using strict rule
  const activeCount = disruptions.filter((d) => isDisruptionActive(d.currentStatus)).length;

  if (auth === null) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center text-xs text-slate-500 font-sans">
        Loading console...
      </div>
    );
  }

  if (auth.authRequired && !auth.authenticated) {
    return <LoginScreen onSignedIn={refreshAuth} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          id="system-toast-notification"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg shadow-xl border flex items-start gap-3 transition-all animate-in slide-in-from-bottom-3 ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 text-white border-emerald-500/50'
              : toastMessage.type === 'error'
              ? 'bg-slate-900 text-white border-rose-500/50'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          <div className="text-xs">
            <span
              className={`font-bold block ${
                toastMessage.type === 'success'
                  ? 'text-emerald-400'
                  : toastMessage.type === 'error'
                  ? 'text-rose-400'
                  : 'text-amber-400'
              }`}
            >
              {toastMessage.title}
            </span>
            {toastMessage.desc && <span className="text-slate-300 text-[11px]">{toastMessage.desc}</span>}
          </div>
        </div>
      )}

      {/* Main Operational Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        syncStatus={syncStatus}
        isSyncing={isSyncing}
        onSyncNow={handleSyncNow}
        onOpenConfig={() => setActiveTab('config')}
        currentUser={currentUser}
        onSelectUser={setCurrentUser}
        userOptions={config.ccPocOptions}
        activeCount={activeCount}
        totalCount={disruptions.length}
      />

      {/* Main App Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* TAB 1: LIVE TRACKER */}
        {activeTab === 'liveTracker' && (
          <div className="space-y-8">
            {/* Form */}
            <LiveTrackerForm
              outlets={outlets}
              ccPocOptions={config.ccPocOptions}
              issueMaster={config.issueMaster}
              currentUser={currentUser}
              existingDisruptions={disruptions}
              onSubmitSuccess={handleDisruptionCreated}
              onOpenSyncModal={() => setIsSyncSheetModalOpen(true)}
            />

            {/* Live Table */}
            <LiveTrackerTable
              disruptions={disruptions}
              onOpenLiveUpdate={setSelectedDisruptionForUpdate}
              onOpenHistory={setSelectedDisruptionForHistory}
            />
          </div>
        )}

        {/* TAB 2: LIVE ACTIVE DISRUPTIONS */}
        {activeTab === 'activeDisruptions' && (
          <ActiveDisruptionsView
            allDisruptions={disruptions}
            onOpenLiveUpdate={setSelectedDisruptionForUpdate}
            onOpenHistory={setSelectedDisruptionForHistory}
            onRefreshData={loadInitialData}
          />
        )}

        {/* TAB 3: GOOGLE SHEET & CONFIG */}
        {activeTab === 'config' && (
          <ConfigView
            config={config}
            syncStatus={syncStatus}
            outlets={outlets}
            isSyncing={isSyncing}
            onSaveConfig={handleSaveConfig}
            onSyncNow={handleSyncNow}
            onBulkUploadOutlets={handleBulkUploadOutlets}
          />
        )}
      </main>

      {/* Operational Modal: Add Live Update */}
      {selectedDisruptionForUpdate && (
        <LiveUpdateModal
          disruption={selectedDisruptionForUpdate}
          currentUser={currentUser}
          issueMaster={config.issueMaster}
          onClose={() => setSelectedDisruptionForUpdate(null)}
          onSuccess={(updated) => {
            handleDisruptionUpdated(updated);
            setSelectedDisruptionForUpdate(null);
          }}
        />
      )}

      {/* Operational Modal: Full Update History & Audit Trail */}
      {selectedDisruptionForHistory && (
        <UpdateHistoryModal
          disruption={selectedDisruptionForHistory}
          currentUser={currentUser}
          onClose={() => setSelectedDisruptionForHistory(null)}
          onDisruptionUpdated={(updated) => {
            handleDisruptionUpdated(updated);
          }}
        />
      )}

      {/* Full Google Sheet Sync / Paste Modal */}
      <SyncSheetModal
        isOpen={isSyncSheetModalOpen}
        onClose={() => setIsSyncSheetModalOpen(false)}
        syncStatus={syncStatus}
        isSyncing={isSyncing}
        onSyncNow={handleSyncNow}
        onBulkUploadOutlets={handleBulkUploadOutlets}
        sheetUrl={config.googleSheetUrl}
        tabName={config.sheetTabName}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Disruption Management System • Operations Console</span>
          <span className="font-mono text-[11px] text-slate-400">
            Current Operator: {currentUser} | Timezone: Asia/Kolkata (IST)
          </span>
        </div>
      </footer>
    </div>
  );
}
