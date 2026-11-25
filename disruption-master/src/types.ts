export type BucketType = 'False Alarm / Invalid' | 'Non Breakdown' | 'Breakdown';

/**
 * The bucket dropdown, in the order it is offered. Shared by the create form
 * and the post-creation edit so the two lists cannot drift apart.
 */
export const BUCKET_OPTIONS: BucketType[] = ['Breakdown', 'Non Breakdown', 'False Alarm / Invalid'];

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
  | 'Non-Admin Issue'
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
  'Non-Admin Issue',
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

/**
 * Statuses the app's own logic keys off. An admin can add to the status list
 * and rename or remove anything they added, but these cannot be renamed or
 * removed: the audit reminder, the sub-issue requirement and the active/closed
 * split all match on the exact wording, so changing one would quietly stop that
 * behaviour rather than fail loudly.
 */
export const PROTECTED_STATUS_REASONS: Record<string, string> = {
  'Resolved by RAC': 'Closes the disruption and requires a sub-issue',
  'Resolved by OEM': 'Closes the disruption and requires the OEM coverage',
  'Resolved by CC': 'Closes the disruption and requires a sub-issue',
  'Resolved by Dealer': 'Requires a sub-issue',
  Disable: 'Closes the disruption',
  'Auto Disable': 'Moves the record to the Auto Disabled page',
  'Audit in Process': 'Starts the 2.5-hour audit reminder',
};

export const PROTECTED_STATUSES: string[] = Object.keys(PROTECTED_STATUS_REASONS);

export function isProtectedStatus(status: string): boolean {
  return PROTECTED_STATUSES.includes(status);
}

/** Status that stamps each step, so timings can be derived from transitions. */
export const STEP_STAMP_FIELDS: Record<string, 'racAlignedAt' | 'racVisitedAt' | 'oemAlignedAt' | 'oemVisitedAt'> = {
  'RAC Aligned': 'racAlignedAt',
  'RAC Visited': 'racVisitedAt',
  'OEM Aligned': 'oemAlignedAt',
  'OEM Visited': 'oemVisitedAt',
};

/** Which party a resolving status credits, for the resolution TAT breakdown. */
export const RESOLVED_BY_FOR_STATUS: Record<string, 'RAC' | 'OEM' | 'Dealer' | 'CC'> = {
  'Resolved by RAC': 'RAC',
  'Resolved by OEM': 'OEM',
  'Resolved by Dealer': 'Dealer',
  'Resolved by CC': 'CC',
};

/**
 * The status that needs the RAC arrival time entered. Only the person setting
 * it knows how long the technician took, so it is asked for there and nowhere
 * else.
 */
export const STATUS_REQUIRING_RAC_FRT = 'RAC Visited';

/**
 * How an OEM job was paid for.
 *
 * Asked only when a disruption is closed as Resolved by OEM, because that is
 * the moment - and the only moment - when anyone knows the answer. Afterwards
 * the ticket is shut and the commercial question ("was this on us, on the AMC,
 * or on the warranty?") has no reliable source left.
 *
 * Distinct from the outlet's `amcCoverage`, which is what the store master says
 * about the machine in general. This is what actually happened on this job.
 */
export type OemCoverage = 'AMC' | 'PI-PO' | 'Warranty';

export const OEM_COVERAGE_OPTIONS: OemCoverage[] = ['AMC', 'PI-PO', 'Warranty'];

/** The one status that cannot be set without the coverage being recorded. */
export const STATUS_REQUIRING_OEM_COVERAGE = 'Resolved by OEM';

export function requiresOemCoverage(status: CurrentStatus | string): boolean {
  return status === STATUS_REQUIRING_OEM_COVERAGE;
}

