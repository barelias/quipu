import { describe, it, expect } from 'vitest';
import { buildTree, getRootItems, countItemsRecursive } from '../lib/buildTree';

interface Item {
  id: string;
  name: string;
  folder?: string;
}

const item = (id: string, name: string, folder?: string): Item => ({ id, name, folder });

describe('buildTree', () => {
  it('returns an empty tree for 0 items, 0 declared folders', () => {
    const tree = buildTree<Item>([], []);
    expect(tree).toEqual([]);
  });

  it('returns an empty tree when only root items are present', () => {
    // Root items are NOT folders. They surface via getRootItems.
    const items = [item('a', 'Alpha'), item('b', 'Beta')];
    const tree = buildTree<Item>(items, []);
    expect(tree).toEqual([]);
  });

  it('places one item under a single-level folder', () => {
    const items = [item('foo', 'Foo', 'research')];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('research');
    expect(tree[0].name).toBe('research');
    expect(tree[0].children).toEqual([]);
    expect(tree[0].items).toHaveLength(1);
    expect(tree[0].items[0].id).toBe('foo');
  });

  it('builds a 2-deep nested tree from `research/web-scraping/foo`', () => {
    const items = [item('foo', 'Foo', 'research/web-scraping')];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('research');
    expect(tree[0].items).toEqual([]);
    expect(tree[0].children).toHaveLength(1);
    const sub = tree[0].children[0];
    expect(sub.path).toBe('research/web-scraping');
    expect(sub.name).toBe('web-scraping');
    expect(sub.items).toHaveLength(1);
    expect(sub.items[0].id).toBe('foo');
  });

  it('builds a 3-deep nested tree from `a/b/c/foo`', () => {
    const items = [item('foo', 'Foo', 'a/b/c')];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    const a = tree[0];
    expect(a.path).toBe('a');
    expect(a.children).toHaveLength(1);
    const ab = a.children[0];
    expect(ab.path).toBe('a/b');
    expect(ab.children).toHaveLength(1);
    const abc = ab.children[0];
    expect(abc.path).toBe('a/b/c');
    expect(abc.name).toBe('c');
    expect(abc.items).toHaveLength(1);
    expect(abc.items[0].id).toBe('foo');
  });

  it('declares an empty folder via `declaredFolders` even when no items reference it', () => {
    const tree = buildTree<Item>([], ['research/empty']);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('research');
    expect(tree[0].items).toEqual([]);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].path).toBe('research/empty');
    expect(tree[0].children[0].items).toEqual([]);
  });

  it('groups items in the same folder together', () => {
    const items = [
      item('a', 'Alpha', 'work'),
      item('b', 'Beta', 'work'),
      item('c', 'Charlie', 'work'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('work');
    expect(tree[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts items alphabetically by name within a folder', () => {
    const items = [
      item('b', 'Beta', 'work'),
      item('a', 'Alpha', 'work'),
      item('c', 'Charlie', 'work'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree[0].items.map((i) => i.name)).toEqual(['Alpha', 'Beta', 'Charlie']);
  });

  it('sorts subfolders alphabetically by name segment', () => {
    const items = [
      item('a', 'A', 'parent/zeta'),
      item('b', 'B', 'parent/alpha'),
      item('c', 'C', 'parent/middle'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree[0].children.map((c) => c.name)).toEqual(['alpha', 'middle', 'zeta']);
  });

  it('sorts top-level folders alphabetically', () => {
    const items = [
      item('a', 'A', 'zeta'),
      item('b', 'B', 'alpha'),
      item('c', 'C', 'middle'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree.map((n) => n.name)).toEqual(['alpha', 'middle', 'zeta']);
  });

  it('does not include root items in the tree', () => {
    const items = [
      item('root1', 'Root 1'),
      item('foo', 'Foo', 'work'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('work');
    expect(tree[0].items.map((i) => i.id)).toEqual(['foo']);
  });

  it('merges declared folders with item-implied folders', () => {
    const items = [item('foo', 'Foo', 'research/sub')];
    const tree = buildTree<Item>(items, ['research/sub', 'research/other']);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('research');
    expect(tree[0].children.map((c) => c.path).sort()).toEqual([
      'research/other',
      'research/sub',
    ]);
    const sub = tree[0].children.find((c) => c.path === 'research/sub')!;
    expect(sub.items).toHaveLength(1);
    const other = tree[0].children.find((c) => c.path === 'research/other')!;
    expect(other.items).toEqual([]);
  });

  it('uses displayNames when provided, falling back to last path segment', () => {
    const items = [item('foo', 'Foo', 'research/web-scraping')];
    const tree = buildTree<Item>(items, [], {
      displayNames: { 'research/web-scraping': 'Web Scraping' },
    });
    expect(tree[0].displayName).toBeUndefined();
    expect(tree[0].name).toBe('research');
    expect(tree[0].children[0].name).toBe('web-scraping');
    expect(tree[0].children[0].displayName).toBe('Web Scraping');
  });

  it('ignores empty-string declared folders', () => {
    const tree = buildTree<Item>([], ['', 'real']);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('real');
  });

  it('handles items with mixed depths under the same root', () => {
    const items = [
      item('a', 'A', 'work'),
      item('b', 'B', 'work/deep'),
      item('c', 'C', 'work/deep/deeper'),
    ];
    const tree = buildTree<Item>(items, []);
    expect(tree).toHaveLength(1);
    const work = tree[0];
    expect(work.items.map((i) => i.id)).toEqual(['a']);
    expect(work.children).toHaveLength(1);
    const deep = work.children[0];
    expect(deep.path).toBe('work/deep');
    expect(deep.items.map((i) => i.id)).toEqual(['b']);
    expect(deep.children).toHaveLength(1);
    expect(deep.children[0].path).toBe('work/deep/deeper');
    expect(deep.children[0].items.map((i) => i.id)).toEqual(['c']);
  });
});

describe('getRootItems', () => {
  it('returns items with no folder, sorted by name', () => {
    const items = [
      item('a', 'Beta'),
      item('b', 'Alpha'),
      item('c', 'Charlie', 'work'),
    ];
    const roots = getRootItems(items);
    expect(roots.map((i) => i.name)).toEqual(['Alpha', 'Beta']);
  });

  it('treats empty-string folder as root', () => {
    const items = [item('a', 'A', '')];
    const roots = getRootItems(items);
    expect(roots).toHaveLength(1);
  });

  it('returns an empty array when nothing is at root', () => {
    const items = [item('a', 'A', 'work')];
    expect(getRootItems(items)).toEqual([]);
  });
});

describe('countItemsRecursive', () => {
  it('returns counts including descendants', () => {
    const items = [
      item('a', 'A', 'work'),
      item('b', 'B', 'work/deep'),
      item('c', 'C', 'work/deep/deeper'),
    ];
    const tree = buildTree<Item>(items, []);
    const counts = countItemsRecursive(tree);
    expect(counts.get('work')).toBe(3);
    expect(counts.get('work/deep')).toBe(2);
    expect(counts.get('work/deep/deeper')).toBe(1);
  });

  it('returns 0 for declared empty folders', () => {
    const tree = buildTree<Item>([], ['empty/sub']);
    const counts = countItemsRecursive(tree);
    expect(counts.get('empty')).toBe(0);
    expect(counts.get('empty/sub')).toBe(0);
  });
});
