/**
 * Disruption Management System
 * Production-ready operational incident tracking, master data sync, and active reporting.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { setSessionToken } from './services/session';
import { AppTab, Header } from './components/Header';
import { LiveTrackerForm } from './components/LiveTrackerForm';
import { LiveTrackerTable } from './components/LiveTrackerTable';
import { ActiveDisruptionsView } from './components/ActiveDisruptionsView';
import { ConfigView } from './components/ConfigView';
import { PerformanceSummaryView } from './components/PerformanceSummaryView';
import { WeeklyDisruptionReport } from './components/WeeklyDisruptionReport';
import { LiveUpdateModal } from './components/LiveUpdateModal';
import { UpdateHistoryModal } from './components/UpdateHistoryModal';
import { SyncSheetModal } from './components/SyncSheetModal';
import {
  AppConfig,
  AuthState,
  Disruption,
  isDisruptionActive,
  OutletMaster,
  SessionUser,
  SheetSourceKey,
  SHEET_SOURCE_KEYS,
  SHEET_SOURCE_LABELS,
  SyncStatus,
  SyncStatuses,
  statusOptionsFrom,
} from './types';
import {
  fetchConfig,
  fetchDisruptions,
  fetchOutlets,
  fetchSyncStatus,
  fetchSyncStatuses,
  syncAllSources,
  triggerSourceSync,
  uploadSourceCsv,
  updateConfig,
  bulkUploadOutlets,
  deleteDisruption,
} from './services/api';
import { DEFAULT_CONFIG, INITIAL_OUTLETS } from './data/defaultConfig';
import { INITIAL_DISRUPTIONS } from './data/initialDisruptions';

/** Sign-in gate. Only work addresses on the allowed domains get through. */
function LoginScreen({ auth, onSignedIn }: { auth: AuthState; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const domainHint = auth.allowedDomains.map((d) => `@${d}`).join(' or ');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(data.error || `Sign in failed (HTTP ${res.status}).`);
      }
      setPassword('');

      // Hold the token so later calls can carry it in a header; the cookie the
      // server also set does not survive the hop back in.
      if (data.token) setSessionToken(data.token);

      // Confirm the session actually took before leaving the form, so a
      // rejected token shows as a message instead of a blank sign-in screen.
      const check = await fetch('/api/auth/me').then((r) => r.json()).catch(() => null);
      if (!check?.authenticated) {
        throw new Error(
          'Signed in, but the session could not be stored. Allow site data for this page, then reload and try again.'
        );
      }
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
            <p className="text-xs text-slate-400">Sign in with your work email</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">{error}</div>
          )}

          <div>
            <label htmlFor="app-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Work Email
            </label>
            <input
              id="app-email"
              type="email"
              autoComplete="username"
              placeholder={`name${auth.allowedDomains[0] ? '@' + auth.allowedDomains[0] : ''}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
              required
            />
            <p className="mt-1 text-[11px] text-slate-500">Only {domainHint} addresses are allowed.</p>
          </div>

          {auth.passwordRequired && (
            <div>
              <label htmlFor="app-password" className="block text-xs font-semibold text-slate-700 mb-1">
                Team Password
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
          )}

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
      setAuth({ authenticated: false, passwordRequired: false, allowedDomains: [], user: null });
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setSessionToken(null);
      refreshAuth();
    }
  }, [refreshAuth]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Navigation
  const [activeTab, setActiveTab] = useState<AppTab>('liveTracker');

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
  // The three feeds report independently; the header keeps showing the master.
  const [syncStatuses, setSyncStatuses] = useState<SyncStatuses>({
    outletMaster: {
      lastSyncTime: '08/09/2026 11:30:00',
      lastAttemptedTime: '08/09/2026 11:30:00',
      status: 'Success',
      recordsCount: INITIAL_OUTLETS.length,
      errorDetails: null,
    },
    disruptionTimings: {
      lastSyncTime: null,
      lastAttemptedTime: null,
      status: 'Idle',
      recordsCount: 0,
      errorDetails: null,
    },
    tickets: {
      lastSyncTime: null,
      lastAttemptedTime: null,
      status: 'Idle',
      recordsCount: 0,
      errorDetails: null,
    },
  });
  const [syncingSource, setSyncingSource] = useState<SheetSourceKey | null>(null);

  // The CC POC is whoever is signed in — never typed in by hand.
  const sessionUser: SessionUser | null = auth?.user ?? null;
  const currentUser = sessionUser?.name ?? '';
  const isOwner = sessionUser?.role === 'owner';
  // One place decides the list, so the form and the modal cannot disagree.
  const configuredStatusOptions = useMemo(() => statusOptionsFrom(config), [config]);

  /** Saves a corrected display name; it is what shows up in the CC POC column. */
  const handleSaveProfile = async (name: string, contact: string) => {
    const res = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('Could Not Save Name', data.error || 'Please try again.', 'error');
      return;
    }
    setAuth((prev) => (prev ? { ...prev, user: data.user } : prev));
    showToast('Name Updated', `You will appear as "${data.user.name}" on new entries.`, 'success');
  };

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
      const [fetchedDisruptions, fetchedOutlets, fetchedConfig, fetchedStatus, fetchedStatuses] =
        await Promise.all([
          fetchDisruptions(),
          fetchOutlets(),
          fetchConfig(),
          fetchSyncStatus(),
          fetchSyncStatuses(),
        ]);

      if (fetchedDisruptions && fetchedDisruptions.length > 0) {
        setDisruptions(fetchedDisruptions);
      }
      if (fetchedOutlets && fetchedOutlets.length > 0) {
        setOutlets(fetchedOutlets);
      }
      if (fetchedConfig) {
        setConfig(fetchedConfig);
      }
      if (fetchedStatus) {
        setSyncStatus(fetchedStatus);
      }
      if (fetchedStatuses) {
        setSyncStatuses(fetchedStatuses);
      }
    } catch (err) {
      console.warn('Error loading initial data:', err);
    }
  }, []);

  useEffect(() => {
    // Wait for the auth answer so a gated app does not fire 401s on load.
    if (!auth?.authenticated) return;
    loadInitialData();
  }, [loadInitialData, auth]);

  // Periodic polling for multi-user operational sync
  useEffect(() => {
    if (!auth?.authenticated) return;
    const pollInterval = setInterval(async () => {
      try {
        const [dList, sStatus, sStatuses] = await Promise.all([
          fetchDisruptions(),
          fetchSyncStatus(),
          fetchSyncStatuses(),
        ]);
        if (dList) setDisruptions(dList);
        if (sStatus) setSyncStatus(sStatus);
        if (sStatuses) setSyncStatuses(sStatuses);
      } catch {
        // silent polling catch
      }
    }, 8000);

    return () => clearInterval(pollInterval);
  }, [auth]);

  /**
   * The top-level Sync Now runs every enabled feed. Individual feeds also have
   * their own button in Settings for when only one sheet has moved.
   */
  const handleSyncNow = async () => {
    setIsSyncing(true);
    showToast('Sync in Progress', 'Pulling every enabled sheet feed...', 'info');
    try {
      const res = await syncAllSources();
      if (res.statuses) {
        setSyncStatuses(res.statuses);
        setSyncStatus(res.statuses.outletMaster);
      }
      const [updatedOutlets, updatedDisruptions] = await Promise.all([fetchOutlets(), fetchDisruptions()]);
      setOutlets(updatedOutlets);
      if (updatedDisruptions) setDisruptions(updatedDisruptions);

      const failed = SHEET_SOURCE_KEYS.filter((k) => res.statuses?.[k]?.status === 'Failed');
      if (failed.length > 0) {
        showToast(
          'Some Feeds Failed',
          `${failed.map((k) => SHEET_SOURCE_LABELS[k]).join(', ')} — check the sheet link and sharing.`,
          'error'
        );
      } else {
        showToast('Sync Complete', `${updatedOutlets.length} outlets cached.`, 'success');
      }
    } catch (err: any) {
      showToast('Sync Error', err.message || 'Network error while syncing.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  /** Manual sync of one feed. Each reports on its own, success or failure. */
  const handleSyncSource = async (key: SheetSourceKey) => {
    setSyncingSource(key);
    try {
      const res = await triggerSourceSync(key);
      if (res.status) {
        setSyncStatuses((prev) => ({ ...prev, [key]: res.status }));
        if (key === 'outletMaster') setSyncStatus(res.status);
      }
      if (res.success) {
        if (key === 'outletMaster') setOutlets(await fetchOutlets());
        else setDisruptions(await fetchDisruptions());
        showToast(`${SHEET_SOURCE_LABELS[key]} Synced`, `${res.count} rows applied.`, 'success');
      } else {
        showToast(`${SHEET_SOURCE_LABELS[key]} Sync Failed`, res.error || 'Check the sheet link and sharing.', 'error');
      }
    } finally {
      setSyncingSource(null);
    }
  };

  /** Paste path for the timing and ticket feeds. */
  const handleUploadSourceCsv = async (key: SheetSourceKey, csvText: string) => {
    const res = await uploadSourceCsv(key, csvText);
    if (res.status) {
      setSyncStatuses((prev) => ({ ...prev, [key]: res.status }));
    }
    setDisruptions(await fetchDisruptions());
    showToast(`${SHEET_SOURCE_LABELS[key]} Updated`, `${res.count} rows applied.`, 'success');
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
        if (res.status) {
          setSyncStatus(res.status);
          setSyncStatuses((prev) => ({ ...prev, outletMaster: res.status }));
        }
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

  /** Owner-only removal of a wrong entry. */
  const handleDeleteDisruption = async (target: Disruption) => {
    try {
      await deleteDisruption(target.disruptionId);
      setDisruptions((prev) => prev.filter((d) => d.disruptionId !== target.disruptionId));
      showToast('Entry Deleted', `${target.disruptionId} has been removed.`, 'success');
    } catch (err: any) {
      showToast('Delete Failed', err.message || 'Could not delete this entry.', 'error');
    }
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

  if (!auth.authenticated) {
    return <LoginScreen auth={auth} onSignedIn={refreshAuth} />;
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
        sessionUser={sessionUser}
        onSaveProfile={handleSaveProfile}
        onSignOut={handleSignOut}
        activeCount={activeCount}
        totalCount={disruptions.length}
      />

      {/* Main App Body — full desktop width, no 1280px cap. */}
      <main className="flex-1 w-full px-4 sm:px-6 xl:px-8 py-6">
        {/* TAB 1: LIVE TRACKER */}
        {activeTab === 'liveTracker' && (
          <div className="space-y-8">
            {/* Form */}
            <LiveTrackerForm
              outlets={outlets}
              issueMaster={config.issueMaster}
              statusOptions={configuredStatusOptions}
              currentUser={currentUser}
              currentUserEmail={sessionUser?.email ?? ''}
              existingDisruptions={disruptions}
              onSubmitSuccess={handleDisruptionCreated}
              onOpenSyncModal={() => setIsSyncSheetModalOpen(true)}
            />

            {/* Live Table */}
            <LiveTrackerTable
              disruptions={disruptions}
              onOpenLiveUpdate={setSelectedDisruptionForUpdate}
              onOpenHistory={setSelectedDisruptionForHistory}
              isOwner={isOwner}
              onDeleteDisruption={handleDeleteDisruption}
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

        {/* TAB 3: DATE-WISE PERFORMANCE SUMMARY */}
        {activeTab === 'weekly' && <WeeklyDisruptionReport disruptions={disruptions} />}

        {activeTab === 'summary' && <PerformanceSummaryView disruptions={disruptions} />}

        {/* TAB 4: GOOGLE SHEET & CONFIG */}
        {activeTab === 'config' && (
          <ConfigView
            config={config}
            syncStatus={syncStatus}
            syncStatuses={syncStatuses}
            outlets={outlets}
            isSyncing={isSyncing}
            syncingSource={syncingSource}
            isOwner={isOwner}
            onSaveConfig={handleSaveConfig}
            onSyncNow={handleSyncNow}
            onSyncSource={handleSyncSource}
            onUploadSourceCsv={handleUploadSourceCsv}
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
          statusOptions={configuredStatusOptions}
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
        <div className="w-full px-4 sm:px-6 xl:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Disruption Management System • Operations Console</span>
          <span className="font-mono text-[11px] text-slate-400">
            Signed in as {sessionUser?.email ?? 'unknown'} | Timezone: Asia/Kolkata (IST)
          </span>
        </div>
      </footer>
    </div>
  );
}
