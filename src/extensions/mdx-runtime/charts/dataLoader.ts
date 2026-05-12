import { useContext, useEffect, useRef, useState } from 'react';
import fs from '@/services/fileSystem';
import { parseQuipuDb } from '@/extensions/database-viewer/utils/jsonl';
import { ChartFileContext } from './ChartFileContext';

const WATCH_DEBOUNCE_MS = 250;

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

function detectFormat(src: string): 'csv' | 'tsv' | 'json' | 'jsonl' | 'quipudb' | 'dir' {
  if (src.startsWith('dir:')) return 'dir';
  const lower = src.toLowerCase();
  if (lower.endsWith('.quipudb.jsonl')) return 'quipudb';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  return 'json';
}

/**
 * Read a workspace directory and shape its entries as data rows so the
 * same chart / stat aggregation surface works on file listings. Returns
 * rows of shape:
 *   { name: string, path: string, isDirectory: boolean, ext: string }
 * where `ext` is the lowercase extension (including the dot) for files,
 * or empty for directories.
 */
async function loadDirSource(src: string, workspacePath: string | null): Promise<ChartRow[]> {
  const rel = src.replace(/^dir:/, '');
  const fullPath = resolveChartSrc(rel, workspacePath);
  const entries = await fs.readDirectory(fullPath);
  return entries.map((e) => {
    const dot = e.name.lastIndexOf('.');
    const ext = !e.isDirectory && dot >= 0 ? e.name.slice(dot).toLowerCase() : '';
    return { name: e.name, path: e.path, isDirectory: e.isDirectory, ext };
  });
}

/**
 * Parse raw file text into an array of row objects.
 *
 * Errors are thrown for the caller to catch and turn into a fallback
 * render. Numeric coercion is best-effort — papaparse's `dynamicTyping`
 * handles CSV/TSV; JSON/JSONL preserve types as authored.
 */
export async function parseChartFile(text: string, format: ReturnType<typeof detectFormat>): Promise<ChartRow[]> {
  if (format === 'dir') {
    // Caller routes dir: sources through loadDirSource directly — this
    // branch is unreachable for valid use but keeps the union exhaustive.
    return [];
  }
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
 * Hook: load `src`, parse by extension, and return rows for charts to
 * render.
 *
 * By default the file is loaded once on mount — chat messages are
 * ephemeral and watching every chart in scrollback would leak listeners.
 * When the surrounding `ChartFileContext` enables watching (the
 * standalone MDX viewer does this for its preview pane), the hook also
 * listens for `quipu:file-changed` window events (dispatched by
 * TabContext from the workspace's file watcher) and re-reads on a
 * 250ms debounce so a flurry of save events collapses to one reload.
 */
export function useChartFile(src: string | undefined): ChartDataState {
  const [state, setState] = useState<ChartDataState>(EMPTY);
  const { watch } = useContext(ChartFileContext);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!src) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    const workspacePath = getWorkspacePath();
    const format = detectFormat(src);
    // `dir:` sources resolve through readDirectory instead of readFile,
    // shaping each entry into a row { name, path, isDirectory, ext }.
    const fullPath = format === 'dir' ? src : resolveChartSrc(src, workspacePath);

    async function load() {
      setState(prev => ({ rows: prev.rows, error: null, loading: true }));
      try {
        const rows = format === 'dir'
          ? await loadDirSource(src!, workspacePath)
          : await parseChartFile(await fs.readFile(fullPath), format);
        if (cancelled) return;
        setState({ rows, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        setState({ rows: null, error: err instanceof Error ? err.message : String(err), loading: false });
      }
    }

    void load();

    if (!watch) {
      return () => {
        cancelled = true;
      };
    }

    // Watching: re-read on any quipu:file-changed event whose path
    // matches our resolved fullPath. Multiple chart components can co-
    // subscribe — window events are multi-listener, no IPC clobber.
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { path?: string } | undefined;
      if (!detail?.path) return;
      if (detail.path !== fullPath) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!cancelled) void load();
      }, WATCH_DEBOUNCE_MS);
    };
    window.addEventListener('quipu:file-changed', handler);

    return () => {
      cancelled = true;
      window.removeEventListener('quipu:file-changed', handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [src, watch]);

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
