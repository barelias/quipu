import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const blockDragHandleKey = new PluginKey('blockDragHandle');

interface BlockRange {
  from: number;
  to: number;
  startIndex: number;
  endIndex: number;
}

interface DropPosition {
  pos: number;
  index: number;
}

interface DragState {
  sourceRange: { from: number; to: number };
  sourceStartIndex: number;
  sourceEndIndex: number;
}

interface BlockDragPluginState {
  isDragging: boolean;
  dropTarget: DropPosition | null;
}

function getSectionRange(doc: ProseMirrorNode, nodeIndex: number): BlockRange {
  let endIndex = nodeIndex + 1;
  for (let i = nodeIndex + 1; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === 'heading' && node.attrs.level === 1) break;
    endIndex = i + 1;
  }
  let from = 0;
  for (let i = 0; i < nodeIndex; i++) from += doc.child(i).nodeSize;
  let to = from;
  for (let i = nodeIndex; i < endIndex; i++) to += doc.child(i).nodeSize;
  return { from, to, startIndex: nodeIndex, endIndex };
}

function getNodeRange(doc: ProseMirrorNode, nodeIndex: number): BlockRange {
  let from = 0;
  for (let i = 0; i < nodeIndex; i++) from += doc.child(i).nodeSize;
  const to = from + doc.child(nodeIndex).nodeSize;
  return { from, to, startIndex: nodeIndex, endIndex: nodeIndex + 1 };
}

function getDragRange(doc: ProseMirrorNode, nodeIndex: number): BlockRange {
  const node = doc.child(nodeIndex);
  if (node.type.name === 'heading' && node.attrs.level === 1) {
    return getSectionRange(doc, nodeIndex);
  }
  return getNodeRange(doc, nodeIndex);
}

function getDropPositions(doc: ProseMirrorNode): DropPosition[] {
  const positions: DropPosition[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    positions.push({ pos, index: i });
    pos += doc.child(i).nodeSize;
  }
  positions.push({ pos, index: doc.childCount });
  return positions;
}

function findClosestDropTarget(
  doc: ProseMirrorNode,
  targetPos: number,
  sourceStartIndex: number,
  sourceEndIndex: number
): DropPosition | null {
  const positions = getDropPositions(doc);
  let closest: DropPosition | null = null;
  let closestDist = Infinity;
  for (const p of positions) {
    if (p.index > sourceStartIndex && p.index < sourceEndIndex) continue;
    if (p.index === sourceStartIndex || p.index === sourceEndIndex) continue;
    const dist = Math.abs(p.pos - targetPos);
    if (dist < closestDist) { closestDist = dist; closest = p; }
  }
  return closest;
}

function moveBlock(tr: Transaction, from: number, to: number, targetPos: number): Transaction {
  const slice = tr.doc.slice(from, to);
  if (from < targetPos) {
    tr.delete(from, to);
    tr.insert(targetPos - (to - from), slice.content);
  } else {
    tr.delete(from, to);
    tr.insert(targetPos, slice.content);
  }
  return tr;
}

function shouldShowHandle(node: ProseMirrorNode): boolean {
  return !(node.type.name === 'paragraph' && node.content.size === 0);
}

// X offset: handle right edge sits flush with the editor left edge
const HANDLE_WIDTH = 20;
const HANDLE_OFFSET = HANDLE_WIDTH + 4; // pixels left of editorRect.left

