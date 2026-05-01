import {
  CaretRightIcon,
  CaretDownIcon,
  FolderIcon,
} from '@phosphor-icons/react';
import type { TreeNode } from '../../lib/buildTree';

/**
 * Recursive folder renderer shared by the Agents and Repos panels.
 *
 * Why generic? Both panels render the same folder shell (chevron, icon,
 * label, badge, drop target, context menu) but very different rows
 * underneath. The item-rendering function is injected so each panel keeps
 * full control over its row look-and-feel without leaking that into a
 * shared abstraction.
 *
 * Indent depth is computed from the folder's path: each `/` adds one
 * level. The pixel offset is `depth * INDENT_PX` and is passed both to
 * the folder header and to the item renderer (so items align to their
 * folder's depth + 1).
 */

const INDENT_PX = 12;

/** Depth of a folder path. `'a'` -> 1, `'a/b'` -> 2, etc. */
function depthOfPath(path: string): number {
  if (path === '') return 0;
  return path.split('/').length;
}

export interface TreeFolderProps<T> {
  node: TreeNode<T>;
  /** Map of folder path -> items collapsed (true = collapsed, false/undefined = expanded). */
  collapsed: Record<string, boolean>;
  /** Toggle the collapsed state of a folder. */
  onToggle: (path: string) => void;
  /** Path of the currently drag-hovered folder (or the root sentinel). */
  dragOver: string | null;
  /** Aggregate count for the folder badge — items at and below this folder. */
  totalCount: number;
  /** Render one item row. `indentPx` is the leading padding the row should apply. */
  renderItem: (item: T, indentPx: number) => React.ReactNode;
  /** Open the folder's context menu (right-click). */
  onFolderContextMenu: (e: React.MouseEvent, path: string, directItemCount: number) => void;
  /** Called on dragOver of this folder header — caller decides whether to highlight. */
  onDragOver: (e: React.DragEvent, path: string) => void;
  /** Called on drop on this folder header. */
  onDrop: (e: React.DragEvent, path: string) => void;
  /** Optional fallback hint text shown when the folder is expanded but empty. */
  emptyHint?: string;
}

/**
 * Render a single folder node and (recursively) its descendants.
 *
 * Children render order: subfolders first, then items. This matches
 * common tree-view conventions and means a row rarely "disappears" into
 * a deep nested tree below subfolders.
 */
export function TreeFolder<T extends { id: string }>(
  props: TreeFolderProps<T>,
): React.ReactElement {
  const {
    node, collapsed, onToggle, dragOver, totalCount,
    renderItem, onFolderContextMenu, onDragOver, onDrop, emptyHint,
  } = props;

  const depth = depthOfPath(node.path);
  const headerIndent = depth * INDENT_PX + 8; // 8px gutter so root folders don't hug the edge
  const itemIndent = (depth + 1) * INDENT_PX + 12; // items live one indent deeper

  const isOpen = !collapsed[node.path];
  const isDragHover = dragOver === node.path;
  const directItemCount = node.items.length;
  const label = node.displayName ?? node.name;

  return (
    <div>
      <div
        className={`group/folder flex items-center gap-1 h-7 pr-2 mx-1 rounded hover:bg-bg-elevated ${isDragHover ? 'bg-accent/10 ring-1 ring-accent/40' : ''}`}
        style={{ paddingLeft: `${headerIndent}px` }}
        onContextMenu={(e) => onFolderContextMenu(e, node.path, directItemCount)}
        onDragOver={(e) => onDragOver(e, node.path)}
        onDrop={(e) => onDrop(e, node.path)}
      >
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] text-text-tertiary"
          onClick={() => onToggle(node.path)}
        >
          {isOpen ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
          <FolderIcon size={12} weight="fill" className="text-text-tertiary" />
          <span className="truncate">{label}</span>
          <span className="ml-auto text-[10px] text-text-tertiary">{totalCount}</span>
        </button>
      </div>

      {isOpen && (
        <>
          {/* Subfolders first. */}
          {node.children.map((child) => (
            <TreeFolder<T>
              key={child.path}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              dragOver={dragOver}
              totalCount={countAtAndBelow(child)}
              renderItem={renderItem}
              onFolderContextMenu={onFolderContextMenu}
              onDragOver={onDragOver}
              onDrop={onDrop}
              emptyHint={emptyHint}
            />
          ))}

          {/* Then items in this folder. */}
          {node.items.map((it) => renderItem(it, itemIndent))}

          {/* Empty hint when neither subfolders nor items exist. */}
          {node.children.length === 0 && node.items.length === 0 && emptyHint && (
            <div
              className={`mx-1 my-1 px-3 py-2 rounded border border-dashed border-border text-[11px] text-text-tertiary text-center ${isDragHover ? 'bg-accent/10 border-accent' : ''}`}
              style={{ marginLeft: `${headerIndent}px` }}
            >
              {emptyHint}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Sum direct + nested item counts for a tree node. */
function countAtAndBelow<T>(node: TreeNode<T>): number {
  let total = node.items.length;
  for (const child of node.children) total += countAtAndBelow(child);
  return total;
}
