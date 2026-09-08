import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, toQuery, type ApiError } from '../api/client';
import { useApp, useConfig } from '../state/AppContext';
import { Field, ReadOnlyField } from '../components/Field';
import { OutletPicker } from '../components/OutletPicker';
import { FiltersBar } from '../components/FiltersBar';
import { DisruptionTable } from '../components/DisruptionTable';
import { DisruptionDrawer } from '../components/DisruptionDrawer';
import { SyncBar } from '../components/SyncBar';
import { toDatetimeLocal } from '../utils/time';
import { EMPTY_FILTERS, type Disruption, type DisruptionFilterValues, type Outlet } from '../types';

const BLANK_OUTLET: Outlet = {
  outletId: '', storeName: '', city: '', mode: '', vendor: '',
  pocName: '', pocContact: '', syncedAt: '',
};

export function LiveTracker() {
  const config = useConfig();
  const { revision, bumpRevision } = useApp();

  // --- creation form state -------------------------------------------------
  const [outlet, setOutlet] = useState<Outlet>(BLANK_OUTLET);
  const [outletQuery, setOutletQuery] = useState('');
  const [startAt, setStartAt] = useState(() => toDatetimeLocal());
  const [ccPoc, setCcPoc] = useState('');
  const [bucket, setBucket] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [status, setStatus] = useState('');
  const [issue, setIssue] = useState('');
  const [subIssue, setSubIssue] = useState('');
  const [liveUpdate, setLiveUpdate] = useState('');
  const [ccFrt, setCcFrt] = useState('');
  const [mstFrt, setMstFrt] = useState('');

  const [preview, setPreview] = useState<{ disruptionId: string; taken: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // --- table state ---------------------------------------------------------
  const [filters, setFilters] = useState<DisruptionFilterValues>({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState<Disruption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('disruptionStartAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [openId, setOpenId] = useState<string | null>(null);

  const needsTicket = config.bucketsRequiringTicketId.includes(bucket);
  const needsIssue = config.statusesRequiringIssue.includes(status);
  const issueOptions = useMemo(() => Object.keys(config.issueMaster), [config.issueMaster]);
  const subIssueOptions = config.issueMaster[issue] ?? [];

  // Rule 2: as soon as Outlet ID + start time are both present, preview the ID.
  useEffect(() => {
    if (!outlet.outletId || !startAt) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ disruptionId: string; taken: boolean }>(
        `/api/disruptions/preview-id${toQuery({ outletId: outlet.outletId, disruptionStartAt: startAt })}`,
      )
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [outlet.outletId, startAt]);

  const loadRows = useCallback(() => {
    setLoading(true);
    api
      .get<{ rows: Disruption[]; total: number }>(
        `/api/disruptions${toQuery({ ...filters, sortBy, sortDir, limit: 300 })}`,
      )
      .then((response) => {
        setRows(response.rows);
        setTotal(response.total);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [filters, sortBy, sortDir]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(loadRows, 220);
    return () => clearTimeout(handle);
  }, [loadRows, revision]);

  const resetForm = () => {
    setOutlet(BLANK_OUTLET);
    setOutletQuery('');
    setStartAt(toDatetimeLocal());
    setCcPoc('');
    setBucket('');
    setTicketId('');
    setStatus('');
    setIssue('');
    setSubIssue('');
    setLiveUpdate('');
    setCcFrt('');
    setMstFrt('');
    setPreview(null);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    setExistingId(null);
    setFieldErrors({});
    try {
      const response = await api.post<{ disruption: Disruption; message: string }>('/api/disruptions', {
        outletId: outlet.outletId,
        disruptionStartAt: startAt,
        ccPoc,
        bucket,
        ticketId: ticketId.trim() || null,
        currentStatus: status,
        issue: needsIssue ? issue : null,
        subIssue: needsIssue ? subIssue : null,
        liveUpdate,
        ccFrtMins: ccFrt === '' ? null : Number(ccFrt),
        mstFrtMins: mstFrt === '' ? null : Number(mstFrt),
      });
      setSuccess(response.message);
      resetForm();
      bumpRevision();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      setFieldErrors(apiError.fieldErrors ?? {});
      setExistingId(apiError.existingId ?? null);
    } finally {
      setSaving(false);
    }
  };

  const onSort = (column: string) => {
    if (sortBy === column) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  return (
    <div className="page">
      <SyncBar />

      {config.issueMasterPending && (
        <div className="notice info">
          <p>
            <strong>Issue / Sub Issue master is placeholder data.</strong> The dropdowns work, but the
            values in <code>config/app.config.json → issueMaster</code> need to be replaced with the real master list.
          </p>
        </div>
      )}

      <form className="card" onSubmit={create}>
        <div className="card-head">
          <div>
            <h2>Create disruption</h2>
            <p>Outlet ID and start time generate the Disruption ID automatically.</p>
          </div>
          {preview && (
            <div>
              <span className="tile-label">Disruption ID</span>
              <div className="id" style={{ fontSize: 15, fontWeight: 700 }}>{preview.disruptionId}</div>
            </div>
          )}
        </div>

        <div className="card-body">
          {success && <div className="notice success"><p>{success}</p></div>}
          {error && (
            <div className="notice error">
              <p>
                {error}
                {existingId && (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={() => setOpenId(existingId)}>
                      Open {existingId}
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
          {preview?.taken && !error && (
            <div className="notice warn">
              <p>
                <strong>{preview.disruptionId}</strong> already exists. Open that record and add a Live
                Update instead of creating a duplicate.{' '}
                <button type="button" className="link" onClick={() => setOpenId(preview.disruptionId)}>
                  Open record
                </button>
              </p>
            </div>
          )}

          <div className="grid">
            <Field
              label="Outlet ID"
              required
              error={fieldErrors.outletId}
              hint={`${config.outletCount} outlets in synced master data`}
              htmlFor="outletId"
            >
              <OutletPicker
                value={outletQuery}
                error={fieldErrors.outletId}
                onSelect={(selected) => {
                  setOutlet(selected ?? BLANK_OUTLET);
                  setOutletQuery(selected?.outletId ?? '');
                }}
              />
            </Field>

            <Field
              label="Disruption Start (IST)"
              required
              error={fieldErrors.disruptionStartAt}
              hint="DD/MM/YYYY HH:MM:SS — seconds included"
              htmlFor="startAt"
            >
              <input
                id="startAt"
                type="datetime-local"
                step="1"
                value={startAt}
                className={fieldErrors.disruptionStartAt ? 'invalid' : undefined}
                onChange={(event) => setStartAt(event.target.value)}
                required
              />
            </Field>

            <ReadOnlyField label="Store Name" value={outlet.storeName} />
            <ReadOnlyField label="City" value={outlet.city} />
            <ReadOnlyField label="Mode" value={outlet.mode} />
            <ReadOnlyField label="Vendor" value={outlet.vendor} />
            <ReadOnlyField label="POC Name" value={outlet.pocName} />
            <ReadOnlyField label="POC Contact" value={outlet.pocContact} />

            <Field label="CC POC" required error={fieldErrors.ccPoc} htmlFor="ccPoc">
              <select
                id="ccPoc"
                value={ccPoc}
                className={fieldErrors.ccPoc ? 'invalid' : undefined}
                onChange={(event) => setCcPoc(event.target.value)}
                required
              >
                <option value="">Select your name…</option>
                {config.ccPocOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>

            <Field label="Bucket" required error={fieldErrors.bucket} htmlFor="bucket">
              <select
                id="bucket"
                value={bucket}
                className={fieldErrors.bucket ? 'invalid' : undefined}
                onChange={(event) => setBucket(event.target.value)}
                required
              >
                <option value="">Select bucket…</option>
                {config.buckets.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>

            <Field
              label="Disruption / Nugget Ticket ID"
              required={needsTicket}
              error={fieldErrors.ticketId}
              hint={needsTicket ? 'Mandatory for Breakdown.' : 'Not mandatory for this bucket.'}
              htmlFor="ticketId"
            >
              <input
                id="ticketId"
                type="text"
                value={ticketId}
                className={fieldErrors.ticketId ? 'invalid' : undefined}
                onChange={(event) => setTicketId(event.target.value)}
              />
            </Field>

            <Field label="Current Status" required error={fieldErrors.currentStatus} htmlFor="status">
              <select
                id="status"
                value={status}
                className={fieldErrors.currentStatus ? 'invalid' : undefined}
                onChange={(event) => { setStatus(event.target.value); setIssue(''); setSubIssue(''); }}
                required
              >
                <option value="">Select status…</option>
                {config.statuses.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>

            {/* Issue / Sub Issue stay hidden until the status requires them (spec section 11). */}
            {needsIssue && (
              <>
                <Field label="Issue" required error={fieldErrors.issue} htmlFor="issue">
                  <select
                    id="issue"
                    value={issue}
                    className={fieldErrors.issue ? 'invalid' : undefined}
                    onChange={(event) => { setIssue(event.target.value); setSubIssue(''); }}
                    required
                  >
                    <option value="">Select Issue…</option>
                    {issueOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </Field>

                <Field label="Sub Issue" required error={fieldErrors.subIssue} htmlFor="subIssue">
                  <select
                    id="subIssue"
                    value={subIssue}
                    disabled={!issue}
                    className={fieldErrors.subIssue ? 'invalid' : undefined}
                    onChange={(event) => setSubIssue(event.target.value)}
                    required
                  >
                    <option value="">{issue ? 'Select Sub Issue…' : 'Select an Issue first'}</option>
                    {subIssueOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </Field>
              </>
            )}

            <Field label="CC FRT (Mins)" htmlFor="ccFrt" hint="Optional">
              <input id="ccFrt" type="number" min={0} value={ccFrt} onChange={(event) => setCcFrt(event.target.value)} />
            </Field>
            <Field label="MST FRT (Mins)" htmlFor="mstFrt" hint="Optional">
              <input id="mstFrt" type="number" min={0} value={mstFrt} onChange={(event) => setMstFrt(event.target.value)} />
            </Field>

            <Field
              label="Live Update"
              required
              className="span-full"
              error={fieldErrors.liveUpdate}
              hint="First running update for this disruption. More can be appended later."
              htmlFor="liveUpdate"
            >
              <textarea
                id="liveUpdate"
                value={liveUpdate}
                placeholder="e.g. Temp not maintained // RAC aligned // technician assigned"
                className={fieldErrors.liveUpdate ? 'invalid' : undefined}
                onChange={(event) => setLiveUpdate(event.target.value)}
                required
              />
            </Field>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <button type="submit" className="brand" disabled={saving}>
              {saving ? 'Creating…' : 'Create Disruption'}
            </button>
            <button type="button" onClick={resetForm} disabled={saving}>Reset form</button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Live Tracker</h2>
            <p>{total} record{total === 1 ? '' : 's'} — click a Disruption ID to open, update or view history.</p>
          </div>
        </div>
        <div className="card-body">
          <FiltersBar value={filters} onChange={setFilters} />
        </div>
        <DisruptionTable
          rows={rows}
          loading={loading}
          variant="tracker"
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          onOpen={(row) => setOpenId(row.disruptionId)}
        />
      </div>

      {openId && <DisruptionDrawer disruptionId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
