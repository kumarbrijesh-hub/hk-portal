import React, { useState } from 'react';
import { KeyRound, Check, AlertTriangle, Eye, EyeOff, Lock } from 'lucide-react';
import { changeAppPassword } from '../services/api';
import { MIN_PASSWORD_LENGTH } from '../utils/appPassword';

interface PasswordCardProps {
  /** Owner-only, same as the server's own check on the endpoint. */
  isOwner: boolean;
}

/**
 * Changing the shared console sign-in password.
 *
 * The password is generated in-cluster on first boot and printed once, which
 * meant changing it was a pod-log-and-volume job. This does it from the console:
 * the value is typed here, posts straight to the file the server reads it from,
 * and so still never reaches a manifest, a commit or a log.
 *
 * Everything is typed twice and the current password is re-entered, because the
 * cost of a typo here is that nobody can sign in and the only way back is a
 * shell on the pod.
 */
export const PasswordCard: React.FC<PasswordCardProps> = ({ isOwner }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!isOwner) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const result = await changeAppPassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      setDone(result.message);
      // Cleared on success and not before: a failed attempt keeps what was typed
      // so a single wrong character does not mean typing all three again.
      setCurrent('');
      setNext('');
      setConfirm('');
      setReveal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !busy && current && next && confirm && !tooShort && !mismatch;

  const field =
    'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-slate-500 focus:border-slate-500 font-mono';

  return (
    <div id="password-card" className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-slate-800 px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-600/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black uppercase tracking-wider text-white">Sign-in Password</h3>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[10px] font-bold uppercase tracking-wider">
                Owner only
              </span>
            </div>
            <p className="text-xs text-slate-400">
              The shared password everyone types after their work email address.
            </p>
          </div>
        </div>
        <Lock className="w-4 h-4 text-slate-500 hidden sm:block" />
      </div>

      <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-start gap-2">
        <Lock className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-700 leading-relaxed">
          Changing it here writes it straight to the file the server reads, so it never appears in a log, a
          settings file or anywhere outside the cluster. Everyone signed in{' '}
          <strong className="font-semibold">stays</strong> signed in — the new password is needed the next time
          someone signs in.
        </p>
      </div>

      {done && (
        <div id="password-card-done" className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 leading-relaxed">{done}</p>
        </div>
      )}

      {error && (
        <div id="password-card-error" className="px-6 py-3 bg-rose-50 border-b border-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-800 leading-relaxed">{error}</p>
        </div>
      )}

      <form onSubmit={submit} className="p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label htmlFor="password-current" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Current password
            </label>
            <input
              id="password-current"
              type={reveal ? 'text' : 'password'}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className={field}
              placeholder="the one in use now"
            />
          </div>

          <div>
            <label htmlFor="password-new" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              New password
            </label>
            <input
              id="password-new"
              type={reveal ? 'text' : 'password'}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              className={`${field} ${tooShort ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}
              placeholder={`at least ${MIN_PASSWORD_LENGTH} characters`}
            />
            {tooShort && (
              <p className="text-[11px] text-rose-700 mt-1">
                {MIN_PASSWORD_LENGTH - next.length} more character
                {MIN_PASSWORD_LENGTH - next.length === 1 ? '' : 's'} needed.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password-confirm" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              New password again
            </label>
            <input
              id="password-confirm"
              type={reveal ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={`${field} ${mismatch ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}
              placeholder="type it a second time"
            />
            {mismatch && <p className="text-[11px] text-rose-700 mt-1">The two do not match yet.</p>}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            id="password-reveal-toggle"
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition border border-slate-200 self-start"
            aria-pressed={reveal}
            title={reveal ? 'Hide what is typed' : 'Show what is typed, to check for a typo'}
          >
            {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{reveal ? 'Hide' : 'Show'}</span>
          </button>

          <button
            id="password-save-btn"
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition flex items-center gap-2 sm:ml-auto"
          >
            <KeyRound className="w-4 h-4" />
            <span>{busy ? 'Saving…' : 'Change password'}</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          No spaces at either end and no line breaks — the file holds one line and is read trimmed, so either
          would silently become a different password than the one typed.
        </p>
      </form>
    </div>
  );
};
