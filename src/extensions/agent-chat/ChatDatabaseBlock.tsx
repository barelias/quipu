import React, { useMemo } from 'react';
import DatabaseViewer from '@/extensions/database-viewer/DatabaseViewer';
import { parseQuipuDb } from '@/extensions/database-viewer/utils/jsonl';

interface ChatDatabaseBlockProps {
  source: string;
}

/**
 * Render a ```quipudb.jsonl fenced block as a read-only DatabaseViewer
 * (`mode='chat'`). On parse error fall back to a styled <pre> showing the
 * source plus the error message — never throw and crash the chat.
 */
const ChatDatabaseBlock: React.FC<ChatDatabaseBlockProps> = ({ source }) => {
  const result = useMemo(() => {
    try {
      parseQuipuDb(source);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [source]);

  if (!result.ok) {
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
        {`quipudb parse error: ${result.error}\n\n${source}`}
      </pre>
    );
  }

  return (
    <div className="my-2">
      <DatabaseViewer content={source} mode="chat" />
    </div>
  );
};

export default ChatDatabaseBlock;
