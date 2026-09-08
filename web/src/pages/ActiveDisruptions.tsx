import { useCallback, useEffect, useState } from 'react';
import { api, toQuery } from '../api/client';
import { useApp, useConfig } from '../state/AppContext';
import { FiltersBar } from '../components/FiltersBar';
import { DisruptionTable } from '../components/DisruptionTable';
import { DisruptionDrawer } from '../components/DisruptionDrawer';
import { SyncBar } from '../components/SyncBar';
import { formatIst } from '../utils/time';
import {
  EMPTY_FILTERS,
  type BucketSplit,
  type Disruption,
  type DisruptionFilterValues,
  type ReportStats,
} from '../types';

interface Summary {
  generatedAt: string;
  appliedFilters: Record<string, string>;
  stats: ReportStats;
  primaryCount: number;
  secondaryCount: number;
}

const dash = (value: number | null, suffix = '') =>
  value === null || value === undefined ? '—' : `${value}${suffix}`;

function Tile({
  label, value, unit, accent, tone, rows,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
  tone: string;
  rows: { label: string; value: string; dot: string }[];
}) {
  return (
    <section className="tile" style={{ ['--accent' as string]: accent }}>
      <h2 className="tile-label">{label}</h2>
      <p className={`tile-value ${tone}`}>
        {value}
        {unit && <span className="tile-unit">{unit}</span>}
      </p>
      <div className="tile-rows">
        {rows.map((row) => (
          <div className="tile-row" key={row.label}>
            <span><span className={`dot ${row.dot}`} aria-hidden="true" />{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ActiveDisruptions() {
  const config = useConfig();
  const { revision } = useApp();

  const [filters, setFilters] = useState<DisruptionFilterValues>({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState<Disruption[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = toQuery({ ...filters });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<{ rows: Disruption[]; activeCount: number }>(`/api/disruptions/active${query}`),
      api.get<Summary>(`/api/reports/active/summary${query}`),
    ])
      .then(([list, stats]) => {
        setRows(list.rows);
        setSummary(stats);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const handle = setTimeout(load, 220);
    return () => clearTimeout(handle);
  }, [load, revision]);

  const stats = summary?.stats;
  const split = (value: BucketSplit, suffix = '') => [
    { label: config.report.breakdownBucket, value: dash(value.breakdown, suffix), dot: 'critical' },
    { label: config.report.nonBreakdownBucket, value: dash(value.nonBreakdown, suffix), dot: 'warning' },
  ];

  const download = (format: 'xlsx' | 'csv') => {
    // A plain navigation keeps the session cookie and lets the browser save the file.
    window.location.href = `/api/reports/active.${format}${query}`;
  };

  const secondaryStatuses = config.report.secondarySectionStatuses;

  return (
    <div className="page">
      <SyncBar />

      <div className="tiles">
        {stats ? (
          <>
            <Tile
              label="Active Now"
              value={String(stats.activeNow)}
              accent="#dc2626"
              tone="v-critical"
              rows={split(stats.activeSplit)}
            />
            <Tile
              label="Total Duration"
              value={stats.totalDurationHrs.toFixed(1)}
              unit="Hrs"
              accent="#d97706"
              tone="v-warning"
              rows={[
                {
                  label: config.report.breakdownBucket,
                  value: `${dash(stats.totalDurationSplit.breakdown)} h (${dash(stats.totalDurationSharePct.breakdown)}%)`,
                  dot: 'critical',
                },
                {
                  label: config.report.nonBreakdownBucket,
                  value: `${dash(stats.totalDurationSplit.nonBreakdown)} h (${dash(stats.totalDurationSharePct.nonBreakdown)}%)`,
                  dot: 'warning',
                },
              ]}
            />
            <Tile
              label="Avg Duration"
              value={stats.avgDurationHrs.toFixed(1)}
              unit="Hrs"
              accent="#d97706"
              tone="v-warning"
              rows={split(stats.avgDurationSplit, ' h')}
            />
            <Tile
              label="Avg MST FRT"
              value={String(stats.avgMstFrtMins)}
              unit="Mins"
              accent="#1d4ed8"
              tone="v-info"
              rows={split(stats.avgMstFrtSplit, ' m')}
            />
            <Tile
              label="Avg CC FRT"
              value={String(stats.avgCcFrtMins)}
              unit="Mins"
              accent="#1d4ed8"
              tone="v-info"
              rows={split(stats.avgCcFrtSplit, ' m')}
            />
          </>
        ) : (
          <p className="loading">Loading active disruption summary…</p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Live Active Disruption</h2>
            <p>
              Active = every status except: {config.inactiveStatuses.join(', ')}.
              {summary && ` Generated ${formatIst(summary.generatedAt)} IST.`}
            </p>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => download('xlsx')} disabled={!rows.length}>
              Download Active Report (Excel)
            </button>
            <button type="button" onClick={() => download('csv')} disabled={!rows.length}>
              CSV
            </button>
            <a
              className="badge info"
              href={`/api/reports/active.html${query}`}
              target="_blank"
              rel="noreferrer"
              style={{ padding: '10px 14px', textDecoration: 'none' }}
            >
              Open hourly report
            </a>
          </div>
        </div>

        <div className="card-body">
          <FiltersBar value={filters} onChange={setFilters} activeOnly />
          {summary && Object.keys(summary.appliedFilters).length > 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Report will contain only these filtered records —{' '}
              {Object.entries(summary.appliedFilters).map(([key, value]) => `${key}: ${value}`).join(' · ')}
            </p>
          )}
          {summary && summary.secondaryCount > 0 && (
            <p className="hint" style={{ marginTop: 6 }}>
              {summary.secondaryCount} record{summary.secondaryCount === 1 ? '' : 's'} will appear in the report&apos;s
              “{config.report.secondarySectionTitle}” section ({secondaryStatuses.join(', ')}).
            </p>
          )}
        </div>

        <DisruptionTable
          rows={rows}
          loading={loading}
          variant="active"
          onOpen={(row) => setOpenId(row.disruptionId)}
          emptyMessage="No active disruptions for the selected filters."
        />
      </div>

      {openId && <DisruptionDrawer disruptionId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
