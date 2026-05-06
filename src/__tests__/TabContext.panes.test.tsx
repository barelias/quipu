/**
 * Pane lifecycle tests — splitToRight, moveTabToPane, closeTab pane behavior,
 * cross-pane reorder rejection, and the auto-collapse / promote-secondary-to-primary
 * rules from B1 of the split-panes plan.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  storage: {
    get: vi.fn(),
    set: vi.fn(async () => {}),
    remove: vi.fn(),
  },
  fileSystem: {
    readFile: vi.fn(async () => 'file body'),
    writeFile: vi.fn(async () => ({ success: true })),
    watchDirectory: vi.fn(),
  },
  fileWatcher: {
    watch: vi.fn(async () => ({ success: true })),
    onChanged: vi.fn(() => () => {}),
    unwatch: vi.fn(async () => ({ success: true })),
  },
  frameService: {
    readFrame: vi.fn(async () => null),
    resolveAnnotations: vi.fn(async () => []),
    watchFrames: vi.fn(() => Object.assign(() => {}, { registerPath: vi.fn() })),
    getFramePath: vi.fn(() => '/frame/path'),
  },
}));

vi.mock('../services/storageService', () => ({ default: hoisted.storage }));
vi.mock('../services/fileSystem', () => ({ default: hoisted.fileSystem }));
vi.mock('../services/fileWatcher', () => ({ default: hoisted.fileWatcher }));
vi.mock('../services/frameService', () => ({ default: hoisted.frameService }));
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../extensions/registry', () => ({
  getExtensionForTab: () => null,
}));
vi.mock('../context/FileSystemContext', () => ({
  useFileSystem: () => ({
    workspacePath: '/workspace',
    expandedFolders: new Set<string>(),
    restoreExpandedFolders: vi.fn(),
  }),
}));

import { TabProvider, useTab } from '../context/TabContext';

function Probe({ onApi }: { onApi: (api: ReturnType<typeof useTab>) => void }) {
  const api = useTab();
  React.useEffect(() => { onApi(api); }, [api, onApi]);
  return null;
}

async function withProvider(initialFiles: string[]) {
  hoisted.storage.get.mockImplementation(async (key: string) => {
    if (key === 'session:/workspace') {
      return {
        openFilePaths: initialFiles.map(p => ({ path: p, scrollPosition: 0 })),
        activeFilePath: initialFiles[0] ?? null,
        expandedFolders: [],
      };
    }
    return null;
  });

  let api: ReturnType<typeof useTab> | null = null;
  render(
    <TabProvider>
      <Probe onApi={(a) => { api = a; }} />
    </TabProvider>,
  );

  await waitFor(() => {
    expect(api?.openTabs.length).toBe(initialFiles.length);
  });
  return () => api!;
}

describe('TabContext — pane lifecycle (B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with a single primary pane and no secondary', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    const api = get();
    expect(api.primary.id).toBe('pane-1');
    expect(api.primary.tabIds).toHaveLength(2);
    expect(api.secondary).toBeNull();
    expect(api.activePaneId).toBe('pane-1');
    expect(api.activeTabId).toBe(api.primary.activeTabId);
  });

  it('splitToRight creates a secondary pane and moves the tab into it', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    const api = get();
    const tabA = api.openTabs[0].id;

    act(() => { get().splitToRight(tabA); });

    await waitFor(() => {
      expect(get().secondary).not.toBeNull();
    });

    const after = get();
    expect(after.secondary?.id).toBe('pane-2');
    expect(after.secondary?.tabIds).toEqual([tabA]);
    expect(after.secondary?.activeTabId).toBe(tabA);
    expect(after.primary.tabIds).not.toContain(tabA);
    expect(after.activePaneId).toBe('pane-2');
  });

  it('splitToRight is a no-op when only one tab is open (would empty primary)', async () => {
    const get = await withProvider(['/workspace/only.md']);
    const api = get();
    const tabId = api.openTabs[0].id;

    act(() => { get().splitToRight(tabId); });

    expect(get().secondary).toBeNull();
    expect(get().primary.tabIds).toEqual([tabId]);
  });

  it('splitToRight is a no-op when secondary already exists', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md', '/workspace/c.md']);
    const tabA = get().openTabs[0].id;
    const tabB = get().openTabs[1].id;

    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    act(() => { get().splitToRight(tabB); });

    expect(get().secondary?.tabIds).toEqual([tabA]); // unchanged
    expect(get().primary.tabIds).toContain(tabB); // B did not move
  });

  it('moveTabToPane moves a tab between panes atomically', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md', '/workspace/c.md']);
    const tabA = get().openTabs[0].id;
    const tabC = get().openTabs[2].id;

    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    act(() => { get().moveTabToPane(tabC, 'pane-2'); });

    const after = get();
    expect(after.primary.tabIds).not.toContain(tabC);
    expect(after.secondary?.tabIds).toContain(tabC);
  });

  it('closeTab on the only tab in secondary collapses secondary back to single-pane', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    const tabA = get().openTabs[0].id;

    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    act(() => { get().closeTab(tabA); });

    await waitFor(() => { expect(get().secondary).toBeNull(); });
    expect(get().activePaneId).toBe('pane-1');
    expect(get().openTabs.find(t => t.id === tabA)).toBeUndefined();
  });

  it('closeTab on the only tab in primary while secondary exists promotes secondary to primary', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    const tabA = get().openTabs[0].id;
    const tabB = get().openTabs[1].id;

    // Split: secondary holds A, primary keeps B
    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    // Close primary's only tab (B). Secondary (with A) should promote to primary.
    act(() => { get().closeTab(tabB); });

    await waitFor(() => {
      expect(get().secondary).toBeNull();
    });
    const after = get();
    expect(after.primary.id).toBe('pane-1');
    expect(after.primary.tabIds).toEqual([tabA]);
    expect(after.activePaneId).toBe('pane-1');
  });

  it('reorderTabs is a no-op when ids are in different panes', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md', '/workspace/c.md']);
    const tabA = get().openTabs[0].id;
    const tabB = get().openTabs[1].id;

    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    const beforePrimary = [...get().primary.tabIds];
    const beforeSecondary = [...(get().secondary?.tabIds ?? [])];

    act(() => { get().reorderTabs(tabB, tabA); }); // B in primary, A in secondary

    expect(get().primary.tabIds).toEqual(beforePrimary);
    expect(get().secondary?.tabIds).toEqual(beforeSecondary);
  });

  it('switchTab focuses the pane that owns the target tab', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    const tabA = get().openTabs[0].id;
    const tabB = get().openTabs[1].id;

    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });
    expect(get().activePaneId).toBe('pane-2');

    act(() => { get().switchTab(tabB); });

    await waitFor(() => { expect(get().activePaneId).toBe('pane-1'); });
    expect(get().primary.activeTabId).toBe(tabB);
  });

  it('closeOtherTabs falls back to first surviving tab when previous active was closed (cross-pane)', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md', '/workspace/c.md', '/workspace/d.md']);
    const tabA = get().openTabs[0].id;
    const tabB = get().openTabs[1].id;
    const tabC = get().openTabs[2].id;
    const tabD = get().openTabs[3].id;

    // Set up:
    //   primary   = [B, C]  active = C
    //   secondary = [A, D]  active = A;  D is dirty (so it survives closeOtherTabs)
    act(() => { get().splitToRight(tabA); });           // moves A to new secondary
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });
    act(() => { get().moveTabToPane(tabD, 'pane-2'); }); // moves D to secondary (after A)
    await waitFor(() => { expect(get().secondary?.tabIds).toContain(tabD); });
    act(() => { get().setTabDirty(tabD, true); });
    act(() => { get().switchTab(tabC); });
    await waitFor(() => { expect(get().primary.activeTabId).toBe(tabC); });
    act(() => { get().switchTab(tabA); });
    await waitFor(() => { expect(get().secondary?.activeTabId).toBe(tabA); });

    // Right-click B in primary → "Close Other Tabs". Survivors:
    //   - tabB (target)
    //   - tabD (dirty in secondary)
    // primary = [B], secondary = [D].
    // Bug being guarded: secondary's previous activeTabId was tabA, which is
    // now closed; before the fix, secondary.activeTabId would have fallen
    // through to null, leaving the secondary pane's editor pointing at
    // nothing even though tabD is right there. After the fix, it falls back
    // to the first surviving tab in the pane.
    act(() => { get().closeOtherTabs(tabB); });

    await waitFor(() => {
      expect(get().primary.tabIds).toEqual([tabB]);
    });
    expect(get().primary.activeTabId).toBe(tabB);
    expect(get().secondary?.tabIds).toEqual([tabD]);
    expect(get().secondary?.activeTabId).toBe(tabD);
  });

  it('panesAsArray returns one pane when single-pane and two when split', async () => {
    const get = await withProvider(['/workspace/a.md', '/workspace/b.md']);
    expect(get().panesAsArray()).toHaveLength(1);

    const tabA = get().openTabs[0].id;
    act(() => { get().splitToRight(tabA); });
    await waitFor(() => { expect(get().secondary).not.toBeNull(); });

    expect(get().panesAsArray()).toHaveLength(2);
    expect(get().panesAsArray().map(p => p.id)).toEqual(['pane-1', 'pane-2']);
  });
});
