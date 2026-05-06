import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Sentinel id read by App.tsx's onDragEnd to detect a "drop on right edge"
 * intent. Stable string so handler logic can compare directly.
 */
export const RIGHT_EDGE_DROP_ZONE_ID = 'pane:right-edge';

interface RightEdgeDropZoneProps {
  /** True while a tab drag is in progress; the zone is invisible otherwise. */
  isDragActive: boolean;
}

/**
 * A vertical strip pinned to the right edge of the primary pane that
 * accepts a tab drop and triggers `splitToRight`. Only rendered when the
 * editor area shows a single pane (App.tsx gates on `secondary === null`),
 * and only visible while a drag is active.
 */
export default function RightEdgeDropZone({ isDragActive }: RightEdgeDropZoneProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: RIGHT_EDGE_DROP_ZONE_ID,
    data: { kind: 'split-right' },
  });

  // The zone covers the right ~25% of the pane during drag so it's easy to
  // hit. It sits below the tab bar (top-9 ≈ 36px) so it doesn't compete with
  // sortable-tab collision detection inside the bar. Always mounted (so dnd-kit
  // can measure it on drag start) and pointer-events-none + invisible when no
  // drag is active, so the zone doesn't block clicks on the editor.
  return (
    <div
      ref={setNodeRef}
      aria-hidden={!isDragActive}
      className={cn(
        'absolute top-9 right-0 bottom-0 w-1/3 max-w-72 z-20',
        'flex items-center justify-center p-3',
        'transition-opacity duration-150',
        isDragActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      <div
        className={cn(
          'h-full w-full rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-2',
          'transition-colors backdrop-blur-sm',
          isOver
            ? 'border-accent bg-accent-muted/70 text-accent'
            : 'border-border/70 bg-bg-overlay/40 text-text-tertiary',
        )}
      >
        <ArrowSquareOutIcon size={28} weight="regular" />
        <span className="text-[11px] font-medium uppercase tracking-wider">Split right</span>
      </div>
    </div>
  );
}
