export type BucketType = 'False Alarm / Invalid' | 'Non Breakdown' | 'Breakdown';

export type CurrentStatus =
  | 'No Update'
  | 'RAC Aligned'
  | 'RAC Visited'
  | 'OEM Aligned'
  | 'OEM Visited'
  | 'Resolved by RAC'
  | 'Resolved by OEM'
  | 'Resolved by Dealer'
  | 'Resolved by CC'
  | 'Auto Disable'
  | 'Known Admin Issue'
  | 'Disable'
  | 'Disruption'
  | 'Audit in Process';

export const CURRENT_STATUS_OPTIONS: CurrentStatus[] = [
  'No Update',
  'RAC Aligned',
  'RAC Visited',
  'OEM Aligned',
  'OEM Visited',
  'Resolved by RAC',
  'Resolved by OEM',
  'Resolved by Dealer',
  'Resolved by CC',
  'Auto Disable',
  'Known Admin Issue',
  'Disable',
  'Disruption',
  'Audit in Process',
];

export const RESOLVED_STATUSES_REQUIRING_ISSUE: CurrentStatus[] = [
  'Resolved by RAC',
  'Resolved by OEM',
  'Resolved by Dealer',
  'Resolved by CC',
];

/**
 * Statuses that put a store on an audit hold. Entering one stamps
 * `auditStartedAt`, and the hold is expected to come off within
 * AUDIT_HOLD_LIMIT_HOURS.
 */
export const AUDIT_STATUSES: CurrentStatus[] = ['Audit in Process'];

/** After this long on audit, the row is flagged so the team clears the hold. */
export const AUDIT_HOLD_LIMIT_HOURS = 2.5;

export function isAuditStatus(status: CurrentStatus | string): boolean {
  return AUDIT_STATUSES.includes(status as CurrentStatus);
}

export const INACTIVE_STATUSES: CurrentStatus[] = [
  'Resolved by RAC',
  'Resolved by OEM',
  'Resolved by CC',
  'Disable',
];

export function isDisruptionActive(status: CurrentStatus | string): boolean {
  return !INACTIVE_STATUSES.includes(status as CurrentStatus);
}

export type UserRole = 'owner' | 'member';

/** The signed-in operator, as reported by /api/auth/me. */
export interface SessionUser {
  email: string;
  name: string;
  contact: string;
  role: UserRole;
}

export interface AuthState {
  authenticated: boolean;
  passwordRequired: boolean;
  allowedDomains: string[];
  user: SessionUser | null;
}

export interface OutletMaster {
  outletId: string;
  storeName: string;
  city: string;
  mode: string;
  vendor: string;
  pocName: string; // Primary Cold POC Name-2
  pocContact: string; // Primary Cold POC Contact-2
  coldPocName2?: string;
  coldPocContact2?: string;
  // New Requested Master Columns
  amcCoverage?: string;
  currentVendor?: string; // Current Vendor (AMC or Warranty)
  lodL1Name?: string;
  lodL1Email?: string;
  lodL1Contact?: string;
  lodL2Name?: string;
  lodL2Email?: string;
  lodL2Contact?: string;
  lodL3Name?: string;
  lodL3Email?: string;
  lodL3Contact?: string;
  region?: string;
  mstRacName?: string;
  mstRacContact?: string;
  syncedAt?: string;
}

export interface DisruptionUpdateHistory {
  updateId: string;
  disruptionId: string;
  updateText: string;
  updatedBy: string;
  updatedAt: string;
  previousStatus: string;
  newStatus: string;
  originalText?: string;
  isEdited?: boolean;
  editedBy?: string;
  editedAt?: string;
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
  coldPocName2?: string;
  coldPocContact2?: string;
  // New Requested Columns
  amcCoverage?: string;
  currentVendor?: string; // Current Vendor (AMC or Warranty)
  lodL1Name?: string;
  lodL1Email?: string;
  lodL1Contact?: string;
  lodL2Name?: string;
  lodL2Email?: string;
  lodL2Contact?: string;
  lodL3Name?: string;
  lodL3Email?: string;
  lodL3Contact?: string;
  region?: string;
  mstRacName?: string;
  mstRacContact?: string;
  remark?: string;
  cityLead?: string;
  regionalHead?: string;
  week?: string;
  storeType?: string;
  shift?: string;
  ticketMissing?: string;
  parentTicketId?: string;
  endTime?: string;
  duration?: string;
  ticketClosedAt?: string;
  /** Ticket state as reported by the ticket sheet. */
  ticketStatus?: string;
  /**
   * Set once the ticket sheet reports the ticket closed. From then on the ticket
   * fields are frozen and later syncs leave them untouched.
   */
  ticketFrozenAt?: string;

