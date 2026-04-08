import { useMemo } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PlayIcon } from '@phosphor-icons/react';
import CellOutput from './CellOutput';
import type { NotebookOutput } from './CellOutput';

/** A single cell from a Jupyter notebook (nbformat 4 shape) */
interface NotebookCellData {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

/** Notebook top-level structure (nbformat 4) */
interface Notebook {
  cells: NotebookCellData[];
  metadata?: {
    kernelspec?: { language?: string; name?: string; display_name?: string };
    language_info?: { name?: string };
    [key: string]: unknown;
  };
  nbformat?: number;
  nbformat_minor?: number;
}

/** Per-cell execution state tracked by NotebookViewer */
interface CellState {
  running: boolean;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

function joinSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join('');
  return String(source ?? '');
}

interface ExecutionCountProps {
  count: number | null;
  running: boolean;
}

function ExecutionCount({ count, running }: ExecutionCountProps) {
  const label = running ? '[*]' : count == null ? '[ ]' : `[${count}]`;
  return (
    <div className="w-12 shrink-0 text-right text-text-tertiary text-xs font-mono pt-1 select-none pr-2">
      {label}
    </div>
  );
}

interface MarkdownCellProps {
  source: string;
}

function MarkdownCell({ source }: MarkdownCellProps) {
  const html = useMemo(() => {
    const raw = marked.parse(source, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [source]);

  return (
    <div
      className="prose prose-sm max-w-none px-4 py-2 text-text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface CodeCellSourceProps {
  source: string;
  language: string;
}

function CodeCellSource({ source, language }: CodeCellSourceProps) {
  if (!source.trim()) return null;
  return (
    <MonacoEditor
      value={source}
      language={language ?? 'python'}
      height={Math.min(Math.max(source.split('\n').length * 19 + 8, 40), 400)}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        renderLineHighlight: 'none',
        scrollbar: { vertical: 'hidden', horizontal: 'auto' },
        wordWrap: 'on',
        fontSize: 13,
        padding: { top: 4, bottom: 4 },
      }}
      theme="vs-dark"
    />
  );
}

function inferLanguage(notebook: Notebook | null | undefined): string {
  return notebook?.metadata?.kernelspec?.language
    ?? notebook?.metadata?.language_info?.name
    ?? 'python';
}

interface NotebookCellProps {
  cell: NotebookCellData;
  language: string;
  cellState?: CellState;
  onRun: ((source: string) => void) | null;
}

const NotebookCell = ({ cell, language, cellState, onRun }: NotebookCellProps) => {
  const source = joinSource(cell.source);

  if (cell.cell_type === 'markdown') {
    return (
      <div className="border-b border-border last:border-b-0">
        <MarkdownCell source={source} />
      </div>
    );
  }

  if (cell.cell_type === 'raw') {
    return (
      <div className="border-b border-border last:border-b-0 px-4 py-2">
        <pre className="text-text-tertiary text-sm font-mono whitespace-pre-wrap">{source}</pre>
      </div>
    );
  }

  // code cell
  const isRunning = cellState?.running ?? false;
  const outputs = cellState?.outputs ?? (cell.outputs ?? []);
  const executionCount = cellState?.executionCount ?? cell.execution_count ?? null;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Source row */}
      <div className="flex items-start bg-bg-base group">
        <ExecutionCount count={executionCount} running={isRunning} />
        <div className="flex-1 min-w-0 border border-border rounded my-1 overflow-hidden">
          <CodeCellSource source={source} language={language} />
        </div>
        {onRun && (
          <button
            onClick={() => onRun(source)}
            disabled={isRunning || !source.trim()}
            className="mt-1 mx-1 flex items-center justify-center h-6 w-6 shrink-0 rounded text-text-tertiary hover:text-accent hover:bg-white/[0.06] disabled:opacity-30 transition-colors opacity-0 group-hover:opacity-100"
            title="Run cell"
          >
            <PlayIcon size={13} />
          </button>
        )}
      </div>

      {/* Outputs */}
      {outputs.length > 0 && (
        <div className="flex items-start pl-12 pr-2 pb-2 bg-bg-surface">
          <div className="flex-1 min-w-0 space-y-1">
            {outputs.map((output, i) => (
              <CellOutput key={i} output={output} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export type { NotebookCellData, Notebook, CellState };
export { inferLanguage, joinSource };
export default NotebookCell;
