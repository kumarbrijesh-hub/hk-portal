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

export const INACTIVE_STATUSES: CurrentStatus[] = [
  'Resolved by RAC',
  'Resolved by OEM',
  'Resolved by CC',
  'Disable',
];

export function isDisruptionActive(status: CurrentStatus | string): boolean {
  return !INACTIVE_STATUSES.includes(status as CurrentStatus);
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

  /** First response time in minutes, entered by the operator. */
  ccFrtMins?: number;
  mstFrtMins?: number;

  disruptionStartDateTime: string; // DD/MM/YYYY HH:MM:SS
  disruptionStartDate: string; // YYYY-MM-DD
  disruptionStartTime: string; // HH:MM:SS
  ccPoc: string;
  bucket: BucketType;
  ticketId?: string;
  currentStatus: CurrentStatus;
  issue?: string;
  subIssue?: string;
  latestLiveUpdate: string;
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
  googleSheetUrl: string;
  sheetTabName: string;
  syncIntervalMinutes: number;
  columnMapping: ColumnMapping;
  ccPocOptions: string[];
  issueMaster: Record<string, string[]>;
  autoSyncEnabled: boolean;
}
