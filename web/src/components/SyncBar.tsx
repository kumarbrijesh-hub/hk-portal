import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../state/AppContext';
import { formatIst, relativeAge } from '../utils/time';
import type { SyncStatus } from '../types';

const STATUS_TONE: Record<SyncStatus['status'], string> = {
  never: 'neutral',
  syncing: 'info',
  success: 'good',
  failed: 'critical',
};

const STATUS_LABEL: Record<SyncStatus['status'], string> = {
  never: 'Not synced yet',
  syncing: 'Syncing',
  success: 'Success',
  failed: 'Failed',
};

/** Header strip from spec section 23: last sync, status, record count, Sync Now. */
export function SyncBar() {
  const { revision, connected, refreshConfig } = useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warn'; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<SyncStatus>('/api/sync/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(load, [load, revision]);

  // Fallback poll in case an SSE frame is dropped by an intermediate proxy.
  useEffect(() => {
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const syncNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.post<{
        ok: boolean; recordCount: number; error?: string; warnings: string[];
      }>('/api/sync/now');
      setMessage(
        result.ok
          ? {
            tone: result.warnings.length ? 'warn' : 'success',
            text: `Synced ${result.recordCount} outlets.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`,
          }
          : { tone: 'error', text: result.error ?? 'Sync failed.' },
      );
      await refreshConfig();
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message });
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <>
      <div className="syncbar">
        <span className="item">
          Master data:
          <span className={`badge ${status ? STATUS_TONE[status.status] : 'neutral'}`}>
            {status ? STATUS_LABEL[status.status] : '…'}
          </span>
        </span>
        <span className="item">
          Last sync: <b>{status?.lastSuccessAt ? formatIst(status.lastSuccessAt) : '—'}</b>
          {status?.lastSuccessAt && <span className="hint">({relativeAge(status.lastSuccessAt)})</span>}
        </span>
        <span className="item">Records: <b>{status?.outletCount ?? 0}</b></span>
        <span className="item">Auto every <b>{status?.intervalMinutes ?? '—'} min</b></span>
        <span className="spacer" />
        <span className="item">
          Live:
          <span className={`badge ${connected ? 'good' : 'neutral'}`}>{connected ? 'Connected' : 'Reconnecting'}</span>
        </span>
        <button type="button" className="small" onClick={syncNow} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      {status?.missingConfig?.length ? (
        <div className="notice warn">
          <p>
            <strong>Google Sheet not configured yet.</strong> Master-data sync is on hold until these
            values are filled in <code>config/app.config.json</code>:{' '}
            {status.missingConfig.join(', ')}. Everything else in the app works meanwhile.
          </p>
        </div>
      ) : null}

      {status?.status === 'failed' && status.error && (
        <div className="notice error">
          <p><strong>Last sync failed.</strong> {status.error} The previously synced data is still in use.</p>
        </div>
      )}

      {message && (
        <div className={`notice ${message.tone === 'error' ? 'error' : message.tone === 'warn' ? 'warn' : 'success'}`}>
          <p>{message.text}</p>
        </div>
      )}
    </>
  );
}
