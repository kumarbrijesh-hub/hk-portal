import type { ReactNode } from 'react';
import type { Disruption } from '../types';
import { ActiveBadge, BucketBadge, StatusBadge } from './Badges';
import { formatIst, relativeAge } from '../utils/time';

interface Props {
  rows: Disruption[];
  loading: boolean;
  onOpen: (disruption: Disruption) => void;
  /** 'tracker' shows the full record set; 'active' matches the hourly report layout. */
  variant: 'tracker' | 'active';
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (column: string) => void;
  emptyMessage?: string;
}

interface Column {
  key: string;
  label: string;
  sortKey?: string;
  className?: string;
  render: (row: Disruption) => ReactNode;
}

const dash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : value;

export function DisruptionTable({
  rows, loading, onOpen, variant, sortBy, sortDir, onSort, emptyMessage,
}: Props) {
  const shared: Column[] = [
    {
      key: 'disruptionId',
      label: 'Disruption ID',
      sortKey: 'disruptionId',
      className: 'id',
      render: (row) => (
        <button type="button" className="link" onClick={() => onOpen(row)}>{row.disruptionId}</button>
      ),
    },
    { key: 'outletId', label: 'Outlet ID', sortKey: 'outletId', className: 'id', render: (row) => row.outletId },
    { key: 'storeName', label: 'Store Name', sortKey: 'storeName', className: 'store', render: (row) => dash(row.storeName) },
    { key: 'city', label: 'City', sortKey: 'city', render: (row) => dash(row.city) },
    { key: 'mode', label: 'Mode', sortKey: 'mode', render: (row) => dash(row.mode) },
    { key: 'vendor', label: 'Vendor', sortKey: 'vendor', render: (row) => dash(row.vendor) },
  ];

  const trackerOnly: Column[] = [
    { key: 'pocName', label: 'POC Name', render: (row) => dash(row.pocName) },
    { key: 'pocContact', label: 'POC Contact', className: 'nowrap', render: (row) => dash(row.pocContact) },
  ];

  const tail: Column[] = [
    { key: 'ccPoc', label: 'CC POC', sortKey: 'ccPoc', render: (row) => row.ccPoc },
    { key: 'bucket', label: 'Bucket', sortKey: 'bucket', render: (row) => <BucketBadge bucket={row.bucket} /> },
    { key: 'ticketId', label: 'Ticket ID', className: 'id', render: (row) => dash(row.ticketId) },
    {
      key: 'disruptionStartAt',
      label: 'Start Time (IST)',
      sortKey: 'disruptionStartAt',
      className: 'nowrap',
      render: (row) => formatIst(row.disruptionStartAt),
    },
    { key: 'durationHours', label: 'Dur (Hrs)', className: 'dur', render: (row) => row.durationHours.toFixed(1) },
    {
      key: 'currentStatus',
      label: 'Current Status',
      sortKey: 'currentStatus',
      render: (row) => <StatusBadge status={row.currentStatus} />,
    },
    { key: 'issue', label: 'Issue', render: (row) => dash(row.issue) },
    { key: 'subIssue', label: 'Sub Issue', render: (row) => dash(row.subIssue) },
    { key: 'ccFrtMins', label: 'CC FRT (M)', className: 'num', render: (row) => dash(row.ccFrtMins) },
    { key: 'mstFrtMins', label: 'MST FRT (M)', className: 'num', render: (row) => dash(row.mstFrtMins) },
    {
      key: 'latestLiveUpdate',
      label: 'Latest Live Update',
      className: 'updates',
      render: (row) => dash(row.latestLiveUpdate),
    },
    { key: 'lastUpdatedBy', label: 'Last Updated By', render: (row) => dash(row.lastUpdatedBy) },
    {
      key: 'lastUpdatedAt',
      label: 'Last Updated At',
      sortKey: 'lastUpdatedAt',
      className: 'nowrap',
      render: (row) => (
        <>
          {formatIst(row.lastUpdatedAt)}
          <div className="hint">{relativeAge(row.lastUpdatedAt)}</div>
        </>
      ),
    },
  ];

  const columns: Column[] = variant === 'tracker'
    ? [
      ...shared,
      ...trackerOnly,
      ...tail,
      { key: 'isActive', label: 'Active', render: (row) => <ActiveBadge active={row.isActive} /> },
    ]
    : [...shared, ...tail];

  if (loading && !rows.length) return <p className="loading">Loading disruptions…</p>;
  if (!rows.length) return <p className="empty">{emptyMessage ?? 'No disruptions match the current filters.'}</p>;

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort);
              // Guard against undefined === undefined marking unsortable columns as sorted.
              const isSorted = Boolean(column.sortKey) && sortBy === column.sortKey;
              return (
                <th
                  key={column.key}
                  className={sortable ? 'sortable' : undefined}
                  aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={sortable ? () => onSort!(column.sortKey!) : undefined}
                >
                  {column.label}
                  {isSorted && <span aria-hidden="true">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.disruptionId}>
              {columns.map((column) => (
                <td key={column.key} className={column.className} data-label={column.label}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
