/**
 * Regression coverage for `Tab.scrollPosition` round-tripping through
 * `restoreSession`. The persisted snapshot is written by SessionPersistence
 * (in WorkspaceContext) and the read path lives in TabContext.restoreSession.
 *
 * The bug this guards against: callers were passing `0` for the scroll
 * position when calling `snapshotTab`, so persisted snapshots always had
 * `scrollPosition: 0` and the editor always returned to the top after a
 * tab switch or session reload.
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
    // watchFrames returns a cleanup function with `registerPath` attached.
    watchFrames: vi.fn(() => {
      const cleanup = Object.assign(() => {}, {
        registerPath: vi.fn(),
      });
      return cleanup;
    }),
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

function TabsProbe({ onTabs }: { onTabs: (tabs: ReturnType<typeof useTab>['openTabs']) => void }) {
  const { openTabs } = useTab();
  React.useEffect(() => { onTabs(openTabs); }, [openTabs, onTabs]);
  return null;
}

describe('TabContext — scrollPosition persistence round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores scrollPosition from a persisted SessionSnapshot onto each rebuilt Tab', async () => {
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          openFilePaths: [
            { path: '/workspace/scrolled.md', scrollPosition: 250 },
            { path: '/workspace/top.md', scrollPosition: 0 },
          ],
          activeFilePath: '/workspace/scrolled.md',
          expandedFolders: [],
        };
      }
      return null;
    });

    let captured: ReturnType<typeof useTab>['openTabs'] = [];
    render(
      <TabProvider>
        <TabsProbe onTabs={(tabs) => { captured = tabs; }} />
      </TabProvider>,
    );

    await waitFor(() => {
      expect(captured).toHaveLength(2);
    });

    const scrolled = captured.find(t => t.path === '/workspace/scrolled.md');
    const top = captured.find(t => t.path === '/workspace/top.md');

    expect(scrolled?.scrollPosition).toBe(250);
    expect(top?.scrollPosition).toBe(0);
  });

  it('snapshotTab writes the supplied scrollPosition onto the matching tab', async () => {
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          openFilePaths: [{ path: '/workspace/doc.md', scrollPosition: 0 }],
          activeFilePath: '/workspace/doc.md',
          expandedFolders: [],
        };
      }
      return null;
    });

    let api: ReturnType<typeof useTab> | null = null;
    function Probe() {
      api = useTab();
      return null;
    }

    render(
      <TabProvider>
        <Probe />
      </TabProvider>,
    );

    await waitFor(() => {
      expect(api?.openTabs).toHaveLength(1);
    });

    const tabId = api!.openTabs[0].id;
    act(() => {
      api!.snapshotTab(tabId, { type: 'doc', content: [] }, 480);
    });

    await waitFor(() => {
      expect(api?.openTabs.find(t => t.id === tabId)?.scrollPosition).toBe(480);
    });
  });

  it('treats a snapshot entry without scrollPosition as 0 (back-compat with pre-fix sessions)', async () => {
    hoisted.storage.get.mockImplementation(async (key: string) => {
      if (key === 'session:/workspace') {
        return {
          // Older snapshots may have entries without scrollPosition
          openFilePaths: [{ path: '/workspace/legacy.md' } as { path: string; scrollPosition: number }],
          activeFilePath: '/workspace/legacy.md',
          expandedFolders: [],
        };
      }
      return null;
    });

    let captured: ReturnType<typeof useTab>['openTabs'] = [];
    render(
      <TabProvider>
        <TabsProbe onTabs={(tabs) => { captured = tabs; }} />
      </TabProvider>,
    );

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });

    expect(captured[0]?.scrollPosition).toBe(0);
  });
});
