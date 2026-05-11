import { createContext } from 'react';

export interface ChartFileOptions {
  /**
   * When true, chart components re-read their `src` file on
   * `quipu:file-changed` window events (dispatched by TabContext).
   *
   * Defaults to `false` so chat messages — which are ephemeral and would
   * accumulate watcher subscriptions across scrollback — keep their
   * existing one-shot behaviour. The standalone .mdx viewer flips it on
   * via a Provider so editing the underlying CSV / JSONL / quipudb.jsonl
   * rebuilds the preview live.
   */
  watch: boolean;
}

export const DEFAULT_CHART_FILE_OPTIONS: ChartFileOptions = { watch: false };

export const ChartFileContext = createContext<ChartFileOptions>(DEFAULT_CHART_FILE_OPTIONS);
