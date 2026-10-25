/**
 * What each feed's sheet must look like.
 *
 * This is the single source for both the in-app help and the downloadable
 * templates, so the two cannot drift apart. The column names here are the ones
 * the server's header matcher looks for; it matches case-insensitively and
 * ignores spaces and punctuation, and also accepts the listed alternatives, so
 * "Outlet ID", "outlet_id" and "OUTLET-ID" are all the same column.
 *
 * Column order does not matter. Extra columns are ignored. Only the header
 * wording matters, and only the required columns have to be present.
 */

export interface SheetColumnSpec {
  /** Header text to put in the sheet. */
  name: string;
  required: boolean;
  /** What goes in the cell. */
  description: string;
  /** Other header wordings the server will also accept. */
  alsoAccepts?: string[];
  /** A realistic value, used in the template's example row. */
  example: string;
}

export interface SheetFormatSpec {
  key: 'outletMaster' | 'disruptionTimings' | 'tickets' | 'historicalDisruptions';
  title: string;
  /** Default tab name the app looks for. */
  defaultTab: string;
  /** One line on what the feed is for. */
  purpose: string;
  /** How rows are matched to existing data. */
  matching: string;
  columns: SheetColumnSpec[];
  /** Anything that trips people up on this particular feed. */
  notes: string[];
}

/**
 * Accepted date/time wording, shared by every feed that takes a timestamp.
 * The parser reads DD/MM/YYYY by default and switches to YYYY-MM-DD when the
 * first number is four digits, so both work; the time part may be omitted.
 */
export const TIMESTAMP_FORMAT_HELP = [
  'DD/MM/YYYY HH:MM:SS — e.g. 25/10/2026 14:30:00',
  'DD/MM/YYYY HH:MM — e.g. 25/10/2026 14:30',
  'YYYY-MM-DD HH:MM:SS — e.g. 2026-10-25 14:30:00',
  'Date only is accepted and read as 00:00:00 — e.g. 25/10/2026',
];

export const TIMESTAMP_TIMEZONE_NOTE =
  'All times are read as IST (Asia/Kolkata). Do not add a timezone suffix.';


/**
 * One-off import of disruptions that were recorded outside the app - the
 * history kept in a spreadsheet before the app existed. Unlike the three sync
 * feeds this is not polled: it is pasted in once, so that the weekly count and
 * the performance reports cover those months too.
 */
