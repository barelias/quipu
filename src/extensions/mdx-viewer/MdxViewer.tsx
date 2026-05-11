import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Tab as TabType, ActiveFile } from '@/types/tab';
import SourcePane from './SourcePane';
import PreviewPane from './PreviewPane';
import MdxToolbar, { type MdxViewMode } from './Toolbar';

export interface MdxViewerProps {
  tab?: TabType;
  activeFile?: ActiveFile;
  content?: string | null;
  onContentChange?: (content: string) => void;
  isActive?: boolean;
}

/**
 * Split-pane viewer for .mdx files.
 *
 * Layout:
 *   ┌─ Toolbar: filename + mode toggle (source / split / preview) ──┐
 *   ├─ Source pane (textarea)  │  Preview pane (compiled MDX) ──────┤
 *   └───────────────────────────────────────────────────────────────┘
 *
 * The source is the canonical input — every keystroke fires
 * onContentChange so the tab's dirty / save flow stays in sync. The
 * preview compiles the live source through `compileMdxSource` (debounce
 * lives inside PreviewPane). Errors render inline in the preview pane
 * via the shared MdxErrorPre so the source pane never disappears.
 */
const MdxViewer: React.FC<MdxViewerProps> = ({
  activeFile,
  onContentChange,
  content: directContent,
}) => {
  const initial =
    directContent !== undefined
      ? (directContent ?? '')
      : typeof activeFile?.content === 'string'
        ? activeFile.content
        : '';

  const [source, setSource] = useState<string>(initial);
  const [mode, setMode] = useState<MdxViewMode>('split');
  const isInitializedRef = useRef(false);

  // Pull in external content updates (file watcher / undo / etc) without
  // firing onContentChange ourselves — same pattern as the database
  // viewer's content sync. Only re-seed if the incoming value differs.
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }
    if (initial !== source) {
      setSource(initial);
    }
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSourceChange = useCallback(
    (next: string) => {
      setSource(next);
      onContentChange?.(next);
    },
    [onContentChange],
  );

  const fileName = activeFile?.name ?? 'Untitled.mdx';
  const isDirty = source !== initial;

  return (
    <div className="flex-1 flex flex-col bg-page-bg overflow-hidden">
      <MdxToolbar fileName={fileName} isDirty={isDirty} mode={mode} onModeChange={setMode} />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {(mode === 'source' || mode === 'split') && (
          <div
            className={cn(
              'min-h-0 overflow-hidden flex',
              mode === 'split' ? 'flex-1 border-r border-border/30' : 'flex-1',
            )}
          >
            <SourcePane value={source} onChange={handleSourceChange} />
          </div>
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div className="flex-1 min-h-0 overflow-hidden bg-bg-base">
            <PreviewPane source={source} />
          </div>
        )}
      </div>
    </div>
  );
};

export default MdxViewer;
