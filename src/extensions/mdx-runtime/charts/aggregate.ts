import type { ChartRow } from './dataLoader';

/** Aggregations supported by `<Stat src=...>`. */
export type StatAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first';

/** A single where-clause: `column op value` with type-coerced value. */
interface WhereClause {
  column: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=';
  value: unknown;
}

/**
 * Parse a where expression into a list of AND-combined clauses.
 *
 * Syntax: comma-separated `column op value` triples. Supported ops are
 * `=`, `!=`, `>`, `<`, `>=`, `<=`. Values are coerced — `"true"` /
 * `"false"` become booleans, numeric strings become numbers, everything
 * else stays as a string. Whitespace around tokens is tolerated.
 *
 * Examples:
 *   `status=done`
 *   `status!=done, priority=high`
 *   `isDirectory=true`
 *   `accuracy>70`
 */
export function parseWhere(expr: string | undefined | null): WhereClause[] {
  if (!expr || !expr.trim()) return [];
  const out: WhereClause[] = [];
  for (const raw of expr.split(',')) {
    const piece = raw.trim();
    if (!piece) continue;
    const match = /^(\w[\w.]*)\s*(!=|>=|<=|=|>|<)\s*(.+)$/.exec(piece);
    if (!match) continue;
    const [, column, op, rawValue] = match;
    const trimmedValue = rawValue.trim().replace(/^['"](.*)['"]$/, '$1');
    let value: unknown = trimmedValue;
    if (trimmedValue === 'true') value = true;
    else if (trimmedValue === 'false') value = false;
    else if (trimmedValue === 'null') value = null;
    else if (/^-?\d+(\.\d+)?$/.test(trimmedValue)) value = Number(trimmedValue);
    out.push({ column, op: op as WhereClause['op'], value });
  }
  return out;
}

function compare(a: unknown, op: WhereClause['op'], b: unknown): boolean {
  // Numeric comparison if both sides reduce cleanly.
  if (op === '>' || op === '<' || op === '>=' || op === '<=') {
    const na = typeof a === 'number' ? a : Number(a);
    const nb = typeof b === 'number' ? b : Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return false;
    if (op === '>') return na > nb;
    if (op === '<') return na < nb;
    if (op === '>=') return na >= nb;
    return na <= nb;
  }
  // Equality — loose by intent so `status=done` matches `"done"`.
  /* eslint-disable eqeqeq */
  if (op === '=') return a == b;
  return a != b;
  /* eslint-enable eqeqeq */
}

export function filterRows(rows: ChartRow[], where: WhereClause[]): ChartRow[] {
  if (where.length === 0) return rows;
  return rows.filter((row) =>
    where.every((clause) => compare(row[clause.column], clause.op, clause.value)),
  );
}

/**
 * Compute an aggregate over a (possibly filtered) row set. Returns the
 * raw aggregate value — the caller formats it for display.
 *
 * - `count` ignores `column`.
 * - `sum` / `avg` / `min` / `max` require a numeric `column`.
 * - `first` returns the value at `column` from the first row.
 */
export function aggregate(
  rows: ChartRow[],
  op: StatAggregate,
  column?: string,
): number | string | null {
  if (op === 'count') return rows.length;
  if (rows.length === 0) return null;

  if (op === 'first') {
    if (!column) return rows[0] ? Object.values(rows[0])[0] as string : null;
    return (rows[0][column] as string | number) ?? null;
  }

  if (!column) return null;
  const numbers: number[] = [];
  for (const row of rows) {
    const v = row[column];
    // Skip null / undefined / empty strings — Number() coerces those to
    // 0 or NaN inconsistently and would distort `avg` in particular.
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) numbers.push(n);
  }
  if (numbers.length === 0) return null;
  if (op === 'sum') return numbers.reduce((a, b) => a + b, 0);
  if (op === 'avg') return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  if (op === 'min') return Math.min(...numbers);
  if (op === 'max') return Math.max(...numbers);
  return null;
}
