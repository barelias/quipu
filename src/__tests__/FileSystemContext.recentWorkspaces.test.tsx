import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// In-memory fake of `appConfigStore`. Defined inside vi.mock's factory so
// hoisting works, then re-imported below for inspection. Mirrors the
// pattern used previously when this test mocked `storageService`.
//
// Note the per-window contract: each `FileSystemProvider` mount calls
// `loadRecentWorkspaces` and `loadLastOpenedWorkspace` exactly once. After
// mount, mutations write back via `saveRecentWorkspaces` /
// `saveLastOpenedWorkspace` but never re-read.
vi.mock('../services/appConfigStore', () => {
  const recentsRef: { value: unknown } = { value: null };
  const lastOpenedRef: { value: string | null } = { value: null };
  const fake = {
    loadRecentWorkspaces: vi.fn(async () => {
      const v = recentsRef.value;
      if (Array.isArray(v)) return [...v];
      return [];
    }),
    saveRecentWorkspaces: vi.fn(async (list: unknown[]) => {
      // Clone so callers reading back later don't see references mutated
      // by subsequent setters in another window.
      recentsRef.value = Array.isArray(list) ? [...list] : list;
    }),
    loadLastOpenedWorkspace: vi.fn(async () => lastOpenedRef.value),
    saveLastOpenedWorkspace: vi.fn(async (path: string | null) => {
      lastOpenedRef.value = path;
    }),
    __recentsRef: recentsRef,
    __lastOpenedRef: lastOpenedRef,
    __reset: () => {
      recentsRef.value = null;
      lastOpenedRef.value = null;
    },
  };
  return fake;
});

// Mock the file system service. FileSystemProvider's mount effect calls
// fs.readDirectory inside `validateAndPruneWorkspaces` for each entry; we
// resolve successfully so no entries are pruned during these tests.
vi.mock('../services/fileSystem', () => {
  return {
    default: {
      readDirectory: vi.fn(async () => []),
      openFolderDialog: vi.fn(async () => null),
      createFile: vi.fn(async () => ({ success: true })),
      createFolder: vi.fn(async () => ({ success: true })),
      deletePath: vi.fn(async () => ({ success: true })),
      renamePath: vi.fn(async () => ({ success: true })),
      getHomeDir: vi.fn(async () => '/home/test'),
    },
  };
});