export function isOemCoverage(value: unknown): value is OemCoverage {
  return typeof value === 'string' && (OEM_COVERAGE_OPTIONS as string[]).includes(value);
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

/**
 * The parked state. A store that auto-disables is not resolved - the fault is
 * still there and the ticket is still open - but it is also not something the
 * team is working this minute, so it does not belong on the Active board
 * competing for attention with live breakdowns.
 *
 * It is deliberately NOT in INACTIVE_STATUSES: that list means closed, and
 * putting it there would drop these records out of the counts, the performance
 * summary and the reports as though the disruption had ended.
 */
export const AUTO_DISABLE_STATUS = 'Auto Disable';

export function isAutoDisabled(status: CurrentStatus | string): boolean {
  return status === AUTO_DISABLE_STATUS;
}

/**
 * On the Active board: open, and not parked on auto-disable. Moving a parked
 * record to any other open status - RAC Aligned, RAC Visited, OEM, anything the
 * team adds - brings it straight back here, because the test is the absence of
 * the parked status rather than a list of statuses to come back on.
 */
export function isOnActiveBoard(status: CurrentStatus | string): boolean {
  return isDisruptionActive(status) && !isAutoDisabled(status);
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

  /**
   * CC first response, in minutes. Derived, never typed: the gap between when
   * the disruption started and when CC logged it.
   */
  ccFrtMins?: number;
  /**
   * How long the RAC technician took to reach site, in minutes. Asked for once,
   * when the record first reaches RAC Visited, because only the person closing
   * that step knows it.
   */
  mstFrtMins?: number;

  /**
   * When the record entered each step. Stamped the first time that status is
   * set and then left alone, so a status being set twice does not move it.
   */
  racAlignedAt?: string;
  racVisitedAt?: string;
  oemAlignedAt?: string;
  oemVisitedAt?: string;

  /**
   * OEM first response, in hours: OEM Visited minus OEM Aligned. Unlike the RAC
   * figure this is never typed - both ends are timestamps the app already has.
   */
  oemFrtHours?: number;

  /** When a resolving status was first set, and who it credited. */
  resolvedAt?: string;
  resolvedBy?: 'RAC' | 'OEM' | 'Dealer' | 'CC';
  /**
   * How the OEM job was covered - AMC, PI-PO or Warranty. Mandatory on the
   * update that closes the disruption as Resolved by OEM, and empty on every
   * record that was never resolved by OEM.
   */
  oemCoverage?: OemCoverage | '';
  /** Hours from the disruption starting to it being resolved. */
  resolutionTatHours?: number;

  /**
   * When the record was last put on an audit hold (IST, DD/MM/YYYY HH:MM:SS).
   * Cleared when the status moves off audit. Drives the 2.5-hour reminder.
   */
  auditStartedAt?: string;

  disruptionStartDateTime: string; // DD/MM/YYYY HH:MM:SS
  disruptionStartDate: string; // YYYY-MM-DD
  disruptionStartTime: string; // HH:MM:SS
  ccPoc: string;
  /** '' when the operator has not picked one yet; shown as a red 'Not set' chip. */
  bucket: BucketType | '';
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
  /**
   * The Current Status dropdown, editable by an admin. Absent on configurations
   * saved before it existed, which is why readers go through
   * `statusOptionsFrom`.
   */
  statusOptions?: string[];
  autoSyncEnabled: boolean;
  /** The three feeds, each with its own sheet, tab and on/off switch. */
  sources: SheetSources;
}

/**
 * The status list to show. Falls back to the built-in list for configurations
 * saved before the list became editable, and always keeps the protected
 * statuses present even if a stored list somehow lost one.
 */
export function statusOptionsFrom(config?: { statusOptions?: string[] }): string[] {
  const stored = (config?.statusOptions ?? []).map((s) => s.trim()).filter(Boolean);
  const list = stored.length > 0 ? [...stored] : [...CURRENT_STATUS_OPTIONS];
  for (const required of PROTECTED_STATUSES) {
    if (!list.includes(required)) list.push(required);
  }
  return list;
}

/**
 * The two feeds that look a disruption up by its ID. The store master does not
 * appear here: it is keyed by outlet, so an ID can never fail to match it.
 */
export type IdMatchFeedKey = 'disruptionTimings' | 'tickets';

/**
 * A sheet row whose Disruption ID matches no record here.
 *
 * Both ID-keyed feeds used to skip these rows in silence, which is how a sheet
 * and this console can disagree for weeks without anything saying so. The row
 * is kept as the sheet wrote it - the ID is not corrected or guessed at - so
 * the page can show the two spellings side by side.
 */
export interface UnmatchedSheetId {
  feed: IdMatchFeedKey;
  /** Exactly as the sheet spells it, trimmed only. */
  sheetDisruptionId: string;
  /** Whatever else that row carried, for recognising which incident it is. */
  ticketId: string;
  ticketStatus: string;
  endTime: string;
  /** IST stamp of the sync or upload that last saw this row. */
  seenAt: string;
}

/**
 * A sheet row whose Disruption ID DID find a record here.
 *
 * Kept for one reason: a page that lists only the failures cannot answer "did
 * my upload work". Reading a short list of mismatches told nobody whether the
 * other nine hundred rows had landed or whether the file had been ignored
 * wholesale, which is exactly the doubt that made people upload the sheet again
 * and again.
 */
export interface MatchedSheetId {
  feed: IdMatchFeedKey;
  /** Exactly as the sheet spells it, trimmed only. */
  sheetDisruptionId: string;
  /** The record it hit, which may be spelled differently in case. */
  disruptionId: string;
  outletId: string;
  storeName: string;
  city: string;
  ticketId: string;
  ticketStatus: string;
  endTime: string;
  /**
   * Whether the row actually changed anything here. A matched row that changed
   * nothing is the normal steady state, not a problem - but it is a different
   * answer from "this row updated the record", and the page says which.
   */
  applied: boolean;
  seenAt: string;
}

export interface IdMatchFeedTally {
  matched: number;
  unmatched: number;
  /** Matched rows that changed a value here. */
  applied: number;
}

export interface IdMatchReport {
  rows: UnmatchedSheetId[];
  /**
   * Matched rows, newest scan only, capped for transport - `tally` carries the
   * true counts, so a sheet bigger than the cap still reports honestly.
   */
  matched: MatchedSheetId[];
  /** Per-feed counts over the whole of the last scan, uncapped. */
  tally: Record<IdMatchFeedKey, IdMatchFeedTally>;
  /** How many matched rows the list was capped at, or null when it was not. */
  matchedListCappedAt: number | null;
  /** IST stamp of the last feed run, or null if none has run since boot. */
  lastCheckedAt: string | null;
  /** Which of the two feeds has been read since boot. */
  checkedFeeds: IdMatchFeedKey[];
}

/** How an app record should be re-pointed at a sheet's Disruption ID. */
export type IdAlignMode = 'align' | 'idOnly';
