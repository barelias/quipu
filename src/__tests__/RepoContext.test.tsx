/**
 * Tests for the file-store wiring inside `RepoContext`.
 *
 * Strategy: mock `repoFileStore` and `quipuFileStore` directly. Those
 * services have their own unit tests covering disk behavior; here we only
 * verify the context's call shape, state lifecycle, and watcher
 * integration. Mirrors the AgentContext test approach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Repo } from '@/types/agent';

// === Mocks for service modules ===========================================
//
// `vi.mock` factories are hoisted above any non-import statement, so any
// state they reference must come from `vi.hoisted` — that runs before
// the mocks but after vitest is initialized.

const hoisted = vi.hoisted(() => ({
  repoFileStore: {
    loadAllRepos: vi.fn(),
    loadAllFolders: vi.fn(),
    saveRepo: vi.fn(),
    deleteRepo: vi.fn(),
    deleteFolder: vi.fn(),
    renameFolder: vi.fn(),
    createFolder: vi.fn(),
  },
  fileSystem: {
    deletePath: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDirectory: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    onDirectoryChanged: vi.fn(),
    watchDirectory: vi.fn(),
  },
  watchers: [] as Array<{
    absDir: string;
    onChange: (event: { type: 'change' | 'rename'; path?: string }) => void;
    unsubscribed: boolean;
  }>,
}));
const mockRepoFileStore = hoisted.repoFileStore;
const mockFs = hoisted.fileSystem;

vi.mock('../services/repoFileStore', () => hoisted.repoFileStore);

vi.mock('../services/fileSystem', () => ({
  default: hoisted.fileSystem,
}));

vi.mock('../services/quipuFileStore', () => ({
  watchDirRecursive: (
    absDir: string,
    onChange: (event: { type: 'change' | 'rename'; path?: string }) => void,
  ): (() => void) => {
    const entry = { absDir, onChange, unsubscribed: false };
    hoisted.watchers.push(entry);
    return () => { entry.unsubscribed = true; };
  },
}));
// Stub legacyImport to a no-op so RepoContext mounting doesn't trigger
// the real import pipeline (which expects `~/.quipu/` IO).
vi.mock('../services/legacyImport', () => ({
  importLegacyDataForWorkspace: vi.fn(async () => ({ imported: 0, errors: 0 })),
}));

let currentWorkspacePath: string | null = null;
vi.mock('../context/FileSystemContext', () => ({
  useFileSystem: () => ({ workspacePath: currentWorkspacePath }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { RepoProvider, useRepo } from '../context/RepoContext';

// === Test harness =========================================================

function makeRepo(overrides: Partial<Repo> & Pick<Repo, 'id' | 'slug' | 'name'>): Repo {
  const now = '2026-04-30T10:00:00Z';
  return {
    id: overrides.id,
    slug: overrides.slug,
    name: overrides.name,
    url: overrides.url ?? `https://example.com/${overrides.slug}.git`,
    folder: overrides.folder,
    localClonePath: overrides.localClonePath,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

interface ActionsApi {
  upsertRepo: (repo: Repo) => void;
  deleteRepo: (id: string, options?: { removeClone?: boolean }) => Promise<void>;
  deleteFolder: (folder: string, options?: { removeClones?: boolean }) => Promise<void>;
  cloneRepoForAgent: (repoId: string, agentId: string) => Promise<string>;
  getCloneStatus: (id: string) => string;
}

let actionsApi: ActionsApi | null = null;

function StateProbe() {
  const ctx = useRepo();
  React.useEffect(() => {
    actionsApi = {
      upsertRepo: ctx.upsertRepo,
      deleteRepo: ctx.deleteRepo,
      deleteFolder: ctx.deleteFolder,
      cloneRepoForAgent: ctx.cloneRepoForAgent,
      getCloneStatus: (id) => ctx.getCloneStatus(id).state,
    };
  });
  return (
    <div>
      <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>
      <div data-testid="repoIds">{ctx.repos.map(r => r.id).sort().join(',')}</div>
      <div data-testid="repoFolders">{ctx.repos.map(r => `${r.id}:${r.folder ?? ''}`).sort().join(',')}</div>
    </div>
  );
}

function Harness({ initialPath, onReady, children }: {
  initialPath: string | null;
  onReady?: (api: { setPath: (p: string | null) => void }) => void;
  children: React.ReactNode;
}) {
  const [path, setPath] = useState<string | null>(initialPath);
  currentWorkspacePath = path;
  React.useEffect(() => { onReady?.({ setPath }); }, [onReady]);
  return <RepoProvider>{children}</RepoProvider>;
}

beforeEach(() => {
  for (const m of Object.values(mockRepoFileStore)) m.mockReset();
  for (const m of Object.values(mockFs)) m.mockReset();

  // Restore default no-op implementations after reset.
  mockRepoFileStore.loadAllRepos.mockImplementation(async () => []);
  mockRepoFileStore.loadAllFolders.mockImplementation(async () => []);
  mockRepoFileStore.saveRepo.mockImplementation(async (_, repo: Repo, _prev?: string) => {
    const folder = repo.folder ?? '';
    const slug = repo.slug ?? '';
    return folder === '' ? slug : `${folder}/${slug}`;
  });
  mockRepoFileStore.deleteRepo.mockImplementation(async () => {});
  mockRepoFileStore.deleteFolder.mockImplementation(async () => {});
  mockRepoFileStore.renameFolder.mockImplementation(async () => {});
  mockRepoFileStore.createFolder.mockImplementation(async () => {});

  mockFs.deletePath.mockImplementation(async () => ({ success: true }));
  mockFs.readFile.mockImplementation(async () => '');
  mockFs.writeFile.mockImplementation(async () => ({ success: true }));
  mockFs.readDirectory.mockImplementation(async () => []);
  mockFs.createFolder.mockImplementation(async () => ({ success: true }));
  mockFs.renamePath.mockImplementation(async () => ({ success: true }));
  mockFs.onDirectoryChanged.mockImplementation(() => () => {});
  mockFs.watchDirectory.mockImplementation(async () => null);

  hoisted.watchers.length = 0;
  currentWorkspacePath = null;
  actionsApi = null;
});

describe('RepoProvider — file-store load lifecycle', () => {
  it('happy path: mounts with workspacePath=/foo and populates state from repoFileStore', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'quipu', slug: 'quipu', name: 'Quipu' }),
      makeRepo({ id: 'external/upstream', slug: 'upstream', folder: 'external', name: 'Upstream' }),
    ]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(getByTestId('repoIds').textContent).toBe('external/upstream,quipu');
    expect(mockRepoFileStore.loadAllRepos).toHaveBeenCalledWith('/foo');
  });

  it('mounts with workspacePath=null → state stays empty, no file-store calls', async () => {
    const { getByTestId } = render(
      <Harness initialPath={null}>
        <StateProbe />
      </Harness>,
    );

    await act(async () => { await Promise.resolve(); });

    expect(getByTestId('isLoaded').textContent).toBe('false');
    expect(getByTestId('repoIds').textContent).toBe('');
    expect(mockRepoFileStore.loadAllRepos).not.toHaveBeenCalled();
  });

  it('workspace switch /foo → /bar clears state and reloads from /bar', async () => {
    mockRepoFileStore.loadAllRepos.mockImplementation(async (workspace: string) => {
      if (workspace === '/foo') return [makeRepo({ id: 'foo-1', slug: 'foo-1', name: 'Foo' })];
      if (workspace === '/bar') return [makeRepo({ id: 'bar-1', slug: 'bar-1', name: 'Bar' })];
      return [];
    });

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('foo-1'));
    expect(api).not.toBeNull();

    await act(async () => { api!.setPath('/bar'); });
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('bar-1'));
  });

  it('rapid workspace switch /foo → /bar → /foo: latest path wins (cancelled flag)', async () => {
    let resolveFoo: (v: Repo[]) => void = () => {};
    let resolveBar: (v: Repo[]) => void = () => {};
    const fooPromise = new Promise<Repo[]>(res => { resolveFoo = res; });
    const barPromise = new Promise<Repo[]>(res => { resolveBar = res; });

    mockRepoFileStore.loadAllRepos.mockImplementation(async (workspace: string) => {
      if (workspace === '/foo') return fooPromise;
      if (workspace === '/bar') return barPromise;
      return [];
    });

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    // Quickly hop to /bar and back to /foo BEFORE either load resolves.
    await act(async () => {
      api!.setPath('/bar');
      api!.setPath('/foo');
    });

    // Now resolve both — only /foo's data should win.
    await act(async () => {
      resolveBar([makeRepo({ id: 'bar-1', slug: 'bar-1', name: 'Bar' })]);
      resolveFoo([makeRepo({ id: 'foo-final', slug: 'foo-final', name: 'Foo final' })]);
      await Promise.resolve();
    });

    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(getByTestId('repoIds').textContent).toBe('foo-final');
  });

  it('error path: loadAllRepos rejects → isLoaded still flips to true, state stays empty', async () => {
    mockRepoFileStore.loadAllRepos.mockRejectedValueOnce(new Error('boom'));

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(getByTestId('repoIds').textContent).toBe('');
  });
});

describe('RepoProvider — mutators dispatch to the file store', () => {
  beforeEach(() => {
    mockRepoFileStore.loadAllRepos.mockResolvedValue([]);
  });

  async function mount(): Promise<ReturnType<typeof render>> {
    const result = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(result.getByTestId('isLoaded').textContent).toBe('true'));
    expect(actionsApi).not.toBeNull();
    return result;
  }

  it('upsertRepo (new) calls saveRepo with previousId=undefined and adds to state', async () => {
    const { getByTestId } = await mount();
    const fresh = makeRepo({ id: 'new-1', slug: 'new-1', name: 'Fresh' });

    await act(async () => {
      actionsApi!.upsertRepo(fresh);
      await Promise.resolve();
    });

    expect(mockRepoFileStore.saveRepo).toHaveBeenCalledTimes(1);
    const [ws, repo, prev] = mockRepoFileStore.saveRepo.mock.calls[0];
    expect(ws).toBe('/foo');
    expect((repo as Repo).slug).toBe('new-1');
    expect(prev).toBeUndefined();

    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('new-1'));
  });

  it('upsertRepo (existing) passes previousId so the file store can clean up renames', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'old-slug', slug: 'old-slug', name: 'Old' }),
    ]);
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('old-slug'));

    const updated = makeRepo({ id: 'old-slug', slug: 'old-slug', name: 'Renamed' });

    await act(async () => {
      actionsApi!.upsertRepo(updated);
      await Promise.resolve();
    });

    expect(mockRepoFileStore.saveRepo).toHaveBeenCalledTimes(1);
    const [, , prev] = mockRepoFileStore.saveRepo.mock.calls[0];
    expect(prev).toBe('old-slug');
  });

  it('deleteRepo calls repoFileStore.deleteRepo and updates state', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'gone', slug: 'gone', name: 'Gone' }),
    ]);
    const { getByTestId } = await mount();
    // Confirm the seeded repo is in state (and therefore in reposRef) before
    // we call deleteRepo — without this, the imperative ref read inside
    // deleteRepo can race with the React state commit.
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('gone'));

    await act(async () => {
      await actionsApi!.deleteRepo('gone');
    });

    expect(mockRepoFileStore.deleteRepo).toHaveBeenCalledWith('/foo', 'gone');
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe(''));
  });

  it('deleteRepo with options.removeClone=true also deletes the clone dir on disk', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({
        id: 'with-clone',
        slug: 'with-clone',
        name: 'With clone',
        localClonePath: '/foo/tmp/agent/repos/with-clone',
      }),
    ]);
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('with-clone'));

    await act(async () => {
      await actionsApi!.deleteRepo('with-clone', { removeClone: true });
    });

    expect(mockRepoFileStore.deleteRepo).toHaveBeenCalledWith('/foo', 'with-clone');
    expect(mockFs.deletePath).toHaveBeenCalledWith('/foo/tmp/agent/repos/with-clone');
  });

  it('deleteRepo without removeClone does NOT touch the disk clone path', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({
        id: 'with-clone',
        slug: 'with-clone',
        name: 'With clone',
        localClonePath: '/foo/tmp/agent/repos/with-clone',
      }),
    ]);
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('with-clone'));

    await act(async () => {
      await actionsApi!.deleteRepo('with-clone');
    });

    expect(mockFs.deletePath).not.toHaveBeenCalled();
  });

  it('deleteFolder calls repoFileStore.deleteFolder and reloads state', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'team-a/r1', slug: 'r1', folder: 'team-a', name: 'R1' }),
      makeRepo({ id: 'team-a/r2', slug: 'r2', folder: 'team-a', name: 'R2' }),
      makeRepo({ id: 'other/r3', slug: 'r3', folder: 'other', name: 'R3' }),
    ]);
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('other/r3,team-a/r1,team-a/r2'));

    // The reload after the deleteFolder call should return the surviving repo.
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'other/r3', slug: 'r3', folder: 'other', name: 'R3' }),
    ]);

    await act(async () => {
      await actionsApi!.deleteFolder('team-a');
    });

    expect(mockRepoFileStore.deleteFolder).toHaveBeenCalledWith('/foo', 'team-a', { recursive: true });
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('other/r3'));
  });

  it('deleteFolder with removeClones=true also deletes each repo\'s clone dir', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({
        id: 'team-a/r1',
        slug: 'r1',
        folder: 'team-a',
        name: 'R1',
        localClonePath: '/foo/tmp/agent/repos/r1',
      }),
      makeRepo({
        id: 'team-a/r2',
        slug: 'r2',
        folder: 'team-a',
        name: 'R2',
        localClonePath: '/foo/tmp/agent/repos/r2',
      }),
    ]);
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('team-a/r1,team-a/r2'));

    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([]);

    await act(async () => {
      await actionsApi!.deleteFolder('team-a', { removeClones: true });
    });

    const deletedDirs = mockFs.deletePath.mock.calls.map(c => c[0]).sort();
    expect(deletedDirs).toEqual([
      '/foo/tmp/agent/repos/r1',
      '/foo/tmp/agent/repos/r2',
    ]);
  });
});

describe('RepoProvider — cloneRepoForAgent', () => {
  beforeEach(() => {
    mockRepoFileStore.loadAllRepos.mockResolvedValue([
      makeRepo({
        id: 'quipu',
        slug: 'quipu',
        name: 'Quipu',
        url: 'https://example.com/quipu.git',
      }),
    ]);

    // Stub the Electron clone API with a window mock that records the target.
    const electronAPI = {
      gitClone: vi.fn(async () => ({ success: true })),
      pathExists: vi.fn(async () => false),
    };
    (window as unknown as { electronAPI: typeof electronAPI }).electronAPI = electronAPI;
  });

  it('produces the right disk target path: <workspace>/tmp/<agentId>/repos/<sanitized-name>', async () => {
    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(actionsApi).not.toBeNull();

    let target: string | null = null;
    await act(async () => {
      target = await actionsApi!.cloneRepoForAgent('quipu', 'agent-123');
    });

    expect(target).toBe('/foo/tmp/agent-123/repos/quipu');
    const electronAPI = (window as unknown as { electronAPI: { gitClone: ReturnType<typeof vi.fn> } }).electronAPI;
    expect(electronAPI.gitClone).toHaveBeenCalledWith('https://example.com/quipu.git', '/foo/tmp/agent-123/repos/quipu');
  });
});

describe('RepoProvider — file watcher integration', () => {
  it('subscribes to a watcher rooted at <workspace>/.quipu and unsubscribes on workspace switch', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValue([]);

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(hoisted.watchers.some(w => w.absDir === '/foo/.quipu' && !w.unsubscribed)).toBe(true);

    await act(async () => { api!.setPath('/bar'); });
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));

    const fooWatcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(fooWatcher?.unsubscribed).toBe(true);
    expect(hoisted.watchers.some(w => w.absDir === '/bar/.quipu' && !w.unsubscribed)).toBe(true);
  });

  it('watcher event under .quipu/repos/ triggers a reload', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));

    // Cross-window mutation: a new repo file appeared.
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([
      makeRepo({ id: 'cross-win', slug: 'cross-win', name: 'Cross window' }),
    ]);

    const watcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(watcher).toBeDefined();
    await act(async () => {
      watcher!.onChange({ type: 'change', path: '/foo/.quipu/repos/cross-win.json' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(getByTestId('repoIds').textContent).toBe('cross-win'));
  });

  it('watcher event under .quipu/agents/ does NOT trigger a repo reload', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    const initialLoadCalls = mockRepoFileStore.loadAllRepos.mock.calls.length;

    const watcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(watcher).toBeDefined();
    await act(async () => {
      watcher!.onChange({ type: 'change', path: '/foo/.quipu/agents/some-agent.json' });
      await Promise.resolve();
    });

    // No additional reload — the agents subtree is filtered out.
    expect(mockRepoFileStore.loadAllRepos.mock.calls.length).toBe(initialLoadCalls);
  });

  it('echo suppression: reload is NOT triggered for paths just written by this window', async () => {
    mockRepoFileStore.loadAllRepos.mockResolvedValueOnce([]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    const initialLoadCalls = mockRepoFileStore.loadAllRepos.mock.calls.length;

    // upsertRepo writes a file and registers it for echo suppression.
    const fresh = makeRepo({ id: 'echoed', slug: 'echoed', name: 'Echoed' });
    await act(async () => {
      actionsApi!.upsertRepo(fresh);
      await Promise.resolve();
    });

    // Watcher fires for the same path we just wrote — should be ignored.
    const watcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(watcher).toBeDefined();
    await act(async () => {
      watcher!.onChange({ type: 'change', path: '/foo/.quipu/repos/echoed.json' });
      await Promise.resolve();
    });

    // No additional reload past the initial mount load. (loadAllRepos
    // count stayed at initial — the echoed event was suppressed.)
    expect(mockRepoFileStore.loadAllRepos.mock.calls.length).toBe(initialLoadCalls);
  });
});
