import { AppConfig, Disruption, DisruptionUpdateHistory, OutletMaster, SyncStatus } from '../types';
import { DEFAULT_CONFIG, INITIAL_OUTLETS } from '../data/defaultConfig';
import { INITIAL_DISRUPTIONS } from '../data/initialDisruptions';

const API_BASE = '/api';

export async function fetchOutlets(searchQuery = ''): Promise<OutletMaster[]> {
  try {
    const res = await fetch(`${API_BASE}/outlets${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''}`);
    if (res.ok) {
      const data = await res.json();
      return data.outlets || [];
    }
  } catch (err) {
    console.warn('API fetchOutlets failed, using fallback:', err);
  }
  // Local fallback
  return INITIAL_OUTLETS;
}

export async function fetchOutletById(outletId: string): Promise<OutletMaster | null> {
  try {
    const res = await fetch(`${API_BASE}/outlets/${encodeURIComponent(outletId)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('API fetchOutletById failed:', err);
  }
  const fallback = INITIAL_OUTLETS.find((o) => o.outletId.toUpperCase() === outletId.toUpperCase());
  return fallback || null;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  try {
    const res = await fetch(`${API_BASE}/sync/status`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('API fetchSyncStatus failed:', err);
  }
  return {
    lastSyncTime: '08/09/2026 11:30:00',
    lastAttemptedTime: '08/09/2026 11:30:00',
    status: 'Success',
    recordsCount: INITIAL_OUTLETS.length,
    errorDetails: null,
  };
}

export async function triggerSyncNow(): Promise<{ success: boolean; count: number; error?: string; status: SyncStatus }> {
  try {
    const res = await fetch(`${API_BASE}/sync/now`, { method: 'POST' });
    if (res.ok) {
      return await res.json();
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      error: err.message || 'Failed to sync with Google Sheet',
      status: {
        lastSyncTime: null,
        lastAttemptedTime: new Date().toLocaleTimeString(),
        status: 'Failed',
        recordsCount: 0,
        errorDetails: err.message,
      },
    };
  }
}

export async function fetchDisruptions(): Promise<Disruption[]> {
  try {
    const res = await fetch(`${API_BASE}/disruptions`);
    if (res.ok) {
      const data = await res.json();
      return data.disruptions || [];
    }
  } catch (err) {
    console.warn('API fetchDisruptions failed, using fallback:', err);
  }
  return INITIAL_DISRUPTIONS;
}

export async function createDisruption(disruptionData: Partial<Disruption>): Promise<{
  message: string;
  disruptionId: string;
  disruption: Disruption;
}> {
  const res = await fetch(`${API_BASE}/disruptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(disruptionData),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Failed with status ${res.status}` }));
    throw new Error(err.error || 'Failed to create disruption');
  }

  return await res.json();
}

export async function addLiveUpdate(
  disruptionId: string,
  payload: {
    updateText: string;
    updatedBy: string;
    newStatus?: string;
    issue?: string;
    subIssue?: string;
  }
): Promise<{ message: string; disruption: Disruption; newUpdate: DisruptionUpdateHistory }> {
  const res = await fetch(`${API_BASE}/disruptions/${encodeURIComponent(disruptionId)}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Failed with status ${res.status}` }));
    throw new Error(err.error || 'Failed to add live update');
  }

  return await res.json();
}

export async function editLiveUpdate(
  disruptionId: string,
  updateId: string,
  payload: {
    editedText: string;
    editedBy: string;
  }
): Promise<{ message: string; disruption: Disruption; updatedHistory: DisruptionUpdateHistory }> {
  const res = await fetch(
    `${API_BASE}/disruptions/${encodeURIComponent(disruptionId)}/updates/${encodeURIComponent(updateId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Failed with status ${res.status}` }));
    throw new Error(err.error || 'Failed to edit live update');
  }

  return await res.json();
}

export async function fetchConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('API fetchConfig failed, using fallback:', err);
  }
  return DEFAULT_CONFIG;
}

export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    throw new Error('Failed to update config');
  }

  const data = await res.json();
  return data.config;
}

export async function bulkUploadOutlets(outlets: OutletMaster[]): Promise<any> {
  const res = await fetch(`${API_BASE}/outlets/bulk-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outlets }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.details || `Failed to upload master outlets (${res.status})`);
  }

  return await res.json();
}
