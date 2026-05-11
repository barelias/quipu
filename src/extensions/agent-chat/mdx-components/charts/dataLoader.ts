import { useEffect, useState } from 'react';
import fs from '@/services/fileSystem';
import { parseQuipuDb } from '@/extensions/database-viewer/utils/jsonl';

/**
 * File-driven chart data loader.
 *
 * Chart components accept either `data` (inline) or `src` (workspace
 * file path). When `src` is set, this loader reads the file and parses
 * by extension into an array of plain row objects ready to feed
 * Recharts.
 *
 * Supported formats:
 *   .csv  / .tsv          → papaparse (header row required)
 *   .json                 → JSON.parse; must be an array of objects
 *   .jsonl                → one JSON object per line
 *   .quipudb.jsonl        → parseQuipuDb (schema line ignored for chart use)
 *
 * The workspace root is discovered from the same DOM marker the inline
 * EmbeddedDatabase uses (`[data-workspace-path]`) so chart blocks work
 * identically inside chat and in a future standalone MDX viewer.
 */

export type ChartRow = Record<string, unknown>;

export interface ChartDataState {
  rows: ChartRow[] | null;
  error: string | null;
  loading: boolean;
}

const EMPTY: ChartDataState = { rows: null, error: null, loading: false };

function getWorkspacePath(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-workspace-path]') as HTMLElement | null;
  return el?.dataset.workspacePath ?? null;
}

/**
 * Resolve a chart `src` to a full filesystem path. Absolute paths are
 * trusted; everything else is treated as workspace-relative.
 */
export function resolveChartSrc(src: string, workspacePath: string | null): string {
  if (!src) return '';
  if (src.startsWith('/')) return src;
  if (!workspacePath) return src;
  return `${workspacePath}/${src}`;
}

function detectFormat(src: string): 'csv' | 'tsv' | 'json' | 'jsonl' | 'quipudb' {
  const lower = src.toLowerCase();
  if (lower.endsWith('.quipudb.jsonl')) return 'quipudb';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  return 'json';
}

/**
 * Parse raw file text into an array of row objects.
 *
 * Errors are thrown for the caller to catch and turn into a fallback
 * render. Numeric coercion is best-effort — papaparse's `dynamicTyping`
 * handles CSV/TSV; JSON/JSONL preserve types as authored.
 */
export async function parseChartFile(text: string, format: ReturnType<typeof detectFormat>): Promise<ChartRow[]> {
  if (!text.trim()) return [];

  if (format === 'csv' || format === 'tsv') {
    // Lazy-load papaparse — only when the chart actually reads a CSV.
    const Papa = (await import('papaparse')).default;
    const delimiter = format === 'tsv' ? '\t' : ',';
    const result = Papa.parse<ChartRow>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter,
    });
    if (result.errors.length > 0) {
      const first = result.errors[0];
      throw new Error(`${format} parse error at row ${first.row}: ${first.message}`);
    }
    return result.data;
  }

  if (format === 'json') {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('chart src .json must be an array of row objects');
    }
    return parsed as ChartRow[];
  }

  if (format === 'jsonl') {
    const out: ChartRow[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        throw new Error(`jsonl parse error on line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }

  // quipudb.jsonl — schema is ignored for chart-data purposes; we just
  // need the typed rows. Rows already carry `_id` and column values.
  const { rows } = parseQuipuDb(text);
  return rows as ChartRow[];
}

/**
 * Hook: load `src` once on mount. Returns loading state, the parsed
 * rows, or an error string. Chat blocks are ephemeral so we don't watch
 * the file for changes here — that lives in the future standalone MDX
 * viewer, which can wrap this loader with the existing file-watcher.
 */
export function useChartFile(src: string | undefined): ChartDataState {
  const [state, setState] = useState<ChartDataState>(EMPTY);

  useEffect(() => {
    if (!src) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ rows: null, error: null, loading: true });

    (async () => {
      try {
        const workspacePath = getWorkspacePath();
        const fullPath = resolveChartSrc(src, workspacePath);
        const text = await fs.readFile(fullPath);
        const rows = await parseChartFile(text, detectFormat(src));
        if (cancelled) return;
        setState({ rows, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        setState({ rows: null, error: err instanceof Error ? err.message : String(err), loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return state;
}

/**
 * Pivot "long" data (one column tagged with a series name) into "wide"
 * shape (one row per x value, one column per series). Used by line/bar/
 * area charts when the user supplies a `series` prop.
 *
 *   long:  [{ date: 'A', model: 'NCA', acc: 70 }, { date: 'A', model: 'TX', acc: 65 }, ...]
 *   wide:  [{ date: 'A', NCA: 70, TX: 65 }, ...]
 *
 * Series names are discovered from the data; unknown rows fall under
 * "Unknown" rather than dropping silently.
 */
export function pivotWide(
  rows: ChartRow[],
  xKey: string,
  yKey: string,
  seriesKey: string,
): { rows: ChartRow[]; seriesNames: string[] } {
  const byX = new Map<unknown, ChartRow>();
  const seriesNames = new Set<string>();

  for (const row of rows) {
    const x = row[xKey];
    const series = String(row[seriesKey] ?? 'Unknown');
    const value = row[yKey];
    seriesNames.add(series);
    if (!byX.has(x)) byX.set(x, { [xKey]: x });
    byX.get(x)![series] = value;
  }

  return {
    rows: Array.from(byX.values()),
    seriesNames: Array.from(seriesNames),
  };
}
