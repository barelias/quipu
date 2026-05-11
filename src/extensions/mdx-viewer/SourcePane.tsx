import React, { useCallback, useRef } from 'react';

interface SourcePaneProps {
  value: string;
  onChange: (next: string) => void;
}

const TAB_INSERT = '  ';

/**
 * Plain textarea-based MDX source editor. v1 trades Monaco's ~5MB
 * bundle weight for a lightweight surface most users will spend more
 * time previewing than editing. Tab inserts two spaces so the textarea
 * doesn't fight common indentation muscle memory.
 */
const SourcePane: React.FC<SourcePaneProps> = ({ value, onChange }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;
    const next = value.slice(0, selectionStart) + TAB_INSERT + value.slice(selectionEnd);
    onChange(next);
    // Restore caret position right after the inserted tab spaces.
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = selectionStart + TAB_INSERT.length;
    });
  }, [value, onChange]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      className="w-full h-full resize-none border-0 outline-none bg-page-bg text-page-text font-mono text-sm leading-relaxed py-3"
      style={{ paddingInline: 'var(--db-h-pad)' }}
      placeholder="# MDX source

Write markdown and JSX. Components available: Card, Callout, Badge, Stat, Row, Col, LineChart, BarChart, AreaChart, PieChart."
    />
  );
};

export default SourcePane;
