import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../api/client';
import { useApp, useConfig } from '../state/AppContext';
import { Field } from './Field';
import { ActiveBadge, BucketBadge, StatusBadge } from './Badges';
import { formatIst, relativeAge } from '../utils/time';
import type { AuditEntry, Disruption, DisruptionUpdate } from '../types';

interface Detail {
  disruption: Disruption;
  history: DisruptionUpdate[];
  audit: AuditEntry[];
}

interface Props {
  disruptionId: string;
  onClose: () => void;
}

/**
 * Record view: master data, an update form that appends a Live Update, the full
 * update history (editable) and the field-level audit trail.
 */
export function DisruptionDrawer({ disruptionId, onClose }: Props) {
  const config = useConfig();
  const { revision, bumpRevision } = useApp();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [bucket, setBucket] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [ccPoc, setCcPoc] = useState('');
  const [issue, setIssue] = useState('');
  const [subIssue, setSubIssue] = useState('');
  const [ccFrt, setCcFrt] = useState('');
  const [mstFrt, setMstFrt] = useState('');
  const [auditDur, setAuditDur] = useState('');
  const [liveUpdate, setLiveUpdate] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(() => {
    api
      .get<Detail>(`/api/disruptions/${encodeURIComponent(disruptionId)}`)
      .then((next) => {
        setDetail(next);
        setLoadError(null);
        setStatus(next.disruption.currentStatus);
        setBucket(next.disruption.bucket);
        setTicketId(next.disruption.ticketId ?? '');
        setCcPoc(next.disruption.ccPoc);
        setIssue(next.disruption.issue ?? '');
        setSubIssue(next.disruption.subIssue ?? '');
        setCcFrt(next.disruption.ccFrtMins === null ? '' : String(next.disruption.ccFrtMins));
        setMstFrt(next.disruption.mstFrtMins === null ? '' : String(next.disruption.mstFrtMins));
        setAuditDur(next.disruption.auditDurationHrs === null ? '' : String(next.disruption.auditDurationHrs));
      })
      .catch((err) => setLoadError((err as Error).message));
  }, [disruptionId]);

  useEffect(load, [load, revision]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needsIssue = config.statusesRequiringIssue.includes(status);
  const needsTicket = config.bucketsRequiringTicketId.includes(bucket);
  const issueOptions = Object.keys(config.issueMaster);
  const subIssueOptions = config.issueMaster[issue] ?? [];

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    setFieldErrors({});
    try {
      await api.patch(`/api/disruptions/${encodeURIComponent(disruptionId)}`, {
        currentStatus: status,
        bucket,
        ticketId: ticketId.trim() || null,
        ccPoc,
        issue: needsIssue ? issue : null,
        subIssue: needsIssue ? subIssue : null,
        ccFrtMins: ccFrt === '' ? null : Number(ccFrt),
        mstFrtMins: mstFrt === '' ? null : Number(mstFrt),
        auditDurationHrs: auditDur === '' ? null : Number(auditDur),
        liveUpdate: liveUpdate.trim() || undefined,
      });
      setLiveUpdate('');
      setMessage(liveUpdate.trim() ? 'Live Update added.' : 'Disruption updated.');
      bumpRevision();
      load();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      setFieldErrors(apiError.fieldErrors ?? {});
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (updateId: string) => {
    setError(null);
    try {
      await api.patch(
        `/api/disruptions/${encodeURIComponent(disruptionId)}/updates/${updateId}`,
        { updateText: editText },
      );
      setEditingId(null);
      setMessage('Live Update edited. The original text is retained in the audit trail.');
      bumpRevision();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const record = detail?.disruption;

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label={`Disruption ${disruptionId}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{disruptionId}</h2>
            {record && (
              <p>
                {record.storeName} · {record.city} — started {formatIst(record.disruptionStartAt)} IST
                {' · '}<b>{record.durationHours.toFixed(1)} hrs</b>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="drawer-body">
          {loadError && <div className="notice error"><p>{loadError}</p></div>}
          {!detail && !loadError && <p className="loading">Loading record…</p>}

          {detail && record && (
            <>
              <div className="card">
                <div className="card-head">
                  <h2>Record</h2>
                  <div className="actions">
                    <ActiveBadge active={record.isActive} />
                    <BucketBadge bucket={record.bucket} />
                    <StatusBadge status={record.currentStatus} />
                  </div>
                </div>
                <div className="card-body">
                  <dl className="kv">
                    <div><dt>Outlet ID</dt><dd>{record.outletId}</dd></div>
                    <div><dt>Store Name</dt><dd>{record.storeName || '—'}</dd></div>
                    <div><dt>City</dt><dd>{record.city || '—'}</dd></div>
                    <div><dt>Mode</dt><dd>{record.mode || '—'}</dd></div>
                    <div><dt>Vendor</dt><dd>{record.vendor || '—'}</dd></div>
                    <div><dt>POC Name</dt><dd>{record.pocName || '—'}</dd></div>
                    <div><dt>POC Contact</dt><dd>{record.pocContact || '—'}</dd></div>
                    <div><dt>Ticket ID</dt><dd>{record.ticketId || '—'}</dd></div>
                    <div><dt>Created By</dt><dd>{record.createdBy}</dd></div>
                    <div><dt>Created At</dt><dd>{formatIst(record.createdAt)}</dd></div>
                    <div><dt>Last Updated By</dt><dd>{record.lastUpdatedBy || '—'}</dd></div>
                    <div>
                      <dt>Last Updated At</dt>
                      <dd>{formatIst(record.lastUpdatedAt)} <span className="hint">({relativeAge(record.lastUpdatedAt)})</span></dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>Add Live Update / change status</h2>
                  <p>Updates are appended — earlier text is never overwritten.</p>
                </div>
                <div className="card-body">
                  {error && <div className="notice error"><p>{error}</p></div>}
                  {message && <div className="notice success"><p>{message}</p></div>}

                  <div className="grid">
                    <Field label="Current Status" required error={fieldErrors.currentStatus} htmlFor="d-status">
                      <select
                        id="d-status"
                        value={status}
                        className={fieldErrors.currentStatus ? 'invalid' : undefined}
                        onChange={(event) => setStatus(event.target.value)}
                      >
                        {config.statuses.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </Field>

                    <Field label="Bucket" required error={fieldErrors.bucket} htmlFor="d-bucket">
                      <select
                        id="d-bucket"
                        value={bucket}
                        className={fieldErrors.bucket ? 'invalid' : undefined}
                        onChange={(event) => setBucket(event.target.value)}
                      >
                        {config.buckets.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </Field>

                    <Field
                      label="Disruption Ticket ID"
                      required={needsTicket}
                      error={fieldErrors.ticketId}
                      hint={needsTicket ? 'Mandatory for Breakdown.' : 'Optional for this bucket.'}
                      htmlFor="d-ticket"
                    >
                      <input
                        id="d-ticket"
                        type="text"
                        value={ticketId}
                        className={fieldErrors.ticketId ? 'invalid' : undefined}
                        onChange={(event) => setTicketId(event.target.value)}
                      />
                    </Field>

                    <Field label="CC POC" required error={fieldErrors.ccPoc} htmlFor="d-ccpoc">
                      <select id="d-ccpoc" value={ccPoc} onChange={(event) => setCcPoc(event.target.value)}>
                        {config.ccPocOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </Field>

                    {needsIssue && (
                      <>
                        <Field label="Issue" required error={fieldErrors.issue} htmlFor="d-issue">
                          <select
                            id="d-issue"
                            value={issue}
                            className={fieldErrors.issue ? 'invalid' : undefined}
                            onChange={(event) => { setIssue(event.target.value); setSubIssue(''); }}
                          >
                            <option value="">Select Issue…</option>
                            {issueOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </Field>
                        <Field label="Sub Issue" required error={fieldErrors.subIssue} htmlFor="d-subissue">
                          <select
                            id="d-subissue"
                            value={subIssue}
                            disabled={!issue}
                            className={fieldErrors.subIssue ? 'invalid' : undefined}
                            onChange={(event) => setSubIssue(event.target.value)}
                          >
                            <option value="">Select Sub Issue…</option>
                            {subIssueOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </Field>
                      </>
                    )}

                    <Field label="CC FRT (Mins)" htmlFor="d-ccfrt">
                      <input id="d-ccfrt" type="number" min={0} value={ccFrt} onChange={(event) => setCcFrt(event.target.value)} />
                    </Field>
                    <Field label="MST FRT (Mins)" htmlFor="d-mstfrt">
                      <input id="d-mstfrt" type="number" min={0} value={mstFrt} onChange={(event) => setMstFrt(event.target.value)} />
                    </Field>
                    <Field label="Audit Duration (Hrs)" htmlFor="d-auditdur">
                      <input
                        id="d-auditdur" type="number" min={0} step="0.1" value={auditDur}
                        onChange={(event) => setAuditDur(event.target.value)}
                      />
                    </Field>

                    <Field
                      label="Live Update"
                      className="span-full"
                      error={fieldErrors.liveUpdate}
                      hint="Leave blank to save only the status / metadata change."
                      htmlFor="d-live"
                    >
                      <textarea
                        id="d-live"
                        value={liveUpdate}
                        placeholder="e.g. Vendor reached site, PCB replacement in progress"
                        onChange={(event) => setLiveUpdate(event.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="actions" style={{ marginTop: 14 }}>
                    <button type="button" className="primary" onClick={save} disabled={saving}>
                      {saving ? 'Saving…' : 'Save Update'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>Update history</h2>
                  <p>{detail.history.length} entr{detail.history.length === 1 ? 'y' : 'ies'}</p>
                </div>
                <div className="card-body">
                  {!detail.history.length && <p className="empty">No updates recorded yet.</p>}
                  <ul className="timeline">
                    {detail.history.map((entry) => (
                      <li key={entry.updateId}>
                        <div className="meta">
                          <b>{formatIst(entry.updatedAt)}</b>
                          <span>· {entry.updatedBy}</span>
                          {entry.previousStatus && entry.newStatus && entry.previousStatus !== entry.newStatus && (
                            <span>· {entry.previousStatus} → {entry.newStatus}</span>
                          )}
                          {!entry.previousStatus && entry.newStatus && <span>· created as {entry.newStatus}</span>}
                        </div>

                        {editingId === entry.updateId ? (
                          <>
                            <textarea value={editText} onChange={(event) => setEditText(event.target.value)} />
                            <div className="actions" style={{ marginTop: 6 }}>
                              <button type="button" className="primary small" onClick={() => saveEdit(entry.updateId)}>
                                Save edit
                              </button>
                              <button type="button" className="small" onClick={() => setEditingId(null)}>Cancel</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text">{entry.updateText}</p>
                            {entry.editedAt && entry.originalText && entry.originalText !== entry.updateText && (
                              <p className="edited">
                                Edited by {entry.editedBy} on {formatIst(entry.editedAt)} · original: “{entry.originalText}”
                              </p>
                            )}
                            <button
                              type="button"
                              className="link"
                              onClick={() => { setEditingId(entry.updateId); setEditText(entry.updateText); }}
                            >
                              Edit
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>Audit trail</h2>
                  <p>Field-level change log</p>
                </div>
                <div className="card-body">
                  {!detail.audit.length && <p className="empty">No audit entries yet.</p>}
                  {detail.audit.length > 0 && (
                    <div className="table-scroll">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>At (IST)</th><th>Actor</th><th>Action</th>
                            <th>Field</th><th>From</th><th>To</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.audit.map((entry) => (
                            <tr key={entry.id}>
                              <td data-label="At (IST)" className="nowrap">{formatIst(entry.at)}</td>
                              <td data-label="Actor">{entry.actor}</td>
                              <td data-label="Action">{entry.action}</td>
                              <td data-label="Field">{entry.field ?? '—'}</td>
                              <td data-label="From">{entry.previousValue ?? '—'}</td>
                              <td data-label="To">{entry.newValue ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
