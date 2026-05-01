/**
 * Tests for `appConfigStore`.
 *
 * Strategy: same pattern as `sessionCache.test.ts` — mock
 * `../services/fileSystem` with a node:fs/promises-backed fake against
 * a tmp directory. The fake's `getHomeDir` returns our tmp root so all
 * `~/.quipu/...` paths land inside the test's sandbox.
 *
 * Electron-mode is the default. The browser-mode fallback test
 * temporarily removes `window.electronAPI` so `isElectron()` returns
 * false, then exercises the localStorage path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import type { RecentWorkspaceEntry } from '../services/appConfigStore';

// `homeDirRef.value` is mutated in beforeEach to point at the per-test
// tmp directory. The mock factory closes over this object so each test
// sees an isolated home.
const homeDirRef = { value: '' };

vi.mock('../services/fileSystem', () => {
  const fakeFs = {
    getHomeDir: vi.fn(async () => homeDirRef.value),
    readDirectory: vi.fn(async (dirPath: string) => {
      const entries = await nodeFs.readdir(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: nodePath.join(dirPath, e.name),
        isDirectory: e.isDirectory(),
      }));
    }),
    readFile: vi.fn(async (filePath: string) => {
      return nodeFs.readFile(filePath, 'utf8');
    }),
    writeFile: vi.fn(async (filePath: string, content: string) => {
      await nodeFs.mkdir(nodePath.dirname(filePath), { recursive: true });
      await nodeFs.writeFile(filePath, content, 'utf8');
      return { success: true };
    }),
    createFolder: vi.fn(async (folderPath: string) => {
      await nodeFs.mkdir(folderPath, { recursive: true });
      return { success: true };
    }),
    renamePath: vi.fn(async (oldPath: string, newPath: string) => {
      await nodeFs.rename(oldPath, newPath);
      return { success: true };
    }),
    deletePath: vi.fn(async (targetPath: string) => {
      await nodeFs.rm(targetPath, { recursive: true, force: true });
      return { success: true };
    }),
    watchDirectory: vi.fn(async () => ({ success: true })),
    onDirectoryChanged: vi.fn(() => () => {}),
  };
  return { default: fakeFs };
});

// IMPORTANT: import after the mock so the module-level homeDir cache in
// appConfigStore binds to our fake. The cache is module-scoped, but each
// test uses a unique fake `homeDir` — see resetModules() in beforeEach.
let loadRecentWorkspaces: typeof import('../services/appConfigStore').loadRecentWorkspaces;
let saveRecentWorkspaces: typeof import('../services/appConfigStore').saveRecentWorkspaces;
let loadLastOpenedWorkspace: typeof import('../services/appConfigStore').loadLastOpenedWorkspace;
let saveLastOpenedWorkspace: typeof import('../services/appConfigStore').saveLastOpenedWorkspace;

let tmpRoot = '';

/** Stub `window.electronAPI` so `isElectron()` returns true. */
function installElectronStub(): void {
  // The renderer normally has these set by `electron/preload.cjs`.
  // We only need `storageGet` to exist (the `isElectron` heuristic
  // checks for that field).
  (globalThis as unknown as { window: Record<string, unknown> }).window =
    (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
  (globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI = {
    storageGet: () => Promise.resolve(null),
  };
}

/** Remove `window.electronAPI` so `isElectron()` returns false. */
function removeElectronStub(): void {
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (w) delete w.electronAPI;
}

function makeEntry(path: string): RecentWorkspaceEntry {
  return {
    path,
    name: path.split('/').filter(Boolean).pop() ?? path,
    lastOpened: '2026-04-30T10:00:00.000Z',
  };
}

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-app-config-'));
  homeDirRef.value = tmpRoot;
  installElectronStub();
  // Reset module state between tests so the in-process homeDir promise
  // doesn't leak across tests.
  vi.resetModules();
  const mod = await import('../services/appConfigStore');
  loadRecentWorkspaces = mod.loadRecentWorkspaces;
  saveRecentWorkspaces = mod.saveRecentWorkspaces;
  loadLastOpenedWorkspace = mod.loadLastOpenedWorkspace;
  saveLastOpenedWorkspace = mod.saveLastOpenedWorkspace;
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
  removeElectronStub();
});

