import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart as RLineChart,
  Line,
  BarChart as RBarChart,
  Bar,
  AreaChart as RAreaChart,
  Area,
  PieChart as RPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useChartFile, pivotWide, type ChartRow } from './dataLoader';

/**
 * MDX chart wrappers around Recharts. The agent emits one of:
 *
 *   <LineChart  src="…" x=".." y=".." [series=".."] />
 *   <BarChart   src="…" x=".." y=".." [series=".."] [stacked] />
 *   <AreaChart  src="…" x=".." y=".." [series=".."] [stacked] />
 *   <PieChart   src="…" label=".." value=".." />
 *
 * `data={[…]}` may be used instead of `src` when the dataset is small
 * enough to inline. `series` pivots long data into wide shape — one line
 * / bar / area per distinct value of the `series` column.
 *
 * Props are explicitly typed; no `{...rest}` spreading. Same security
 * posture as the rest of the curated MDX surface.
 */

const QUIPU_PALETTE = [
  'var(--color-accent, #c4835a)',
  '#6366f1', // indigo
  '#22c55e', // green
  '#eab308', // yellow
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#8b5cf6', // violet
];

interface CommonProps {
  src?: string;
  data?: ChartRow[];
  x: string;
  y: string | string[];
  series?: string;
  height?: number;
  title?: string;
}

interface StackableProps extends CommonProps {
  stacked?: boolean;
}

interface PieProps {
  src?: string;
  data?: ChartRow[];
  label: string;
  value: string;
  height?: number;
  title?: string;
}

/** Shell wrapping title, loading/error states, and the chart slot. */
function ChartShell({
  title,
  height = 240,
  loading,
  error,
  children,
}: {
  title?: string;
  height?: number;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="my-2 rounded-md border border-border bg-bg-surface p-3">
      {title && <div className="text-xs font-medium text-text-secondary mb-2">{title}</div>}
      {error ? (
        <pre className="text-xs text-error whitespace-pre-wrap">{`chart error: ${error}`}</pre>
      ) : loading ? (
        <div className="text-xs text-text-tertiary py-3">Loading data…</div>
      ) : (
        <div style={{ width: '100%', height }}>{children}</div>
      )}
    </div>
  );
}

/**
 * Resolve to the dataset Recharts will consume and the list of series
 * keys to render. Honours both wide (`y` is a string or string[]) and
 * long (`series` is a column name to pivot on) shapes.
 */
function useChartData(
  src: string | undefined,
  data: ChartRow[] | undefined,
  x: string,
  y: string | string[],
  series?: string,
): { rows: ChartRow[]; seriesNames: string[]; loading: boolean; error: string | null } {
  const fromFile = useChartFile(src);
  const rows = data ?? fromFile.rows ?? [];

  return useMemo(() => {
    if (fromFile.loading || fromFile.error) {
      return { rows: [], seriesNames: [], loading: fromFile.loading, error: fromFile.error };
    }
    if (rows.length === 0) {
      return { rows: [], seriesNames: [], loading: false, error: 'No data rows. Check that the file has a header and at least one row.' };
    }

    const available = Object.keys(rows[0] as object);
    const missing: string[] = [];
    if (!available.includes(x)) missing.push(`x="${x}"`);
    const yKeys = Array.isArray(y) ? y : [y];
    if (!series) {
      for (const k of yKeys) if (!available.includes(k)) missing.push(`y="${k}"`);
    }
    if (series && !available.includes(series)) missing.push(`series="${series}"`);
    if (missing.length > 0) {
      return {
        rows: [],
        seriesNames: [],
        loading: false,
        error: `Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. Available: ${available.join(', ')}`,
      };
    }

    if (series && typeof y === 'string') {
      const pivoted = pivotWide(rows, x, y, series);
      if (pivoted.seriesNames.length === 0) {
        return { rows: [], seriesNames: [], loading: false, error: `series="${series}" has no values in the data` };
      }
      return { rows: pivoted.rows, seriesNames: pivoted.seriesNames, loading: false, error: null };
    }
    return { rows, seriesNames: yKeys, loading: false, error: null };
  }, [rows, x, y, series, fromFile.loading, fromFile.error]);
}

// --- LineChart ---

export const LineChart: React.FC<CommonProps> = ({ src, data, x, y, series, height, title }) => {
  const { rows, seriesNames, loading, error } = useChartData(src, data, x, y, series);
  return (
    <ChartShell title={title} height={height} loading={loading} error={error}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey={x} stroke="var(--color-text-tertiary)" fontSize={11} />
          <YAxis stroke="var(--color-text-tertiary)" fontSize={11} />
          <Tooltip contentStyle={tooltipStyle} />
          {seriesNames.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {seriesNames.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={QUIPU_PALETTE[i % QUIPU_PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

// --- BarChart ---

export const BarChart: React.FC<StackableProps> = ({ src, data, x, y, series, stacked, height, title }) => {
  const { rows, seriesNames, loading, error } = useChartData(src, data, x, y, series);
  return (
    <ChartShell title={title} height={height} loading={loading} error={error}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey={x} stroke="var(--color-text-tertiary)" fontSize={11} />
          <YAxis stroke="var(--color-text-tertiary)" fontSize={11} />
          <Tooltip contentStyle={tooltipStyle} />
          {seriesNames.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {seriesNames.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              fill={QUIPU_PALETTE[i % QUIPU_PALETTE.length]}
              stackId={stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

// --- AreaChart ---

export const AreaChart: React.FC<StackableProps> = ({ src, data, x, y, series, stacked, height, title }) => {
  const { rows, seriesNames, loading, error } = useChartData(src, data, x, y, series);
  return (
    <ChartShell title={title} height={height} loading={loading} error={error}>
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey={x} stroke="var(--color-text-tertiary)" fontSize={11} />
          <YAxis stroke="var(--color-text-tertiary)" fontSize={11} />
          <Tooltip contentStyle={tooltipStyle} />
          {seriesNames.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {seriesNames.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={QUIPU_PALETTE[i % QUIPU_PALETTE.length]}
              fill={QUIPU_PALETTE[i % QUIPU_PALETTE.length]}
              fillOpacity={0.3}
              stackId={stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          ))}
        </RAreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

// --- PieChart ---

export const PieChart: React.FC<PieProps> = ({ src, data, label, value, height, title }) => {
  const fromFile = useChartFile(src);
  const rows = data ?? fromFile.rows ?? [];

  let error: string | null = fromFile.error;
  if (!fromFile.loading && !error) {
    if (rows.length === 0) {
      error = 'No data rows. Check that the file has a header and at least one row.';
    } else {
      const available = Object.keys(rows[0] as object);
      const missing: string[] = [];
      if (!available.includes(label)) missing.push(`label="${label}"`);
      if (!available.includes(value)) missing.push(`value="${value}"`);
      if (missing.length > 0) {
        error = `Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. Available: ${available.join(', ')}`;
      }
    }
  }

  return (
    <ChartShell title={title} height={height} loading={fromFile.loading} error={error}>
      <ResponsiveContainer width="100%" height="100%">
        <RPieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={rows}
            dataKey={value}
            nameKey={label}
            outerRadius="75%"
            isAnimationActive={false}
            label={(entry: any) => String(entry[label] ?? '')}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={QUIPU_PALETTE[i % QUIPU_PALETTE.length]} />
            ))}
          </Pie>
        </RPieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
};

const tooltipStyle: React.CSSProperties = {
  background: 'var(--color-bg-overlay)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
};
