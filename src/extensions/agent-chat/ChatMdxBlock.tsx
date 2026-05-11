import React from 'react';

interface ChatMdxBlockProps {
  source: string;
}

/**
 * Placeholder. Unit 10 replaces this with @mdx-js/mdx evaluate() driving a
 * curated component palette (Card, Callout, Badge, Stat, Row, Col). Until
 * that lands we render the raw source so the dispatcher's wiring is
 * exercised end-to-end.
 */
const ChatMdxBlock: React.FC<ChatMdxBlockProps> = ({ source }) => {
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

export default ChatMdxBlock;
