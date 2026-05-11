import React, { useEffect, useState } from 'react';
import { MDX_COMPONENTS, validateMdxSource } from './mdx-components';

interface ChatMdxBlockProps {
  source: string;
}

interface MdxState {
  kind: 'pending' | 'ready' | 'error';
  Content?: React.ComponentType;
  error?: string;
}

/**
 * Render a ```mdx fenced block as a curated React surface.
 *
 * Defense in depth:
 *   1. validateMdxSource() rejects `import`, `export`, dangerouslySetInnerHTML,
 *      __html, and <script>; on rejection we render the error pre.
 *   2. @mdx-js/mdx evaluate() runs with our curated `useMDXComponents` map.
 *      Unknown tags fall through to MDX defaults (plain elements) and cannot
 *      reach arbitrary DOM attributes because each mapped element omits
 *      `{...rest}` spreading.
 *   3. An error boundary catches runtime render errors and shows the same
 *      error pre — the chat never crashes from MDX.
 *
 * Network sandboxing: evaluate() does not fetch remote modules; it compiles
 * source into a Function and runs it locally. Anchors are scrubbed via the
 * SafeAnchor component in the components map.
 */
const ChatMdxBlock: React.FC<ChatMdxBlockProps> = ({ source }) => {
  const [state, setState] = useState<MdxState>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    const rejection = validateMdxSource(source);
    if (rejection) {
      setState({ kind: 'error', error: rejection });
      return;
    }

    // Dynamic import keeps @mdx-js/mdx out of the chat startup bundle —
    // only loaded when an MDX block actually appears.
    (async () => {
      try {
        const [{ evaluate }, jsxRuntime] = await Promise.all([
          import('@mdx-js/mdx'),
          import('react/jsx-runtime'),
        ]);
        const mod = await evaluate(source, {
          ...(jsxRuntime as any),
          useMDXComponents: () => MDX_COMPONENTS,
        });
        if (cancelled) return;
        setState({ kind: 'ready', Content: mod.default as React.ComponentType });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.kind === 'pending') {
    return <div className="my-2 text-xs text-text-tertiary">Rendering…</div>;
  }

  if (state.kind === 'error' || !state.Content) {
    return (
      <pre
        className="agent-custom-block-error"
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '0.6rem 0.8rem',
          fontSize: '0.8rem',
          color: 'var(--color-error)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {`mdx render error: ${state.error ?? 'unknown'}\n\n${source}`}
      </pre>
    );
  }

  const Content = state.Content;
  return (
    <ChatMdxErrorBoundary source={source}>
      <div className="agent-mdx-block my-2 rounded-md border border-border bg-bg-surface px-3 py-2">
        <Content />
      </div>
    </ChatMdxErrorBoundary>
  );
};

interface BoundaryProps {
  source: string;
  children: React.ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error?: string;
}

/**
 * Class-based React error boundary — needed because curated components can
 * still throw at render time (e.g. a string passed where a number was
 * expected). We fall back to the same error-pre format.
 */
class ChatMdxErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error: error instanceof Error ? error.message : String(error) };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <pre
          className="agent-custom-block-error"
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '0.6rem 0.8rem',
            fontSize: '0.8rem',
            color: 'var(--color-error)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {`mdx runtime error: ${this.state.error ?? 'unknown'}\n\n${this.props.source}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

export default ChatMdxBlock;
