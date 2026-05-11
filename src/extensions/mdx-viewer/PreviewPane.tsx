import React, { useEffect, useRef, useState } from 'react';
import { compileMdxSource, type CompileResult } from '@/extensions/mdx-runtime/compile';
import { MdxErrorBoundary, MdxErrorPre } from '@/extensions/mdx-runtime/MdxErrorBoundary';

interface PreviewPaneProps {
  source: string;
  /** Debounce window before recompiling on source changes (ms). */
  debounceMs?: number;
}

type PreviewState =
  | { kind: 'pending' }
  | { kind: 'ready'; Content: React.ComponentType }
  | { kind: 'error'; stage: string; error: string };

/**
 * Live MDX preview. Recompiles the source on a 500ms debounce so quick
 * edits don't thrash the compiler. The most recent successful render
 * stays visible while a new compile is in flight — feels live without
 * the "blank preview between every keystroke" flicker.
 */
const PreviewPane: React.FC<PreviewPaneProps> = ({ source, debounceMs = 500 }) => {
  const [state, setState] = useState<PreviewState>({ kind: 'pending' });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (cancelRef.current) cancelRef.current.cancelled = true;

    const token = { cancelled: false };
    cancelRef.current = token;

    timeoutRef.current = setTimeout(() => {
      compileMdxSource(source).then((result: CompileResult) => {
        if (token.cancelled) return;
        if (result.ok) {
          setState({ kind: 'ready', Content: result.Content });
        } else {
          setState({ kind: 'error', stage: result.stage, error: result.error });
        }
      });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      token.cancelled = true;
    };
  }, [source, debounceMs]);

  return (
    <div className="w-full h-full overflow-auto py-3" style={{ paddingInline: 'var(--db-h-pad)' }}>
      {state.kind === 'pending' && (
        <div className="text-xs text-text-tertiary">Compiling…</div>
      )}
      {state.kind === 'error' && (
        <MdxErrorPre stage={state.stage} message={state.error} source={source} />
      )}
      {state.kind === 'ready' && (
        <MdxErrorBoundary source={source}>
          <state.Content />
        </MdxErrorBoundary>
      )}
    </div>
  );
};

export default PreviewPane;
