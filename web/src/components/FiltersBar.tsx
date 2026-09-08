import { useEffect, useState, type ChangeEvent } from 'react';
import { api } from '../api/client';
import { Field } from './Field';
import { useConfig } from '../state/AppContext';
import { EMPTY_FILTERS, type DisruptionFilterValues } from '../types';

interface FilterOptions {
  disruptionCities: string[];
  disruptionVendors: string[];
  disruptionModes: string[];
  cities: string[];
  vendors: string[];
  modes: string[];
}

interface Props {
  value: DisruptionFilterValues;
  onChange: (next: DisruptionFilterValues) => void;
  /** Active page hides the status filter's inactive options - they can never match. */
  activeOnly?: boolean;
}

export function FiltersBar({ value, onChange, activeOnly }: Props) {
  const config = useConfig();
  const [options, setOptions] = useState<FilterOptions | null>(null);

  useEffect(() => {
    api.get<FilterOptions>('/api/config/filters').then(setOptions).catch(() => setOptions(null));
  }, []);

  const set = (key: keyof DisruptionFilterValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...value, [key]: event.target.value });

  const statuses = activeOnly
    ? config.statuses.filter((status) => !config.inactiveStatuses.includes(status))
    : config.statuses;

  const cities = options?.disruptionCities.length ? options.disruptionCities : options?.cities ?? [];
  const vendors = options?.disruptionVendors.length ? options.disruptionVendors : options?.vendors ?? [];
  const modes = options?.disruptionModes.length ? options.disruptionModes : options?.modes ?? [];

  const dirty = Object.entries(value).some(([key, entry]) => entry !== EMPTY_FILTERS[key as keyof DisruptionFilterValues]);

  return (
    <div className="filters">
      <Field label="Search" className="span-2" htmlFor="f-search">
        <input
          id="f-search"
          type="text"
          inputMode="search"
          placeholder="Disruption ID, store, ticket, update…"
          value={value.search}
          onChange={set('search')}
        />
      </Field>

      <Field label="City" htmlFor="f-city">
        <select id="f-city" value={value.city} onChange={set('city')}>
          <option value="">All cities</option>
          {cities.map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
      </Field>

      <Field label="Outlet ID" htmlFor="f-outlet">
        <input id="f-outlet" type="text" placeholder="All" value={value.outletId} onChange={set('outletId')} />
      </Field>

      <Field label="Store Name" htmlFor="f-store">
        <input id="f-store" type="text" placeholder="All" value={value.storeName} onChange={set('storeName')} />
      </Field>

      <Field label="Vendor" htmlFor="f-vendor">
        <select id="f-vendor" value={value.vendor} onChange={set('vendor')}>
          <option value="">All vendors</option>
          {vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
        </select>
      </Field>

      <Field label="Mode" htmlFor="f-mode">
        <select id="f-mode" value={value.mode} onChange={set('mode')}>
          <option value="">All modes</option>
          {modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </Field>

      <Field label="CC POC" htmlFor="f-ccpoc">
        <select id="f-ccpoc" value={value.ccPoc} onChange={set('ccPoc')}>
          <option value="">All</option>
          {config.ccPocOptions.map((poc) => <option key={poc} value={poc}>{poc}</option>)}
        </select>
      </Field>

      <Field label="Bucket" htmlFor="f-bucket">
        <select id="f-bucket" value={value.bucket} onChange={set('bucket')}>
          <option value="">All buckets</option>
          {config.buckets.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
        </select>
      </Field>

      <Field label="Current Status" htmlFor="f-status">
        <select id="f-status" value={value.currentStatus} onChange={set('currentStatus')}>
          <option value="">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </Field>

      <Field label="Start Date (IST)" htmlFor="f-date">
        <input id="f-date" type="date" value={value.date} onChange={set('date')} />
      </Field>

      <div className="field">
        <label>&nbsp;</label>
        <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} disabled={!dirty}>
          Clear filters
        </button>
      </div>
    </div>
  );
}
