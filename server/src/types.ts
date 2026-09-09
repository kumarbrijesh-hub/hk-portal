export interface OutletMaster {
  outletId: string;
  storeName: string;
  city: string;
  mode: string;
  vendor: string;
  pocName: string;
  pocContact: string;
  syncedAt: string;
}

export interface Disruption {
  disruptionId: string;
  outletId: string;
  storeName: string;
  city: string;
  mode: string;
  vendor: string;
  pocName: string;
  pocContact: string;
  disruptionStartAt: string;
  ccPoc: string;
  bucket: string;
  ticketId: string | null;
  currentStatus: string;
  issue: string | null;
  subIssue: string | null;
  ccFrtMins: number | null;
  mstFrtMins: number | null;
  auditDurationHrs: number | null;
  resolvedAt: string | null;
  latestLiveUpdate: string;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  /** Wall-clock hours from start until resolution (or now, while still open). */
  durationHours: number;
}

export interface DisruptionUpdate {
  updateId: string;
  disruptionId: string;
  updateText: string;
  updatedBy: string;
  updatedAt: string;
  previousStatus: string | null;
  newStatus: string | null;
  originalText: string | null;
  editedText: string | null;
  editedBy: string | null;
  editedAt: string | null;
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  previousValue: string | null;
  newValue: string | null;
  actor: string;
  at: string;
}

export interface SyncState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  status: 'never' | 'syncing' | 'success' | 'failed';
  recordCount: number;
  error: string | null;
  durationMs: number | null;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'operator' | 'admin';
}

export interface DisruptionFilters {
  activeOnly?: boolean;
  search?: string;
  city?: string;
  outletId?: string;
  storeName?: string;
  vendor?: string;
  mode?: string;
  ccPoc?: string;
  bucket?: string;
  currentStatus?: string;
  /** IST calendar date, YYYY-MM-DD - matches on disruption start date. */
  date?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}
