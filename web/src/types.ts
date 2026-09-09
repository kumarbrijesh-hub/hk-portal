export interface Outlet {
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

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'operator' | 'admin';
}

export interface AppConfig {
  brand: { appName: string; reportTitle: string; timezone: string };
  ccPocOptions: string[];
  buckets: string[];
  bucketsRequiringTicketId: string[];
  statuses: string[];
  inactiveStatuses: string[];
  statusesRequiringIssue: string[];
  issueMaster: Record<string, string[]>;
  issueMasterPending: boolean;
  report: {
    secondarySectionTitle: string;
    secondarySectionStatuses: string[];
    breakdownBucket: string;
    nonBreakdownBucket: string;
  };
  sheet: {
    tab: string;
    syncIntervalMinutes: number;
    configured: boolean;
    missing: string[];
    authMode: 'service-account' | 'public-csv';
  };
  outletCount: number;
}

export interface SyncStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  status: 'never' | 'syncing' | 'success' | 'failed';
  recordCount: number;
  error: string | null;
  durationMs: number | null;
  outletCount: number;
  intervalMinutes: number;
  missingConfig: string[];
}

export interface BucketSplit {
  breakdown: number | null;
  nonBreakdown: number | null;
}

export interface ReportStats {
  activeNow: number;
  activeSplit: BucketSplit;
  totalDurationHrs: number;
  totalDurationSplit: BucketSplit;
  totalDurationSharePct: BucketSplit;
  avgDurationHrs: number;
  avgDurationSplit: BucketSplit;
  avgMstFrtMins: number;
  avgMstFrtSplit: BucketSplit;
  avgCcFrtMins: number;
  avgCcFrtSplit: BucketSplit;
}

export interface DisruptionFilterValues {
  search: string;
  city: string;
  outletId: string;
  storeName: string;
  vendor: string;
  mode: string;
  ccPoc: string;
  bucket: string;
  currentStatus: string;
  date: string;
}

export const EMPTY_FILTERS: DisruptionFilterValues = {
  search: '', city: '', outletId: '', storeName: '', vendor: '',
  mode: '', ccPoc: '', bucket: '', currentStatus: '', date: '',
};
