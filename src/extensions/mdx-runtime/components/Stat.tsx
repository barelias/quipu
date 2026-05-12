import React, { useMemo } from 'react';
import { useChartFile } from '../charts/dataLoader';
import { aggregate, filterRows, parseWhere, type StatAggregate } from '../charts/aggregate';

interface StatProps {
  label?: string;
  /** Static value — used when no `src` is supplied. */
  value?: React.ReactNode;
  hint?: string;
  /**
   * Workspace file or directory to derive the value from. Accepts the
   * same formats as charts (.csv / .tsv / .json / .jsonl /
   * .quipudb.jsonl) plus a `dir:<path>` source that returns rows
   * `{ name, path, isDirectory, ext }` from the directory listing.
   */
  src?: string;
  /** What to compute. Defaults to `count` when `src` is set. */
  aggregate?: StatAggregate;
  /** Column for sum / avg / min / max / first. */
  column?: string;
  /**
   * Optional filter expression — comma-separated `column op value`
   * clauses. Example: `status=done` or `isDirectory=true, ext=.md`.
   */
  where?: string;
  /** Decimal places to show for numeric aggregates. */
  precision?: number;
}

const Stat: React.FC<StatProps> = ({
  label,
  value,
  hint,
  src,
  aggregate: agg,
  column,
  where,
  precision,
}) => {
  const fileState = useChartFile(src);

  const computed = useMemo<React.ReactNode>(() => {
    if (!src) return value;
    if (fileState.loading) return '…';
    if (fileState.error) return '!';
    const rows = fileState.rows ?? [];
    const filtered = where ? filterRows(rows, parseWhere(where)) : rows;
    const result = aggregate(filtered, agg ?? 'count', column);
    if (result === null || result === undefined) return '—';
    if (typeof result === 'number' && precision !== undefined) {
      return result.toFixed(precision);
    }
    return String(result);
  }, [src, value, fileState.loading, fileState.error, fileState.rows, where, agg, column, precision]);

  const errorHint = src && fileState.error ? `error: ${fileState.error}` : hint;

  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-bg-surface px-3 py-2 my-1">
      {label && <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>}
      <div className="text-base font-semibold text-text-primary">{computed}</div>
      {errorHint && <div className="text-xs text-text-secondary">{errorHint}</div>}
    </div>
  );
};

export default Stat;
