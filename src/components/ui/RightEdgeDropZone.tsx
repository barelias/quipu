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

  // Always mounted but pointer-events-none + invisible when no drag is in
  // progress, so the zone doesn't block clicks on the editor.
  return (
    <div
      ref={setNodeRef}
      aria-hidden={!isDragActive}
      className={cn(
        'absolute top-0 right-0 bottom-0 w-16 z-20',
        'flex items-center justify-center',
        'transition-opacity duration-100',
        isDragActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      <div
        className={cn(
          'h-[80%] w-full rounded-l-md border-2 border-dashed flex items-center justify-center',
          'transition-colors',
          isOver
            ? 'border-accent bg-accent-muted/60 text-accent'
            : 'border-border bg-bg-overlay/40 text-text-tertiary',
        )}
      >
        <ArrowSquareOutIcon size={20} weight="regular" />
      </div>
    </div>
  );
}
