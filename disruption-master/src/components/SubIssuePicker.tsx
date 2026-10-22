import React, { useMemo, useState } from 'react';
import { Search, X, Tags, CheckSquare, Square, AlertCircle } from 'lucide-react';
import { IssueMaster, deriveIssues } from '../utils/issueTaxonomy';

interface SubIssuePickerProps {
  issueMaster: IssueMaster;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shows the red asterisk and the "at least one" hint. */
  required?: boolean;
  disabled?: boolean;
  idPrefix?: string;
}

/**
 * Multi-select for sub-issues. Several can apply to one disruption, and the
 * parent issue is shown back as derived output so nobody has to pick it.
 */
export const SubIssuePicker: React.FC<SubIssuePickerProps> = ({
  issueMaster,
  selected,
  onChange,
  required = false,
  disabled = false,
  idPrefix = 'sub-issue',
}) => {
  const [query, setQuery] = useState('');

  const derivedIssues = useMemo(() => deriveIssues(selected, issueMaster), [selected, issueMaster]);

  // Group the master by category, filtered by the search box.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.entries(issueMaster)
      .map(([issue, subs]) => ({
        issue,
        subs: needle
          ? subs.filter((s) => s.toLowerCase().includes(needle) || issue.toLowerCase().includes(needle))
          : subs,
      }))
      .filter((g) => g.subs.length > 0);
  }, [issueMaster, query]);

  const toggle = (sub: string) => {
    if (disabled) return;
    onChange(selected.includes(sub) ? selected.filter((s) => s !== sub) : [...selected, sub]);
  };

  const hasMaster = Object.keys(issueMaster).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-700">
          Sub-Issues Identified {required && <span className="text-rose-500">*</span>}
        </label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-[11px] text-slate-500 hover:text-rose-600 font-medium"
          >
            Clear all
          </button>
        )}
      </div>

      {!hasMaster ? (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            The Issue / Sub-issue master is empty. The owner needs to add categories and sub-issues under Google
            Sheet &amp; Masters before a disruption can be resolved.
          </p>
        </div>
      ) : (
        <>
          {/* Chosen sub-issues */}
          <div
            id={`${idPrefix}-selected`}
            className={`min-h-9 flex flex-wrap gap-1.5 p-2 rounded-lg border ${
              required && selected.length === 0 ? 'border-rose-300 bg-rose-50/40' : 'border-slate-300 bg-white'
            }`}
          >
            {selected.length === 0 ? (
              <span className="text-[11px] text-slate-400 py-1">
                {required ? 'Select at least one sub-issue' : 'None selected'}
              </span>
            ) : (
              selected.map((sub) => (
                <span
                  key={sub}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-900 text-[11px] font-medium"
                >
                  <span>{sub}</span>
                  <button
                    type="button"
                    onClick={() => toggle(sub)}
                    disabled={disabled}
                    title={`Remove ${sub}`}
                    className="text-indigo-400 hover:text-rose-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Parent issues, derived not picked */}
          {derivedIssues.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <Tags className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500">Issue (auto):</span>
              {derivedIssues.map((issue) => (
                <span
                  key={issue}
                  className="px-2 py-0.5 rounded bg-slate-800 text-white font-semibold"
                >
                  {issue}
                </span>
              ))}
            </div>
          )}

          {/* Searchable picker */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              id={`${idPrefix}-search`}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sub-issues..."
              disabled={disabled}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {groups.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-slate-400">No sub-issue matches that search.</div>
            ) : (
              groups.map((group) => (
                <div key={group.issue} className="p-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 px-1">
                    {group.issue}
                  </div>
                  <div className="space-y-0.5">
                    {group.subs.map((sub) => {
                      const isSelected = selected.includes(sub);
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => toggle(sub)}
                          disabled={disabled}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                            isSelected
                              ? 'bg-indigo-50 text-indigo-900 font-semibold'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                          )}
                          <span className="truncate">{sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
