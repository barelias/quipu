/**
 * Pane-layout session persistence tests (B5).
 *
 * Covers:
 *   - restoreSession with `panes` rebuilds primary + secondary correctly,
 *     mapping persisted file paths back to the freshly-generated tab ids.
 *   - Legacy sessions (no `panes` field) synthesize a single primary pane
 *     containing all restored tabs.
 *   - Persisted paths that no longer resolve to a restored tab are skipped
 *     from pane membership without orphaning the layout.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';

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

describe('TabContext — pane layout persistence (B5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores primary + secondary panes from a persisted snapshot', async () => {
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          openFilePaths: [
            { path: '/workspace/a.md', scrollPosition: 0 },
            { path: '/workspace/b.md', scrollPosition: 0 },
            { path: '/workspace/c.md', scrollPosition: 0 },
          ],
          activeFilePath: '/workspace/a.md',
          expandedFolders: [],
          panes: [
            { id: 'pane-1', paths: ['/workspace/a.md', '/workspace/b.md'], activePath: '/workspace/a.md' },
            { id: 'pane-2', paths: ['/workspace/c.md'], activePath: '/workspace/c.md' },
          ],
          activePaneId: 'pane-2',
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
      expect(api?.openTabs.length).toBe(3);
    });
    await waitFor(() => {
      expect(api?.secondary).not.toBeNull();
    });

    const tabA = api!.openTabs.find(t => t.path === '/workspace/a.md')!;
    const tabB = api!.openTabs.find(t => t.path === '/workspace/b.md')!;
    const tabC = api!.openTabs.find(t => t.path === '/workspace/c.md')!;

    expect(api!.primary.id).toBe('pane-1');
    expect(api!.primary.tabIds).toEqual([tabA.id, tabB.id]);
    expect(api!.primary.activeTabId).toBe(tabA.id);
    expect(api!.secondary?.id).toBe('pane-2');
    expect(api!.secondary?.tabIds).toEqual([tabC.id]);
    expect(api!.secondary?.activeTabId).toBe(tabC.id);
    expect(api!.activePaneId).toBe('pane-2');
  });

  it('legacy session without `panes` field synthesizes a single primary pane', async () => {
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          openFilePaths: [
            { path: '/workspace/x.md', scrollPosition: 0 },
            { path: '/workspace/y.md', scrollPosition: 0 },
          ],
          activeFilePath: '/workspace/y.md',
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
      expect(api?.openTabs.length).toBe(2);
    });

    expect(api!.secondary).toBeNull();
    expect(api!.primary.tabIds).toHaveLength(2);
    const yTab = api!.openTabs.find(t => t.path === '/workspace/y.md')!;
    expect(api!.primary.activeTabId).toBe(yTab.id);
    expect(api!.activePaneId).toBe('pane-1');
  });

  it('skips persisted pane membership for paths that did not restore', async () => {
    // Set up: snapshot references three files but only two are present in
    // openFilePaths (the third was deleted between sessions).
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          openFilePaths: [
            { path: '/workspace/a.md', scrollPosition: 0 },
            { path: '/workspace/b.md', scrollPosition: 0 },
          ],
          activeFilePath: '/workspace/a.md',
          expandedFolders: [],
          panes: [
            { id: 'pane-1', paths: ['/workspace/a.md'], activePath: '/workspace/a.md' },
            { id: 'pane-2', paths: ['/workspace/b.md', '/workspace/missing.md'], activePath: '/workspace/missing.md' },
          ],
          activePaneId: 'pane-2',
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
      expect(api?.openTabs.length).toBe(2);
    });
    await waitFor(() => {
      expect(api?.secondary).not.toBeNull();
    });

    const tabA = api!.openTabs.find(t => t.path === '/workspace/a.md')!;
    const tabB = api!.openTabs.find(t => t.path === '/workspace/b.md')!;
    expect(api!.primary.tabIds).toEqual([tabA.id]);
    expect(api!.secondary?.tabIds).toEqual([tabB.id]);
    // activePath was the missing file, so the resolved active falls back to null.
    expect(api!.secondary?.activeTabId).toBeNull();
  });
});