export const HISTORICAL_DISRUPTIONS_FORMAT: SheetFormatSpec = {
  key: 'historicalDisruptions',
  title: 'Historical Disruptions (one-off import)',
  defaultTab: 'Disruptions',
  purpose:
    'Back-fills disruptions that were recorded before the app, so reports cover the full history rather than starting from the day the app went live.',
  matching:
    'Each row gets the same Disruption ID the app would have generated: OutletID-YYMMDDHHMM from the outlet and the start time. A row whose ID already exists is skipped, so running the same file twice cannot double-count.',
  columns: [
    {
      name: 'Outlet ID',
      required: true,
      description: 'Store code. Does not have to be in the current store master - a closed store still imports.',
      alsoAccepts: ['outlet_id', 'outletid', 'store id', 'store code'],
      example: '30322',
    },
    {
      name: 'Disruption Start Date',
      required: true,
      description: 'Date the disruption began. DD/MM/YYYY or YYYY-MM-DD.',
      alsoAccepts: ['start date', 'date', 'disruption date', 'outage date'],
      example: '14/05/2026',
    },
    {
      name: 'Disruption Start Time',
      required: true,
      description:
        'Time it began, HH:MM or HH:MM:SS. Strongly recommended: the Disruption ID is built down to the minute, so two disruptions on the same store with the same (or blank) time collapse into one record.',
      alsoAccepts: ['start time', 'time', 'outage time'],
      example: '09:15:00',
    },
    {
      name: 'End Time',
      required: false,
      description:
        'When the store came back up, date and time together. Duration is computed from the start - do not send a duration column, it is always derived.',
      alsoAccepts: ['end_time', 'disruption end time', 'closure time', 'resolved at', 'restoration time'],
      example: '14/05/2026 13:40:00',
    },
    {
      name: 'Bucket',
      required: false,
      description: 'False Alarm / Invalid, Non Breakdown or Breakdown. Defaults to Non Breakdown.',
      alsoAccepts: ['category'],
      example: 'Breakdown',
    },
    {
      name: 'Current Status',
      required: false,
      description:
        'Status the record ended on, e.g. Resolved by RAC. An unrecognised value is reported back and saved as No Update. Defaults to No Update.',
      alsoAccepts: ['status', 'final status'],
      example: 'Resolved by RAC',
    },
    {
      name: 'Issue',
      required: false,
      description: 'Issue category. Filled in from the master when Sub Issue matches it, so this can be left blank.',
      alsoAccepts: ['issue identified', 'issue category'],
      example: 'Cold Room',
    },
    {
      name: 'Sub Issue',
      required: false,
      description: 'Sub-issue. Several can be separated with a comma or a semicolon.',
      alsoAccepts: ['sub-issue', 'subissue', 'sub issues', 'sub issue identified'],
      example: 'Compressor Failure',
    },
    {
      name: 'CC POC',
      required: false,
      description: 'Who handled it. Defaults to the account running the import.',
      alsoAccepts: ['cc poc name', 'poc', 'handled by'],
      example: 'Kumarbrijesh',
    },
    {
      name: 'Ticket ID',
      required: false,
      description: 'Ticket or nugget number, if there was one.',
      alsoAccepts: ['ticket_id', 'nugget id', 'ticket no'],
      example: 'NUG-55120',
    },
    {
      name: 'CC FRT (minutes)',
      required: false,
      description: 'Minutes to the first CC response. Blank, "-" or "NA" all mean it was not recorded.',
      alsoAccepts: ['cc frt', 'ccfrt'],
      example: '3',
    },
    {
      name: 'RAC / MST FRT (minutes)',
      required: false,
      description: 'Minutes for the technician to reach site. Blank, "-" or "NA" all mean it was not recorded.',
      alsoAccepts: ['rac frt', 'mst frt', 'racfrt', 'mstfrt'],
      example: '45',
    },
    {
      name: 'Live Update',
      required: false,
      description: 'Whatever note the old sheet carried. Becomes the first history entry on the record.',
      alsoAccepts: ['update', 'comments', 'description'],
      example: 'RAC aligned, compressor replaced same day',
    },
    {
      name: 'Internal Remarks',
      required: false,
      description: 'Team-only note. Never appears in any report or export.',
      alsoAccepts: ['internal note', 'team note', 'remark', 'remarks'],
      example: 'Handled by night shift',
    },
    {
      name: 'Store Name',
      required: false,
      description: 'Only used when the Outlet ID is not in the current store master. Otherwise the master wins.',
      alsoAccepts: ['outlet name', 'store'],
      example: 'Faridabad New DLF ES7',
    },
    {
      name: 'City',
      required: false,
      description: 'Only used when the Outlet ID is not in the current store master.',
      alsoAccepts: ['location'],
      example: 'Faridabad',
    },
  ],
  notes: [
    'Only Outlet ID and Disruption Start Date are enforced, but fill Disruption Start Time too: the ID is built down to the minute, so two same-day disruptions on one store with a blank time become a single record.',
    'Do NOT send these - the app fills them from the store master: Mode, Vendor, POC Name, POC Contact, AMC Coverage, Current Vendor, Region, MST/RAC Name, MST/RAC Contact and the LOD L1/L2/L3 columns.',
    'Do NOT send Disruption ID, Duration or Week either. All three are derived, and a supplied value would be ignored.',
    'OEM alignment and visit times, and OEM FRT, are not part of this import. Imported records simply carry no OEM timings, which is expected for history recorded before they were tracked.',
    'Run the preview first: it reports how many rows would import, how many are already present, and which rows have a problem, without writing anything.',
    'Imported records are ordinary disruptions afterwards - they appear in the Master Log, the weekly count and the performance summary, and the Timings and Ticket feeds can still update them by Disruption ID.',
  ],
};

