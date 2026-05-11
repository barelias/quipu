import React, { useEffect, useState } from 'react';
import { compileMdxSource, type CompileResult } from '@/extensions/mdx-runtime/compile';
import { MdxErrorBoundary, MdxErrorPre } from '@/extensions/mdx-runtime/MdxErrorBoundary';

interface ChatMdxBlockProps {
  source: string;
}

type MdxState =
  | { kind: 'pending' }
  | { kind: 'ready'; Content: React.ComponentType }
  | { kind: 'error'; stage: string; error: string };

/**
 * Render a ```mdx fenced block as a curated React surface.
 *
 * Defense in depth lives in @/extensions/mdx-runtime:
 *   1. validateMdxSource() rejects `import`, `export`,
 *      dangerouslySetInnerHTML, __html, and <script>.
 *   2. @mdx-js/mdx evaluate() runs with the curated MDX_COMPONENTS map.
 *      Unknown tags fall through to MDX defaults and cannot reach DOM
 *      attributes because every mapped element omits `{...rest}` spread.
 *   3. MdxErrorBoundary catches runtime render errors and renders the
 *      shared MdxErrorPre so chat never crashes from MDX.
 */
const ChatMdxBlock: React.FC<ChatMdxBlockProps> = ({ source }) => {
  const [state, setState] = useState<MdxState>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    compileMdxSource(source).then((result: CompileResult) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: 'ready', Content: result.Content });
      } else {
        setState({ kind: 'error', stage: result.stage, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.kind === 'pending') {
    return <div className="my-2 text-xs text-text-tertiary">Rendering…</div>;
  }

  if (state.kind === 'error') {
    return <MdxErrorPre stage={state.stage} message={state.error} source={source} />;
  }

  const Content = state.Content;
  return (
    <MdxErrorBoundary source={source}>
      <div className="agent-mdx-block my-2 rounded-md border border-border bg-bg-surface px-3 py-2">
        <Content />
      </div>
    </MdxErrorBoundary>
  );
};

export default ChatMdxBlock;