  /** First response time in minutes, entered by the operator. */
  ccFrtMins?: number;
  mstFrtMins?: number;

  /**
   * When the record was last put on an audit hold (IST, DD/MM/YYYY HH:MM:SS).
   * Cleared when the status moves off audit. Drives the 2.5-hour reminder.
   */
  auditStartedAt?: string;

  disruptionStartDateTime: string; // DD/MM/YYYY HH:MM:SS
  disruptionStartDate: string; // YYYY-MM-DD
  disruptionStartTime: string; // HH:MM:SS
  ccPoc: string;
  bucket: BucketType;
  ticketId?: string;
  currentStatus: CurrentStatus;
  /**
   * Resolution taxonomy. Operators pick sub-issues only and several can apply
   * to one disruption; `issues` is derived from the master, never typed in.
   * `issue` / `subIssue` are the first of each, kept so older records and the
   * sheet export keep working.
   */
  issues?: string[];
  subIssues?: string[];
  issue?: string;
  subIssue?: string;
  latestLiveUpdate: string;
  /**
   * Shift-handover note for the team: which technician, which number, who to
   * call next. Deliberately kept out of every report and export, so it is the
   * one field that can carry context nobody outside the team should read.
   */
  internalRemarks?: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updateHistory: DisruptionUpdateHistory[];
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastAttemptedTime: string | null;
  status: 'Success' | 'Failed' | 'Syncing' | 'Idle';
  recordsCount: number;
  errorDetails: string | null;
  source?: string;
}

/**
 * The three independent sheet feeds. They are kept apart on purpose: store
 * details, disruption start/end timings and ticket state live in different
 * sheets maintained by different people, and one of them failing must not stop
 * the other two.
 */
export type SheetSourceKey = 'outletMaster' | 'disruptionTimings' | 'tickets';

export const SHEET_SOURCE_KEYS: SheetSourceKey[] = ['outletMaster', 'disruptionTimings', 'tickets'];

export const SHEET_SOURCE_LABELS: Record<SheetSourceKey, string> = {
  outletMaster: 'Store Master',
  disruptionTimings: 'Disruption Timings',
  tickets: 'Ticket Status',
};

export const SHEET_SOURCE_DESCRIPTIONS: Record<SheetSourceKey, string> = {
  outletMaster: 'Store name, city, mode, vendor, AMC and POC details against each outlet ID.',
  disruptionTimings: 'Disruption end time against each Disruption ID. Duration is calculated from the start.',
  tickets: 'Ticket ID, status and closure time. A closed ticket is frozen and later syncs leave it alone.',
};

export interface SheetSourceConfig {
  url: string;
  tabName: string;
  enabled: boolean;
}

export type SheetSources = Record<SheetSourceKey, SheetSourceConfig>;
export type SyncStatuses = Record<SheetSourceKey, SyncStatus>;

export interface ColumnMapping {
  outletId: string;
  storeName: string;
  city: string;
  mode: string;
  vendor: string;
  pocName: string;
  pocContact: string;
  amcCoverage?: string;
  currentVendor?: string;
  lodL1Name?: string;
  lodL1Email?: string;
  lodL1Contact?: string;
  lodL2Name?: string;
  lodL2Email?: string;
  lodL2Contact?: string;
  lodL3Name?: string;
  lodL3Email?: string;
  lodL3Contact?: string;
}

export interface AppConfig {
  /**
   * Store-master URL and tab. Retained alongside `sources.outletMaster`, which
   * mirrors them, so configurations saved before the split keep working.
   */
  googleSheetUrl: string;
  sheetTabName: string;
  syncIntervalMinutes: number;
  columnMapping: ColumnMapping;
  ccPocOptions: string[];
  issueMaster: Record<string, string[]>;
  autoSyncEnabled: boolean;
  /** The three feeds, each with its own sheet, tab and on/off switch. */
  sources: SheetSources;
}
