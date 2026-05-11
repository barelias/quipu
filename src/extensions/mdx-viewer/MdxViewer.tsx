import React from 'react';
import type { Tab as TabType, ActiveFile } from '@/types/tab';

export interface MdxViewerProps {
  tab?: TabType;
  activeFile?: ActiveFile;
  content?: string | null;
  onContentChange?: (content: string) => void;
  isActive?: boolean;
}

/**
 * Placeholder MdxViewer for Unit 2 — registration only. Unit 3 replaces
 * this with the real split-pane source/preview viewer. Keeping the shell
 * tiny here lets us verify the extension registry plumbs .mdx tabs to
 * this component before touching the heavier UI.
 */
const MdxViewer: React.FC<MdxViewerProps> = ({ activeFile, content: directContent }) => {
  const content =
    directContent !== undefined
      ? directContent
      : typeof activeFile?.content === 'string'
        ? activeFile.content
        : '';

  return (
    <div className="flex-1 flex flex-col bg-page-bg overflow-hidden">
      <div className="shrink-0 pt-10 pb-2" style={{ paddingInline: 'var(--db-h-pad)' }}>
        <h1 className="text-2xl font-bold text-page-text mb-1">{activeFile?.name ?? 'Untitled.mdx'}</h1>
        <div className="text-xs text-page-text/50">MDX viewer placeholder — Unit 3 replaces this surface.</div>
      </div>
      <div className="flex-1 overflow-auto" style={{ paddingInline: 'var(--db-h-pad)' }}>
        <pre className="text-sm text-page-text font-mono whitespace-pre-wrap py-2">{content ?? ''}</pre>
      </div>
    </div>
  );
};

export default MdxViewer;
