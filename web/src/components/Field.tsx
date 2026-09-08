import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, required, error, hint, className, htmlFor, children }: FieldProps) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

/** Read-only master-data value populated by the Outlet ID lookup. */
export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="readonly-value" title={value || '—'}>{value || '—'}</div>
    </div>
  );
}