export const BlockDragHandle = Extension.create({
  name: 'blockDragHandle',

  addProseMirrorPlugins() {
    let currentView: EditorView | null = null;
    let dragState: DragState | null = null;
    let isDragging = false;
    let dropTarget: DropPosition | null = null;
    let hoveredNodeIndex: number | null = null;

    // Persistent floating handle — position: fixed, snaps to block Y
    const handleEl = document.createElement('div');
    handleEl.className = 'block-drag-handle';
    handleEl.setAttribute('draggable', 'true');
    handleEl.textContent = '\u2807';
    handleEl.contentEditable = 'false';
    handleEl.style.cssText = [
      'position:fixed',
      'display:none',
      'width:20px',
      'height:20px',
      'align-items:center',
      'justify-content:center',
      'font-size:16px',
      'line-height:1',
      'cursor:grab',
      'border-radius:3px',
      'z-index:1000',
      'user-select:none',
      'opacity:0.5',
      'transition:opacity 120ms',
    ].join(';');
    document.body.appendChild(handleEl);

    handleEl.addEventListener('mouseenter', () => {
      handleEl.style.opacity = '0.85';
      handleEl.style.background = 'var(--color-bg-elevated, #eee)';
    });
    handleEl.addEventListener('mouseleave', (e: MouseEvent) => {
      handleEl.style.opacity = '0.5';
      handleEl.style.background = '';
      // Hide only if not returning to the editor
      if (!isDragging && currentView && !currentView.dom.contains(e.relatedTarget as Node)) {
        handleEl.style.display = 'none';
        hoveredNodeIndex = null;
      }
    });
    handleEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    handleEl.addEventListener('dragstart', (e) => {
      const view = currentView;
      if (!view) return;
      const nodeIndex = parseInt(handleEl.getAttribute('data-node-index') ?? '', 10);
      if (isNaN(nodeIndex)) return;

      const { doc } = view.state;
      const range = getDragRange(doc, nodeIndex);
      dragState = {
        sourceRange: { from: range.from, to: range.to },
        sourceStartIndex: range.startIndex,
        sourceEndIndex: range.endIndex,
      };
      isDragging = true;
      dropTarget = null;

      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'block-drag');
      }

      const tempDiv = document.createElement('div');
      tempDiv.style.cssText = 'position:absolute;top:-9999px;opacity:0.5;max-width:600px;pointer-events:none';
      document.body.appendChild(tempDiv);
      const serializer = (view as unknown as Record<string, unknown>).domSerializer as { serializeFragment: (f: unknown) => DocumentFragment } | undefined;
      if (serializer) {
        try { tempDiv.appendChild(serializer.serializeFragment(doc.slice(range.from, range.to).content)); }
        catch { /* ignore */ }
      }
      e.dataTransfer?.setDragImage(tempDiv, 0, 0);
      requestAnimationFrame(() => { tempDiv.parentNode?.removeChild(tempDiv); });

      view.dispatch(view.state.tr.setMeta(blockDragHandleKey, { isDragging: true, dropTarget: null }));
    });

    handleEl.addEventListener('dragend', () => {
      isDragging = false;
      dragState = null;
      dropTarget = null;
      handleEl.style.display = 'none';
      currentView?.dispatch(currentView.state.tr.setMeta(blockDragHandleKey, {
        isDragging: false, dropTarget: null,
      }));
    });

    const plugin = new Plugin({
      key: blockDragHandleKey,

      view(editorView) {
        currentView = editorView;

        // Global mousemove hides the handle when the cursor leaves both the editor
        // and the handle zone — avoids the gap problem with mouseleave on view.dom.
        const onGlobalMouseMove = (e: MouseEvent) => {
          if (isDragging || !currentView || handleEl.style.display === 'none') return;
          const editorRect = currentView.dom.getBoundingClientRect();
          const handleLeft = editorRect.left - HANDLE_OFFSET;
          if (
            e.clientX < handleLeft ||
            e.clientX > editorRect.right ||
            e.clientY < editorRect.top - 10 ||
            e.clientY > editorRect.bottom + 10
          ) {
            handleEl.style.display = 'none';
            hoveredNodeIndex = null;
          }
        };
        document.addEventListener('mousemove', onGlobalMouseMove, { passive: true });

        return {
          destroy() {
            currentView = null;
            document.removeEventListener('mousemove', onGlobalMouseMove);
            handleEl.parentNode?.removeChild(handleEl);
          },
        };
      },

      state: {
        init(): BlockDragPluginState {
          return { isDragging: false, dropTarget: null };
        },
        apply(tr, prev: BlockDragPluginState): BlockDragPluginState {
          const meta = tr.getMeta(blockDragHandleKey) as Partial<BlockDragPluginState> | undefined;
          if (meta) return { ...prev, ...meta };
          return prev;
        },
      },

      props: {
        decorations(state) {
          const pluginState = blockDragHandleKey.getState(state) as BlockDragPluginState | undefined;
          const decorations: Decoration[] = [];
          const { doc } = state;

          // Drop indicator line
          if (pluginState?.isDragging && pluginState.dropTarget != null) {
            const clampedPos = Math.min(pluginState.dropTarget.pos, doc.content.size);
            decorations.push(Decoration.widget(clampedPos, () => {
              const line = document.createElement('div');
              line.className = 'block-drop-indicator';
              line.contentEditable = 'false';
              return line;
            }, { side: -1, key: 'drop-indicator' }));
          }

          // Dim source blocks while dragging
          if (pluginState?.isDragging && dragState) {
            let pos = 0;
            for (let i = 0; i < doc.childCount; i++) {
              const nodeSize = doc.child(i).nodeSize;
              if (i >= dragState.sourceStartIndex && i < dragState.sourceEndIndex) {
                decorations.push(Decoration.node(pos, pos + nodeSize, { class: 'block-drag-source' }));
              }
              pos += nodeSize;
            }
          }

          return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
        },

        handleDOMEvents: {
          mousemove(view: EditorView, event: MouseEvent) {
            if (isDragging) return false;

            const editorRect = view.dom.getBoundingClientRect();

            // Only act on mousemove within the editor bounds (global handler covers the rest)
            if (event.clientX < editorRect.left - 60 || event.clientX > editorRect.right) {
              return false;
            }

            // Find block at this Y by probing the left edge of the editor
            const pos = view.posAtCoords({ left: editorRect.left + 10, top: event.clientY });
            if (!pos) {
              handleEl.style.display = 'none';
              return false;
            }

            const resolved = view.state.doc.resolve(pos.pos);
            const topLevelIndex = resolved.index(0);

            if (topLevelIndex >= view.state.doc.childCount) {
              handleEl.style.display = 'none';
              return false;
            }

            const node = view.state.doc.child(topLevelIndex);
            if (!shouldShowHandle(node)) {
              handleEl.style.display = 'none';
              return false;
            }

            // Snap Y to the block's actual DOM position (not the raw mouse Y)
            const blockEl = view.dom.children[topLevelIndex] as HTMLElement | undefined;
            const blockTop = blockEl ? blockEl.getBoundingClientRect().top : event.clientY - 10;

            handleEl.style.display = 'flex';
            handleEl.style.left = `${editorRect.left - HANDLE_OFFSET}px`;
            handleEl.style.top = `${blockTop + 4}px`;
            handleEl.setAttribute('data-node-index', String(topLevelIndex));
            hoveredNodeIndex = topLevelIndex;

            return false;
          },

          dragover(view: EditorView, event: DragEvent) {
            if (!isDragging || !dragState) return false;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!pos) return false;

            const target = findClosestDropTarget(
              view.state.doc, pos.pos,
              dragState.sourceStartIndex, dragState.sourceEndIndex
            );

            if (target && (!dropTarget || target.pos !== dropTarget.pos)) {
              dropTarget = target;
              view.dispatch(view.state.tr.setMeta(blockDragHandleKey, { isDragging: true, dropTarget: target }));
            }
            return true;
          },

          dragend(view: EditorView) {
            isDragging = false;
            dragState = null;
            dropTarget = null;
            handleEl.style.display = 'none';
            view.dispatch(view.state.tr.setMeta(blockDragHandleKey, { isDragging: false, dropTarget: null }));
            return false;
          },

          drop(view: EditorView, event: DragEvent) {
            if (!isDragging || !dragState || !dropTarget) return false;
            event.preventDefault();

            const { from, to } = dragState.sourceRange;
            const { tr } = view.state;
            moveBlock(tr, from, to, dropTarget.pos);
            view.dispatch(tr);

            isDragging = false;
            dragState = null;
            dropTarget = null;
            hoveredNodeIndex = null;
            handleEl.style.display = 'none';

            view.dispatch(view.state.tr.setMeta(blockDragHandleKey, { isDragging: false, dropTarget: null }));
            return true;
          },
        },
      },
    });

    return [plugin];
  },
});
