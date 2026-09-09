import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { api, toQuery } from '../api/client';
import type { Outlet } from '../types';

interface Props {
  value: string;
  onSelect: (outlet: Outlet | null) => void;
  error?: string;
  disabled?: boolean;
  inputId?: string;
}

/**
 * Searchable Outlet ID input. Reads only from the synced master snapshot, so it
 * stays fast even while a Google Sheet sync is running in the background.
 */
export function OutletPicker({ value, onSelect, error, disabled, inputId = 'outletId' }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Outlet[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      setLoading(true);
      api
        .get<{ results: Outlet[] }>(`/api/outlets/search${toQuery({ q: query, limit: 25 })}`)
        .then((response) => {
          if (requestId.current !== id) return;
          setResults(response.results);
          setHighlight(0);
        })
        .catch(() => {
          if (requestId.current === id) setResults([]);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const commit = (outlet: Outlet) => {
    setQuery(outlet.outletId);
    setOpen(false);
    onSelect(outlet);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const chosen = results[highlight];
      if (chosen) {
        event.preventDefault();
        commit(chosen);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const listId = `${inputId}-options`;
  const status = useMemo(() => {
    if (loading) return 'Searching master data…';
    if (!results.length) return 'No matching outlet in the synced master data.';
    return null;
  }, [loading, results.length]);

  return (
    <div className="picker" ref={wrapRef}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="search"
        placeholder="Type or select Outlet ID"
        className={error ? 'invalid' : undefined}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setQuery(event.target.value);
          setOpen(true);
          // Clear the resolved master data until a valid outlet is picked again.
          onSelect(null);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="picker-list" id={listId} role="listbox">
          {status && <li className="hint" style={{ padding: '8px 10px' }}>{status}</li>}
          {results.map((outlet, index) => (
            <li key={outlet.outletId} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={`picker-option${index === highlight ? ' active' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(outlet)}
              >
                <b>{outlet.outletId}</b>
                <span>{[outlet.storeName, outlet.city].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
