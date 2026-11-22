import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarRange,
  Download,
  Image as ImageIcon,
  Info,
  LineChart as LineChartIcon,
  Table as TableIcon,
  Truck,
} from 'lucide-react';
import { Disruption } from '../types';
import { BrandMark } from './BrandMark';
import { LineSeries, LineTrendChart } from './LineTrendChart';
import { MultiSelect } from './MultiSelect';
import {
  availableGroups,
  availableWeeks,
  buildCityTrendReport,
  seriesValues,
  TREND_METRIC_HINTS,
  TREND_METRIC_LABELS,
  TrendDimension,
  TrendMetric,
} from '../utils/cityTrends';
import { exportActiveReportToPNG } from '../utils/reportExport';
import { formatReportGeneratedTimestamp, getReportFileTimestamp } from '../utils/dateUtils';

/**
 * Week-over-week trend, by city or by vendor.
 *
 * The question this page answers is "is it getting worse, and where" - which is
 * change over time, so it is a line chart and not the count grid the Weekly
 * Count page already provides.
 *
 * Series colours come from the house categorical palette in slot order, keyed to
 * the group name rather than to its rank: dropping a city from the filter must
 * not repaint the ones that remain. Eight is the cap because a ninth hue would
 * have to be invented, and an invented hue is not a validated one.
 */

const REPORT_ELEMENT_ID = 'city-trends-report';

/**
 * Categorical slots 1-8, as CSS custom properties so dark mode swaps them in
 * one stylesheet rule. Validated with the palette validator against this app's
 * own surfaces - light #ffffff, dark #121a2c - on the adjacent pairlist that
 * line charts use: every check passes in both modes (worst adjacent CVD ΔE 9.1
 * light / 8.4 dark, worst adjacent normal-vision ΔE 19.6 light / 19.3 dark).
 * Three light slots sit under 3:1 against white, which is why this page always
 * ships direct end labels and a table view rather than leaving colour to carry
 * the reading on its own.
 */
const SERIES_VARS = [
  'var(--dms-series-1)',
  'var(--dms-series-2)',
  'var(--dms-series-3)',
  'var(--dms-series-4)',
  'var(--dms-series-5)',
  'var(--dms-series-6)',
  'var(--dms-series-7)',
  'var(--dms-series-8)',
];

const MAX_SERIES = SERIES_VARS.length;

/** Default span when the page opens: enough weeks to see a shape. */
const DEFAULT_WEEKS = 8;

const METRIC_ORDER: TrendMetric[] = ['disruptions', 'instances', 'hours'];

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

interface CityTrendsViewProps {
  disruptions: Disruption[];
}

