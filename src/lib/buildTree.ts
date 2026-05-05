/**
 * Build a tree of folders + items from a flat list of items (each with an
 * optional `folder` path) plus an optional list of explicitly-declared
 * folder paths. Multi-level folder paths are supported — `'research/web-scraping'`
 * implies `'research'` as a parent even if `'research'` itself has no items
 * and no explicit declaration.
 *
 * Why a tree, not a flat group-by-folder map? The Agents/Repos panels need
 * to render arbitrarily-deep nesting with depth-aware indentation and
 * per-folder drop targets. A tree keeps the recursive render trivial: each
 * folder node renders its children (subfolders + items) and stops.
 *
 * Design notes:
 * - Every prefix of a path is treated as a folder. `'a/b/c'` -> nodes
 *   for `'a'`, `'a/b'`, `'a/b/c'`. The intermediate nodes have no items
 *   of their own (unless an item explicitly lives there or another
 *   declared folder names them).
 * - Children (both folders and items) are sorted alphabetically. Items
 *   sort by their `name` field, folders by their `name` segment. Items
 *   come AFTER subfolders in each node's render order — the panels treat
 *   folders as labels and items as leaves below them.
 * - `displayNames` is an optional map from a full folder path to the
 *   human-readable label (from a `.folder.json` marker). When absent, the
 *   last path segment is used as the display label. The map is keyed by
 *   the full path because two folders can share a leaf segment (e.g.
 *   `research/web-scraping` and `tutorials/web-scraping`) — we need to
 *   disambiguate.
 */

export interface TreeNode<T> {
  /** Forward-slash separated full path from the root, e.g. `'research/web-scraping'`. */
  path: string;
  /** Last segment of `path`. Empty string when this is the root pseudo-node (not returned to consumers). */
  name: string;
  /** Optional display name override (e.g. from `.folder.json`'s `displayName`). */
  displayName?: string;
  /** Subfolders nested under this folder. Sorted alphabetically by `name`. */
  children: TreeNode<T>[];
  /** Items whose `folder` field equals this node's `path` exactly. Sorted alphabetically by `name`. */
  items: T[];
}

interface BuildTreeOptions {
  /**
   * Optional map from full folder path to display name. Folders without
   * an entry fall back to the last segment of their path.
   */
  displayNames?: Record<string, string>;
  /**
   * Optional comparator for items. Defaults to `name`-based localeCompare,
   * which works for the Agent / Repo shape we care about today.
   */
  sortItems?: <U extends { name?: string }>(a: U, b: U) => number;
}

const defaultSortItems = <U extends { name?: string }>(a: U, b: U): number => {
  return (a.name ?? '').localeCompare(b.name ?? '');
};

/**
 * Build a forest of TreeNodes from `items` (whose `folder` field places
 * them in the tree) and `declaredFolders` (paths that should appear as
 * folder nodes even without items).
 *
 * Returns the top-level folders in alphabetical order. Root-level items
 * (those with empty `folder`) are NOT included — callers handle them
 * separately because they render at a different visual level (no folder
 * header).
 *
 * Use `getRootItems()` for the items that belong at the root.
 */
export function buildTree<T extends { folder?: string; name?: string }>(
  items: T[],
  declaredFolders: string[] = [],
  options: BuildTreeOptions = {},
): TreeNode<T>[] {
  const sortItems = options.sortItems ?? defaultSortItems;
  const displayNames = options.displayNames ?? {};

  // Use a map keyed by full path so identical paths from different
  // sources (declared list AND item folder) collapse into one node.
  const nodes = new Map<string, TreeNode<T>>();

  /** Ensure a node exists for `path` and every prefix above it. */
  const ensurePath = (path: string): TreeNode<T> | null => {
    if (path === '') return null;
    let existing = nodes.get(path);
    if (existing) return existing;
    const slashIdx = path.lastIndexOf('/');
    const name = slashIdx === -1 ? path : path.slice(slashIdx + 1);
    const displayName = displayNames[path];
    existing = { path, name, displayName, children: [], items: [] };
    nodes.set(path, existing);
    // Recurse to ensure all ancestors exist too. The link to children
    // is wired in the second pass after every node is created — easier
    // than doing it inline because alphabetical ordering needs all
    // siblings present before sorting.
    if (slashIdx !== -1) {
      ensurePath(path.slice(0, slashIdx));
    }
    return existing;
  };

  // 1. Materialize every declared folder + every item-implied folder.
  for (const declared of declaredFolders) {
    if (declared === '') continue;
    ensurePath(declared);
  }
  for (const item of items) {
    const folder = item.folder ?? '';
    if (folder === '') continue;
    ensurePath(folder);
  }

  // 2. Place items into their folder.
  for (const item of items) {
    const folder = item.folder ?? '';
    if (folder === '') continue;
    const node = nodes.get(folder);
    if (node) node.items.push(item);
  }

  // 3. Wire children. A node is a child of `parent(path)` for every
  //    non-root path — `parent('a/b/c') === 'a/b'`.
  const roots: TreeNode<T>[] = [];
  for (const [path, node] of nodes) {
    const slashIdx = path.lastIndexOf('/');
    if (slashIdx === -1) {
      roots.push(node);
    } else {
      const parentPath = path.slice(0, slashIdx);
      const parent = nodes.get(parentPath);
      if (parent) parent.children.push(node);
      else roots.push(node); // Should never happen since we ensurePath'd ancestors.
    }
  }

  // 4. Sort items and children deterministically. Children by `name`,
  //    items by the supplied (or default name-based) comparator.
  const sortNode = (node: TreeNode<T>): void => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.items.sort(sortItems);
    for (const child of node.children) sortNode(child);
  };
  for (const r of roots) sortNode(r);
  roots.sort((a, b) => a.name.localeCompare(b.name));

  return roots;
}

/**
 * Return the items that belong at the root (folder is empty/undefined).
 * Sorted alphabetically by name.
 */
export function getRootItems<T extends { folder?: string; name?: string }>(
  items: T[],
  options: { sortItems?: <U extends { name?: string }>(a: U, b: U) => number } = {},
): T[] {
  const sortItems = options.sortItems ?? defaultSortItems;
  return items.filter((i) => !i.folder).slice().sort(sortItems);
}

/**
 * Walk `tree` and return the total number of items at or below each
 * node. Useful for showing aggregate counts in folder headers.
 *
 * Returned map is keyed by full folder path.
 */
export function countItemsRecursive<T>(
  tree: TreeNode<T>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: TreeNode<T>): number => {
    let total = node.items.length;
    for (const child of node.children) total += visit(child);
    counts.set(node.path, total);
    return total;
  };
  for (const r of tree) visit(r);
  return counts;
}
