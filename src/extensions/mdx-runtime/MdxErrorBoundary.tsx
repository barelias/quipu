import React from 'react';

interface MdxErrorPreProps {
  /** Short label naming the failure stage (e.g. "validate", "compile", "render"). */
  stage: string;
  /** Parser / compiler / runtime message. */
  message?: string;
  /** Original MDX source to echo back so the user can debug. */
  source?: string;
}

/**
 * Shared styled <pre> for MDX failure surfaces. Used by both the chat
 * block (compile errors, validation rejections) and the future standalone
 * viewer's preview pane. Centralising the look keeps the editor visually
 * consistent between chat and `.mdx` tabs.
 */
export const MdxErrorPre: React.FC<MdxErrorPreProps> = ({ stage, message, source }) => (
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
    {`mdx ${stage} error: ${message ?? 'unknown'}${source ? `\n\n${source}` : ''}`}
  </pre>
);

interface BoundaryProps {
  source?: string;
  children: React.ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error?: string;
}

/**
 * Class-based React error boundary — needed because curated components
 * can still throw at render time (e.g. a string passed where a number
 * was expected). We fall back to the shared error-pre format so the user
 * sees identical chrome whether the failure happened at validate /
 * compile / runtime.
 */
export class MdxErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error: error instanceof Error ? error.message : String(error) };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <MdxErrorPre stage="runtime" message={this.state.error} source={this.props.source} />;
    }
    return this.props.children;
  }
}