export const SHEET_FORMATS: SheetFormatSpec[] = [
  {
    key: 'outletMaster',
    title: 'Store Master',
    defaultTab: 'Live_data',
    purpose:
      'The list of stores the app knows about. An Outlet ID must exist here before a disruption can be logged against it.',
    matching: 'Rows are keyed on Outlet ID. The first row for an ID wins; later duplicates of the same ID are skipped.',
    columns: [
      {
        name: 'Outlet ID',
        required: true,
        description: 'Store code. Stored upper-cased, so case in the sheet does not matter.',
        alsoAccepts: ['outlet_id', 'outletid'],
        example: '30322',
      },
      {
        name: 'Store Name',
        required: false,
        description: 'Display name. Defaults to "Store <Outlet ID>" when blank.',
        example: 'Faridabad New DLF ES7',
      },
      {
        name: 'City',
        required: false,
        description: 'City the store sits in. Defaults to "Unspecified".',
        example: 'Faridabad',
      },
      {
        name: 'Mode',
        required: false,
        description: 'Store format. Defaults to "Dark Store".',
        example: 'Dark Store',
      },
      {
        name: 'Vendor',
        required: false,
        description: 'Servicing vendor. Defaults to "RAC".',
        example: 'RAC',
      },
      {
        name: 'AMC Coverage',
        required: false,
        description: 'Whether the store is under AMC, and which.',
        example: 'Under AMC',
      },
      {
        name: 'Current Vendor (AMC or Warranty)',
        required: false,
        description: 'Vendor actually on the hook today. Falls back to Vendor.',
        alsoAccepts: ['current vendor'],
        example: 'RAC Services Ltd',
      },
      {
        name: 'POC Name',
        required: false,
        description: 'Store contact. Defaults to "Store POC".',
        example: 'Rajesh Kumar',
      },
      {
        name: 'POC Contact',
        required: false,
        description: 'Phone number for that contact.',
        example: '+91 98XXX XXX21',
      },
      {
        name: 'Region (Auto)',
        required: false,
        description: 'Region or zone, shown on reports.',
        alsoAccepts: ['region', 'zone'],
        example: 'North',
      },
      {
        name: 'MST/RAC Name (Auto)',
        required: false,
        description: 'Assigned technician.',
        alsoAccepts: ['mst/rac name', 'mst name'],
        example: 'Manish Tyagi',
      },
      {
        name: 'MST/RAC Contact No. (Auto)',
        required: false,
        description: 'Technician phone number.',
        alsoAccepts: ['mst/rac contact no', 'mst rac contact'],
        example: '+91 98XXX XXX44',
      },
      {
        name: 'LOD - 2 L1 Name',
        required: false,
        description: 'First escalation contact.',
        alsoAccepts: ['l1 name'],
        example: 'Level 1 Owner',
      },
      {
        name: 'LOD - 2 L1 Email',
        required: false,
        description: 'First escalation email.',
        alsoAccepts: ['l1 email'],
        example: 'l1.owner@example.com',
      },
      {
        name: 'LOD - 2 L1 Contact No',
        required: false,
        description: 'First escalation phone.',
        alsoAccepts: ['l1 contact'],
        example: '+91 98XXX XXX01',
      },
      {
        name: 'LOD - 2 L2 Name',
        required: false,
        description: 'Second escalation contact.',
        alsoAccepts: ['l2 name'],
        example: 'Level 2 Owner',
      },
      {
        name: 'LOD - 2 L2 Email',
        required: false,
        description: 'Second escalation email.',
        alsoAccepts: ['l2 email'],
        example: 'l2.owner@example.com',
      },
      {
        name: 'LOD - 2 L2 Contact No',
        required: false,
        description: 'Second escalation phone.',
        alsoAccepts: ['l2 contact'],
        example: '+91 98XXX XXX02',
      },
      {
        name: 'LOD - 2 L3 Name',
        required: false,
        description: 'Third escalation contact.',
        alsoAccepts: ['l3 name'],
        example: 'Level 3 Owner',
      },
      {
        name: 'LOD - 2 L3 Email',
        required: false,
        description: 'Third escalation email.',
        alsoAccepts: ['l3 email'],
        example: 'l3.owner@example.com',
      },
      {
        name: 'LOD - 2 L3 Contact No.',
        required: false,
        description: 'Third escalation phone.',
        alsoAccepts: ['l3 contact'],
        example: '+91 98XXX XXX03',
      },
    ],
    notes: [
      'Only Outlet ID is mandatory. Every other column can be left out entirely and the app fills in a sensible default.',
      'A sync replaces the whole store master with what the sheet says, so a store removed from the sheet disappears from the picker.',
    ],
  },
  {
    key: 'disruptionTimings',
    title: 'Disruption Timings',
    defaultTab: 'Disruption_Timings',
    purpose:
      'When each disruption actually ended. The app works the duration out from the start time it already holds.',
    matching:
      'Rows are matched to an existing disruption by Disruption ID. A row whose ID the app does not recognise is skipped silently.',
    columns: [
      {
        name: 'Disruption ID',
        required: true,
        description: 'The ID the app generated when the disruption was logged, e.g. OutletID-YYMMDDHHMM.',
        alsoAccepts: ['disruption_id', 'id'],
        example: '30322-2610251430',
      },
      {
        name: 'End Time',
        required: true,
        description: 'When the store came back up. See the accepted time formats below.',
        alsoAccepts: ['end_time', 'disruption end time', 'resolution time', 'closure time', 'resolved at'],
        example: '25/10/2026 17:45:00',
      },
    ],
    notes: [
      'Leave End Time blank for a disruption that is still open; a blank cell changes nothing.',
      'Duration is never taken from the sheet. It is always computed as End Time minus the start time the app recorded.',
    ],
  },
  {
    key: 'tickets',
    title: 'Ticket Status',
    defaultTab: 'Tickets',
    purpose: 'Ticket number, state and closure time against each disruption.',
    matching:
      'Rows are matched by Disruption ID. Once a ticket reads closed the app freezes it, and later syncs leave that row alone.',
    columns: [
      {
        name: 'Disruption ID',
        required: true,
        description: 'The disruption this ticket belongs to.',
        alsoAccepts: ['disruption_id', 'id'],
        example: '30322-2610251430',
      },
      {
        name: 'Ticket ID',
        required: false,
        description: 'Ticket or nugget number.',
        alsoAccepts: ['ticket_id', 'ticket', 'ticket no'],
        example: 'NUG-89421',
      },
      {
        name: 'Ticket Status',
        required: false,
        description: 'Ticket state, e.g. Open / In Progress / Closed.',
        alsoAccepts: ['status', 'ticket_state', 'state'],
        example: 'Closed',
      },
      {
        name: 'Closure Time',
        required: false,
        description: 'When the ticket was closed. See the accepted time formats below.',
        alsoAccepts: ['closed at', 'ticket closed at', 'closed time', 'resolution time'],
        example: '26/10/2026 10:15:00',
      },
    ],
    notes: [
      'A row needs Disruption ID plus at least one of the other three to do anything. A row with only an ID is skipped.',
      'Ticket closure time is not the same as disruption end time: a ticket often closes well after the store is back up, which is why the Master Log shows the disruption end time instead.',
    ],
  },
];

/**
 * Header row plus one example row, ready to paste into a sheet or save as CSV.
 */
export function templateRowsFor(spec: SheetFormatSpec): string[][] {
  return [spec.columns.map((c) => c.name), spec.columns.map((c) => c.example)];
}

export function templateCsvFor(spec: SheetFormatSpec): string {
  return templateRowsFor(spec)
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function formatSpecFor(key: SheetFormatSpec['key']): SheetFormatSpec {
  const spec = [...SHEET_FORMATS, HISTORICAL_DISRUPTIONS_FORMAT].find((s) => s.key === key);
  if (!spec) throw new Error(`No sheet format spec for "${key}"`);
  return spec;
}