vi.mock('../services/claudeInstaller', () => {
  return {
    default: {
      installFrameSkills: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../components/ui/Toast', () => {
  return {
    useToast: () => ({ showToast: vi.fn() }),
  };
});

import * as appConfigStoreModule from '../services/appConfigStore';
import fsService from '../services/fileSystem';
import { FileSystemProvider, useFileSystem } from '../context/FileSystemContext';
import type { RecentWorkspace } from '../types/workspace';

const fakeAppConfig = appConfigStoreModule as unknown as {
  loadRecentWorkspaces: ReturnType<typeof vi.fn>;
  saveRecentWorkspaces: ReturnType<typeof vi.fn>;
  loadLastOpenedWorkspace: ReturnType<typeof vi.fn>;
  saveLastOpenedWorkspace: ReturnType<typeof vi.fn>;
  __recentsRef: { value: unknown };
  __lastOpenedRef: { value: string | null };
  __reset: () => void;
};

const fakeFs = fsService as unknown as {
  readDirectory: ReturnType<typeof vi.fn>;
};

function makeRecent(path: string, name?: string): RecentWorkspace {
  return {
    path,
    name: name ?? path.split('/').filter(Boolean).pop() ?? path,
    lastOpened: '2026-01-01T00:00:00Z',
  };
}

interface ActionsApi {
  update: (folderPath: string) => Promise<void>;
  clear: () => Promise<void>;
  remove: (folderPath: string) => Promise<void>;
  selectFolder: (folderPath: string) => Promise<void>;
  getRecents: () => RecentWorkspace[];
}

function makeProbe(label: string, apiSink: { current: ActionsApi | null }) {
  return function ActionsProbe() {
    const ctx = useFileSystem();
    const recentsRef = React.useRef<RecentWorkspace[]>([]);
    recentsRef.current = ctx.recentWorkspaces;
    React.useEffect(() => {
      apiSink.current = {
        update: (p) => ctx.updateRecentWorkspaces(p),
        clear: () => ctx.clearRecentWorkspaces(),
        remove: (p) => ctx.removeFromRecentWorkspaces(p),
        selectFolder: (p) => ctx.selectFolder(p),
        getRecents: () => recentsRef.current,
      };
    });
    return (
      <div>
        <div data-testid={`recents:${label}`}>
          {ctx.recentWorkspaces.map(r => r.path).join(',')}
        </div>
      </div>
    );
  };
}

beforeEach(() => {
  fakeAppConfig.__reset();
  fakeAppConfig.loadRecentWorkspaces.mockClear();
  fakeAppConfig.saveRecentWorkspaces.mockClear();
  fakeAppConfig.loadLastOpenedWorkspace.mockClear();
  fakeAppConfig.saveLastOpenedWorkspace.mockClear();
  fakeFs.readDirectory.mockClear();
  fakeFs.readDirectory.mockImplementation(async () => []);
});

describe('FileSystemProvider per-window recentWorkspaces', () => {
  it('mount effect calls loadRecentWorkspaces and loadLastOpenedWorkspace exactly once', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);

    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    expect(fakeAppConfig.loadRecentWorkspaces).toHaveBeenCalledTimes(1);
    expect(fakeAppConfig.loadLastOpenedWorkspace).toHaveBeenCalledTimes(1);
  });

  it('happy path: window mounts with stored [a, b], opens c → state [c, a, b], on-disk [c, a, b]', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);

    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });
    expect(apiRef.current).not.toBeNull();

    await act(async () => {
      await apiRef.current!.update('/c');
    });

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });

    // updateRecentWorkspaces called saveRecentWorkspaces with the new list.
    const lastCall = fakeAppConfig.saveRecentWorkspaces.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const persistedList = lastCall![0] as RecentWorkspace[];
    expect(persistedList.map((r) => r.path)).toEqual(['/c', '/a', '/b']);

    const stored = fakeAppConfig.__recentsRef.value as RecentWorkspace[];
    expect(stored.map((r) => r.path)).toEqual(['/c', '/a', '/b']);
  });

  it('per-window contract: window 1 does not pick up window 2 writes after mount', async () => {
    // Both windows mount against the same shared store with the same
    // initial snapshot.
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const w1ApiRef: { current: ActionsApi | null } = { current: null };
    const W1Probe = makeProbe('w1', w1ApiRef);
    const win1 = render(
      <FileSystemProvider>
        <W1Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    // Window 1 opens /c. It writes [c, a, b] back to the store.
    await act(async () => {
      await w1ApiRef.current!.update('/c');
    });
    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });

    // Window 2 mounts now — it reads once and sees [c, a, b].
    const w2ApiRef: { current: ActionsApi | null } = { current: null };
    const W2Probe = makeProbe('w2', w2ApiRef);
    const win2 = render(
      <FileSystemProvider>
        <W2Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/c,/a,/b');
    });

    // Window 2 opens /d. Its state and the store become [d, c, a, b].
    await act(async () => {
      await w2ApiRef.current!.update('/d');
    });

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/d,/c,/a,/b');
    });

    // The store now reflects window 2's last write.
    const stored = fakeAppConfig.__recentsRef.value as RecentWorkspace[];
    expect(stored.map(r => r.path)).toEqual(['/d', '/c', '/a', '/b']);

    // CRITICAL: window 1 still reflects ONLY its own additions atop the
    // snapshot at its mount time. It does NOT re-read to pick up /d.
    // This is the per-window contract.
    expect(win1.getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
  });

  it('clearRecentWorkspaces in window 1 does not clear window 2\'s in-memory list', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const w1ApiRef: { current: ActionsApi | null } = { current: null };
    const W1Probe = makeProbe('w1', w1ApiRef);
    const win1 = render(
      <FileSystemProvider>
        <W1Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    const w2ApiRef: { current: ActionsApi | null } = { current: null };
    const W2Probe = makeProbe('w2', w2ApiRef);
    const win2 = render(
      <FileSystemProvider>
        <W2Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(win2.getByTestId('recents:w2').textContent).toBe('/a,/b');
    });

    // Window 1 clears.
    await act(async () => {
      await w1ApiRef.current!.clear();
    });

    await waitFor(() => {
      expect(win1.getByTestId('recents:w1').textContent).toBe('');
    });

    // Window 2's in-memory list is unaffected — it only sees the clear if
    // it remounts. (Per-window contract: no reads after mount.)
    expect(win2.getByTestId('recents:w2').textContent).toBe('/a,/b');
  });

  it('removeFromRecentWorkspaces with a path not in local state is a no-op (no spurious save)', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    const saveCallsBefore = fakeAppConfig.saveRecentWorkspaces.mock.calls.length;

    await act(async () => {
      await apiRef.current!.remove('/not-in-list');
    });

    // State unchanged.
    expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    // No new save fired.
    expect(fakeAppConfig.saveRecentWorkspaces.mock.calls.length).toBe(saveCallsBefore);
  });

  it('updateRecentWorkspaces dedupes when the same path is added twice in a row', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a')];

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a');
    });

    await act(async () => {
      await apiRef.current!.update('/c');
    });
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a');
    });

    await act(async () => {
      await apiRef.current!.update('/c');
    });
    // Re-adding /c should NOT create a duplicate — the new entry replaces
    // the old.
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a');
    });

    const recents = apiRef.current!.getRecents();
    expect(recents.filter(r => r.path === '/c').length).toBe(1);
  });

  it('updateRecentWorkspaces enforces the 10-entry cap', async () => {
    // Pre-fill 10 entries.
    const initial = Array.from({ length: 10 }, (_, i) => makeRecent(`/p${i}`));
    fakeAppConfig.__recentsRef.value = initial;

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe(initial.map(r => r.path).join(','));
    });

    // Add a new entry — the oldest should drop off.
    await act(async () => {
      await apiRef.current!.update('/new');
    });

    await waitFor(() => {
      const recents = apiRef.current!.getRecents();
      expect(recents.length).toBe(10);
      expect(recents[0].path).toBe('/new');
      // The last (oldest) entry /p9 should be evicted.
      expect(recents.some(r => r.path === '/p9')).toBe(false);
      // The previous head /p0 should still be present at index 1.
      expect(recents[1].path).toBe('/p0');
    });

    const stored = fakeAppConfig.__recentsRef.value as RecentWorkspace[];
    expect(stored.length).toBe(10);
  });

  it('integration: after selectFolder succeeds, the new entry appears at the top of local recents AND saveLastOpenedWorkspace is called', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];

    const apiRef: { current: ActionsApi | null } = { current: null };
    const Probe = makeProbe('w1', apiRef);
    const { getByTestId } = render(
      <FileSystemProvider>
        <Probe />
      </FileSystemProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/a,/b');
    });

    await act(async () => {
      await apiRef.current!.selectFolder('/c');
    });

    // selectFolder calls updateRecentWorkspaces fire-and-forget. Wait for
    // the state to reflect the update.
    await waitFor(() => {
      expect(getByTestId('recents:w1').textContent).toBe('/c,/a,/b');
    });

    // selectFolder also persists the last-opened workspace path.
    expect(fakeAppConfig.saveLastOpenedWorkspace).toHaveBeenCalledWith('/c');
  });

  it('mount effect auto-opens lastOpenedWorkspace when present', async () => {
    fakeAppConfig.__recentsRef.value = [makeRecent('/a'), makeRecent('/b')];
    fakeAppConfig.__lastOpenedRef.value = '/b';

    // Track which path readDirectory was called with for the auto-open.
    const readCalls: string[] = [];
    fakeFs.readDirectory.mockImplementation(async (p: string) => {
      readCalls.push(p);
      return [];
    });

    render(
      <FileSystemProvider>
        <div data-testid="probe">probe</div>
      </FileSystemProvider>,
    );

    await waitFor(() => {
      // The mount effect should have called readDirectory at least once
      // for the lastOpened workspace path.
      expect(readCalls).toContain('/b');
    });
  });
});
