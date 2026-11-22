import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * Checkbox dropdown for picking several values at once.
 *
 * The console already had single-value selects and one bespoke outlet picker.
 * This is the shared one: filters that scope a chart are chosen four and five at
 * a time, and a control that only takes one value forces the reader to rebuild
 * the same comparison by hand.
 *
 * Empty selection deliberately means "everything", not "nothing" - a chart that
 * blanks out the moment a filter is cleared is a chart nobody trusts.
 */

export interface MultiSelectProps {
  id: string;
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is picked, i.e. when everything is in scope. */
  allLabel?: string;
  /** Turns on the search box. Worth it past about a dozen options. */
  searchable?: boolean;
  /** Cap, for charts that cannot take an unbounded number of series. */
  maxSelected?: number;
  disabled?: boolean;
  /** Printed under the control when the cap is reached. */
  capNote?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  id,
  label,
  options,
  selected,
  onChange,
  allLabel = 'All',
  searchable = false,
  maxSelected,
  disabled = false,
  capNote,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A filter popover that stays open
  // behind the chart is worse than no popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const atCap = maxSelected !== undefined && selected.length >= maxSelected;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
      return;
    }
    if (atCap) return;
    onChange([...selected, value]);
  };

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="flex flex-col gap-1" ref={wrapRef}>
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>

      <div className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`w-full min-w-[150px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${
            disabled
              ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 cursor-pointer'
          }`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && !disabled && (
          <div className="absolute z-30 mt-1 w-full min-w-[210px] rounded-lg border border-slate-200 bg-white shadow-xl">
            {searchable && (
              <div className="relative border-b border-slate-100 p-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}`}
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
              {shown.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-400">Nothing matches that.</p>
              )}
              {shown.map((option) => {
                const isOn = selected.includes(option);
                const blocked = !isOn && atCap;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    disabled={blocked}
                    onClick={() => toggle(option)}
                    title={blocked ? capNote : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                      blocked
                        ? 'text-slate-300 cursor-not-allowed'
                        : 'text-slate-700 hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        isOn ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isOn && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{option}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Clear
              </button>
              <span className="text-[10px] text-slate-400">
                {selected.length === 0 ? allLabel : `${selected.length} of ${options.length}`}
                {maxSelected !== undefined ? ` · max ${maxSelected}` : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chosen values stay visible once the popover closes, each removable. */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-600"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(selected.filter((v) => v !== value))}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label={`Remove ${value}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