export const CityTrendsView: React.FC<CityTrendsViewProps> = ({ disruptions }) => {
  const [dimension, setDimension] = useState<TrendDimension>('city');
  const [metric, setMetric] = useState<TrendMetric>('disruptions');
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [tableChoice, setTableChoice] = useState<boolean | null>(null);
  const [isGeneratingPng, setIsGeneratingPng] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const weeks = useMemo(() => availableWeeks(disruptions), [disruptions]);
  const weekOptions = useMemo(() => weeks.map((w) => w.shortLabel), [weeks]);
  const cityOptions = useMemo(() => availableGroups(disruptions, 'city'), [disruptions]);
  const groupOptions = useMemo(() => availableGroups(disruptions, dimension), [disruptions, dimension]);

  // Open on the most recent weeks rather than on everything: a year of history
  // in one line chart is a scribble.
  useEffect(() => {
    if (weekOptions.length === 0 || selectedWeeks.length > 0) return;
    setSelectedWeeks(weekOptions.slice(0, DEFAULT_WEEKS));
    // Only ever seeds the empty state; the reader's own choice is never
    // overwritten on a data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOptions.length]);

  // Switching the grouping invalidates whatever groups were picked.
  useEffect(() => {
    setSelectedGroups([]);
  }, [dimension]);

  const weekIndices = useMemo(() => {
    if (selectedWeeks.length === 0) return [];
    const byLabel = new Map(weeks.map((w) => [w.shortLabel, w.weekIndex]));
    return selectedWeeks.map((l) => byLabel.get(l)).filter((v): v is number => v !== undefined);
  }, [selectedWeeks, weeks]);

  const report = useMemo(
    () =>
      buildCityTrendReport(disruptions, {
        dimension,
        weekIndices,
        groups: selectedGroups,
        cities: dimension === 'vendor' ? selectedCities : [],
        metric,
      }),
    [disruptions, dimension, weekIndices, selectedGroups, selectedCities, metric]
  );

  /**
   * Colour is keyed to the group name, not to its position in the ranked list,
   * so filtering the chart never repaints the survivors. The slot order itself
   * is the CVD-safety mechanism, so it is walked in order over the stable
   * alphabetical list rather than over the ranking.
   */
  const colourFor = useMemo(() => {
    const map = new Map<string, string>();
    groupOptions.forEach((label, i) => {
      map.set(label.toUpperCase(), SERIES_VARS[i % SERIES_VARS.length]);
    });
    return map;
  }, [groupOptions]);

  const plotted = report.rows.slice(0, MAX_SERIES);
  const folded = report.rows.length - plotted.length;

  /**
   * Direct end-of-line labels are drawn at four series or fewer. Past that the
   * only things carrying identity are the legend and the colour - and three of
   * the light-mode slots sit under 3:1 against white, which is a documented
   * relief case: the numbers have to be visible, not merely available behind a
   * toggle. So the table opens itself once the labels drop off, and the
   * reader's own choice still wins over that.
   */
  const labelsOnChart = plotted.length <= 4;
  const showTable = tableChoice ?? !labelsOnChart;

  const series: LineSeries[] = plotted.map((row) => ({
    key: row.key,
    label: row.label,
    color: colourFor.get(row.label.toUpperCase()) ?? SERIES_VARS[0],
    values: seriesValues(row, report.weeks, metric),
  }));

  const categories = report.weeks.map((w) => w.shortLabel);
  const categoryTitles = report.weeks.map((w) => w.longLabel);

  const dimensionLabel = dimension === 'city' ? 'City' : 'Vendor';
  const scopeNote =
    dimension === 'vendor' && selectedCities.length > 0
      ? ` in ${selectedCities.join(', ')}`
      : '';

  const handleDownloadPng = async () => {
    setIsGeneratingPng(true);
    setExportNote(null);
    try {
      await exportActiveReportToPNG(
        REPORT_ELEMENT_ID,
        `${dimensionLabel}_Trend_${getReportFileTimestamp()}.png`
      );
      setExportNote('PNG downloaded.');
    } catch (err: any) {
      setExportNote(err?.message || 'Could not generate the PNG.');
    } finally {
      setIsGeneratingPng(false);
      setTimeout(() => setExportNote(null), 4000);
    }
  };

  const handleDownloadCsv = () => {
    const header = [dimensionLabel, ...report.weeks.map((w) => `W${w.isoWeek}`), 'Total'];
    const lines = [header.map(csvCell).join(',')];
    for (const row of report.rows) {
      lines.push(
        [
          csvCell(row.label),
          ...report.weeks.map((w) => csvCell(row.cells.get(w.weekIndex)?.[metric] ?? 0)),
          csvCell(row.total[metric]),
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dimensionLabel}_Trend_${TREND_METRIC_LABELS[metric]}_${getReportFileTimestamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div id="city-trends-page" className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
              <LineChartIcon className="w-5 h-5 text-sky-300" />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-wider text-white">City &amp; Vendor Trend</h2>
              <p className="text-xs text-slate-400">
                Week by week, by ISO week number — where it is getting worse, and who it belongs to.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2" data-export-exclude="true">
            <button
              id="download-trend-png-btn"
              type="button"
              onClick={handleDownloadPng}
              disabled={isGeneratingPng}
              className="px-3.5 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold text-xs transition flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              <ImageIcon className="w-4 h-4" />
              <span>{isGeneratingPng ? 'Rendering…' : 'PNG'}</span>
            </button>
            <button
              id="download-trend-csv-btn"
              type="button"
              onClick={handleDownloadCsv}
              className="px-3.5 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {exportNote && (
          <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
            {exportNote}
          </div>
        )}

        {/* Filters: one row, above everything they scope. */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200" data-export-exclude="true">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Group by</span>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                <button
                  id="trend-dimension-city"
                  type="button"
                  onClick={() => setDimension('city')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                    dimension === 'city' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  City
                </button>
                <button
                  id="trend-dimension-vendor"
                  type="button"
                  onClick={() => setDimension('vendor')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                    dimension === 'vendor' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  Vendor
                </button>
              </div>
            </div>

            <MultiSelect
              id="trend-week-select"
              label="Weeks"
              options={weekOptions}
              selected={selectedWeeks}
              onChange={setSelectedWeeks}
              allLabel="All weeks"
              searchable
            />

            <MultiSelect
              id="trend-group-select"
              label={dimension === 'city' ? 'Cities' : 'Vendors'}
              options={groupOptions}
              selected={selectedGroups}
              onChange={setSelectedGroups}
              allLabel={dimension === 'city' ? 'All cities' : 'All vendors'}
              searchable
              maxSelected={MAX_SERIES}
              capNote={`At most ${MAX_SERIES} lines — past that the colours stop being distinguishable.`}
            />

            {/* Vendor view only: "which vendor breaks most in Delhi" is a vendor
                chart scoped to a city, so the city filter becomes a scope. */}
            {dimension === 'vendor' && (
              <MultiSelect
                id="trend-city-scope-select"
                label="Within cities"
                options={cityOptions}
                selected={selectedCities}
                onChange={setSelectedCities}
                allLabel="All cities"
                searchable
              />
            )}

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Measure</span>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                {METRIC_ORDER.map((m) => (
                  <button
                    key={m}
                    id={`trend-metric-${m}`}
                    type="button"
                    onClick={() => setMetric(m)}
                    title={TREND_METRIC_HINTS[m]}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                      metric === m ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {TREND_METRIC_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">View</span>
              <button
                id="trend-table-toggle"
                type="button"
                onClick={() => setTableChoice(!showTable)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <TableIcon className="w-3.5 h-3.5" />
                {showTable ? 'Hide numbers' : 'Show numbers'}
              </button>
            </div>
          </div>
        </div>

        {/* What gets captured in the PNG. */}
        <div id={REPORT_ELEMENT_ID} className="bg-white">
          <div className="px-6 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <BrandMark size="sm" />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
              {report.weeks.length} week{report.weeks.length === 1 ? '' : 's'} · generated{' '}
              {formatReportGeneratedTimestamp()}
            </span>
          </div>

          <div className="p-5">
            <LineTrendChart
              categories={categories}
              categoryTitles={categoryTitles}
              series={series}
              title={`${TREND_METRIC_LABELS[metric]} per week, by ${dimensionLabel.toLowerCase()}${scopeNote}`}
              subtitle={TREND_METRIC_HINTS[metric]}
              valueSuffix={metric === 'hours' ? 'h' : ''}
              height={320}
              emptyMessage="No disruption falls in the selected weeks."
              footnote={
                metric === 'instances'
                  ? 'Instances are counted inside each week, so a ticket whose runs straddle a Sunday counts once in each of the two weeks. The Total column counts it once over the whole span.'
                  : undefined
              }
            />

            {/* Caveats sit with the chart, not in a help page. */}
            {(folded > 0 || report.undatedRecords > 0 || report.ungroupedRecords > 0) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-[11px] text-slate-700 leading-relaxed">
                  {folded > 0 && (
                    <>
                      {folded} more {dimension === 'city' ? 'city' : 'vendor'}
                      {folded === 1 ? '' : 's'} {folded === 1 ? 'is' : 'are'} in the data but not plotted — the
                      chart holds {MAX_SERIES} lines. They are all in the numbers table and the CSV.{' '}
                    </>
                  )}
                  {report.undatedRecords > 0 && (
                    <>
                      {report.undatedRecords} row{report.undatedRecords === 1 ? '' : 's'} have no readable
                      start time and cannot be put in a week.{' '}
                    </>
                  )}
                  {report.ungroupedRecords > 0 && (
                    <>
                      {report.ungroupedRecords} row{report.ungroupedRecords === 1 ? '' : 's'} have no{' '}
                      {dimension} recorded and are grouped under “Not set”.
                    </>
                  )}
                </p>
              </div>
            )}

            {/* The table view. The relief rule requires it: three light-mode
                slots are under 3:1 against white, so every value a line carries
                is reachable without reading a colour. */}
            {showTable && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-bold">{dimensionLabel}</th>
                      {report.weeks.map((w) => (
                        <th key={w.weekIndex} className="px-3 py-2.5 text-right font-bold" title={w.longLabel}>
                          W{w.isoWeek}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={report.weeks.length + 2}
                          className="px-3 py-8 text-center text-slate-500"
                        >
                          Nothing in the selected weeks.
                        </td>
                      </tr>
                    )}
                    {report.rows.map((row, i) => (
                      <tr key={row.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-semibold text-slate-800">
                          <span className="inline-flex items-center gap-2">
                            {i < MAX_SERIES ? (
                              <span
                                aria-hidden="true"
                                className="inline-block w-3.5 h-0.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    colourFor.get(row.label.toUpperCase()) ?? SERIES_VARS[0],
                                }}
                              />
                            ) : (
                              <span aria-hidden="true" className="inline-block w-3.5 shrink-0" />
                            )}
                            {row.label}
                          </span>
                        </td>
                        {report.weeks.map((w) => {
                          const cell = row.cells.get(w.weekIndex);
                          return (
                            <td
                              key={w.weekIndex}
                              className={`px-3 py-2.5 text-right font-mono ${
                                cell ? 'text-slate-700' : 'text-slate-300'
                              }`}
                            >
                              {cell ? cell[metric] : '—'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                          {row.total[metric]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
