import React from 'react';

interface ChatDatabaseBlockProps {
  source: string;
}

/**
 * Placeholder. Unit 9 replaces this with a read-only DatabaseViewer
 * (mode='chat'). For now we render the raw source so the dispatcher can
 * still upgrade the block — the upgraded surface is just minimal until
 * the next unit lands.
 */
const ChatDatabaseBlock: React.FC<ChatDatabaseBlockProps> = ({ source }) => {
  return (
    <pre
      className="agent-custom-block-fallback"
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '0.6rem 0.8rem',
        fontSize: '0.8rem',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {source}
    </pre>
  );
};

export default ChatDatabaseBlock;