describe('appConfigStore — Electron mode', () => {
  describe('recent workspaces', () => {
    it('round-trip: save then load returns the same list', async () => {
      const list = [makeEntry('/foo'), makeEntry('/bar/baz')];
      await saveRecentWorkspaces(list);
      const loaded = await loadRecentWorkspaces();
      expect(loaded).toEqual(list);
    });

    it('writes to ~/.quipu/recent-workspaces.json with schema version', async () => {
      await saveRecentWorkspaces([makeEntry('/foo')]);
      const expected = nodePath.join(tmpRoot, '.quipu', 'recent-workspaces.json');
      const raw = await nodeFs.readFile(expected, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(1);
      expect(Array.isArray(parsed.list)).toBe(true);
      expect(parsed.list[0].path).toBe('/foo');
    });

    it('returns [] when the file is missing', async () => {
      const loaded = await loadRecentWorkspaces();
      expect(loaded).toEqual([]);
    });

    it('returns [] when the file contains malformed JSON', async () => {
      const dir = nodePath.join(tmpRoot, '.quipu');
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, 'recent-workspaces.json');
      await nodeFs.writeFile(filePath, '{ this is not json', 'utf8');
      const loaded = await loadRecentWorkspaces();
      expect(loaded).toEqual([]);
    });

    it('returns [] when the file has the wrong shape (no `list` field)', async () => {
      const dir = nodePath.join(tmpRoot, '.quipu');
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, 'recent-workspaces.json');
      await nodeFs.writeFile(filePath, JSON.stringify({ schemaVersion: 1 }), 'utf8');
      const loaded = await loadRecentWorkspaces();
      expect(loaded).toEqual([]);
    });

    it('overwrites existing data on subsequent save', async () => {
      await saveRecentWorkspaces([makeEntry('/foo'), makeEntry('/bar')]);
      await saveRecentWorkspaces([makeEntry('/baz')]);
      const loaded = await loadRecentWorkspaces();
      expect(loaded.map((e) => e.path)).toEqual(['/baz']);
    });
  });

  describe('last-opened workspace', () => {
    it('round-trip: save then load returns the same path', async () => {
      await saveLastOpenedWorkspace('/some/workspace');
      const loaded = await loadLastOpenedWorkspace();
      expect(loaded).toBe('/some/workspace');
    });

    it('writes to ~/.quipu/window-state.json with schema version', async () => {
      await saveLastOpenedWorkspace('/foo');
      const expected = nodePath.join(tmpRoot, '.quipu', 'window-state.json');
      const raw = await nodeFs.readFile(expected, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.lastOpenedWorkspace).toBe('/foo');
    });

    it('returns null when the file is missing', async () => {
      const loaded = await loadLastOpenedWorkspace();
      expect(loaded).toBeNull();
    });

    it('returns null when the file contains malformed JSON', async () => {
      const dir = nodePath.join(tmpRoot, '.quipu');
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, 'window-state.json');
      await nodeFs.writeFile(filePath, 'not json at all', 'utf8');
      const loaded = await loadLastOpenedWorkspace();
      expect(loaded).toBeNull();
    });

    it('returns null when the field is empty string', async () => {
      const dir = nodePath.join(tmpRoot, '.quipu');
      await nodeFs.mkdir(dir, { recursive: true });
      const filePath = nodePath.join(dir, 'window-state.json');
      await nodeFs.writeFile(
        filePath,
        JSON.stringify({ schemaVersion: 1, lastOpenedWorkspace: '' }),
        'utf8',
      );
      const loaded = await loadLastOpenedWorkspace();
      expect(loaded).toBeNull();
    });

    it('persisting null clears the previous value', async () => {
      await saveLastOpenedWorkspace('/foo');
      await saveLastOpenedWorkspace(null);
      const loaded = await loadLastOpenedWorkspace();
      expect(loaded).toBeNull();
    });
  });
});

describe('appConfigStore — Browser mode (localStorage fallback)', () => {
  // jsdom provides a real `localStorage` object on `window`. We use it
  // directly (after clearing it) — `localStorage` is read-only as a
  // property descriptor in jsdom, so swapping it out doesn't work.
  // Clearing between tests is enough for isolation.

  beforeEach(async () => {
    // Tear down the Electron stub so isElectron() returns false.
    removeElectronStub();
    // Wipe any leftover localStorage state from previous tests.
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    // Re-import after the runtime detection swap.
    vi.resetModules();
    const mod = await import('../services/appConfigStore');
    loadRecentWorkspaces = mod.loadRecentWorkspaces;
    saveRecentWorkspaces = mod.saveRecentWorkspaces;
    loadLastOpenedWorkspace = mod.loadLastOpenedWorkspace;
    saveLastOpenedWorkspace = mod.saveLastOpenedWorkspace;
  });

  afterEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('saveRecentWorkspaces writes to localStorage["recentWorkspaces"]', async () => {
    const list = [makeEntry('/foo'), makeEntry('/bar')];
    await saveRecentWorkspaces(list);
    const raw = localStorage.getItem('recentWorkspaces');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(list);
  });

  it('loadRecentWorkspaces reads from localStorage["recentWorkspaces"]', async () => {
    const list = [makeEntry('/foo'), makeEntry('/bar')];
    localStorage.setItem('recentWorkspaces', JSON.stringify(list));
    const loaded = await loadRecentWorkspaces();
    expect(loaded).toEqual(list);
  });

  it('loadRecentWorkspaces returns [] when the key is missing', async () => {
    const loaded = await loadRecentWorkspaces();
    expect(loaded).toEqual([]);
  });

  it('loadRecentWorkspaces returns [] when the value is malformed', async () => {
    localStorage.setItem('recentWorkspaces', '{ not json');
    const loaded = await loadRecentWorkspaces();
    expect(loaded).toEqual([]);
  });

  it('saveLastOpenedWorkspace writes to localStorage["lastOpenedWorkspace"]', async () => {
    await saveLastOpenedWorkspace('/foo');
    const raw = localStorage.getItem('lastOpenedWorkspace');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toBe('/foo');
  });

  it('loadLastOpenedWorkspace reads from localStorage["lastOpenedWorkspace"]', async () => {
    localStorage.setItem('lastOpenedWorkspace', JSON.stringify('/foo'));
    const loaded = await loadLastOpenedWorkspace();
    expect(loaded).toBe('/foo');
  });

  it('saveLastOpenedWorkspace(null) removes the key', async () => {
    localStorage.setItem('lastOpenedWorkspace', JSON.stringify('/foo'));
    await saveLastOpenedWorkspace(null);
    expect(localStorage.getItem('lastOpenedWorkspace')).toBeNull();
  });

  it('loadLastOpenedWorkspace returns null when the key is missing', async () => {
    const loaded = await loadLastOpenedWorkspace();
    expect(loaded).toBeNull();
  });
});
