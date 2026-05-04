/**
 * Tests for `legacyImport`.
 *
 * Strategy: mock both `../services/fileSystem` (so `~/.quipu/` lives in
 * a per-test tmp dir) and `../services/storageService` (an in-memory
 * fake of the legacy quipu-state.json key-value store). The domain code
 * runs unchanged.
 *
 * The most important test is the FAILURE-PATH test: when a saveAgent
 * throws, the source storage key MUST NOT be cleared. This is the
 * data-loss safety invariant — if it ever breaks, the user's agents
 * disappear on import retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import type { Agent, AgentSession, Repo } from '@/types/agent';

// === Mocks =================================================================

const homeDirRef = { value: '' };

vi.mock('../services/fileSystem', () => {
  const fakeFs = {
    getHomeDir: vi.fn(async () => homeDirRef.value),
    readDirectory: vi.fn(async (dirPath: string) => {
      try {
        const entries = await nodeFs.readdir(dirPath, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          path: nodePath.join(dirPath, e.name),
          isDirectory: e.isDirectory(),
        }));
      } catch {
        return [];
      }
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

vi.mock('../services/storageService', () => {
  const store = new Map<string, unknown>();
  const fake = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      if (value === null || value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    }),
    __store: store,
    __reset: () => {
      store.clear();
    },
  };
  return { default: fake, isElectronRuntime: () => true };
});

// === Test setup ============================================================

let tmpRoot = '';
let workspacePath = '';

let importLegacyDataForWorkspace:
  typeof import('../services/legacyImport').importLegacyDataForWorkspace;
let __resetForTests: typeof import('../services/legacyImport').__resetForTests;
let agentFileStore: typeof import('../services/agentFileStore');
let repoFileStore: typeof import('../services/repoFileStore');
let sessionCache: typeof import('../services/sessionCache');
let storageService: {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  __store: Map<string, unknown>;
  __reset: () => void;
};

/** Fixture: minimal legacy-shape agent with a UUID id. */
function makeLegacyAgent(overrides: Partial<Agent> & Pick<Agent, 'name' | 'id'>): Partial<Agent> {
  const now = '2026-04-30T10:00:00.000Z';
  return {
    id: overrides.id,
    name: overrides.name,
    kind: overrides.kind ?? 'agent',
    systemPrompt: overrides.systemPrompt ?? 'You are an agent.',
    model: overrides.model ?? 'claude-sonnet-4-5',
    bindings: overrides.bindings ?? [],
    permissionMode: overrides.permissionMode ?? 'default',
    folder: overrides.folder,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    // `slug` deliberately omitted — legacy records don't have slugs.
  };
}

function makeLegacyRepo(overrides: Partial<Repo> & Pick<Repo, 'name' | 'id' | 'url'>): Partial<Repo> {
  const now = '2026-04-30T10:00:00.000Z';
  return {
    id: overrides.id,
    name: overrides.name,
    url: overrides.url,
    folder: overrides.folder,
    localClonePath: overrides.localClonePath,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeLegacySession(agentId: string): AgentSession {
  return {
    agentId,
    claudeSessionId: `claude-${agentId}`,
    messages: [
      { id: 'm1', role: 'user', body: 'hi', createdAt: '2026-04-30T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', body: 'hello', createdAt: '2026-04-30T10:00:01.000Z' },
    ],
    updatedAt: '2026-04-30T10:00:01.000Z',
  };
}

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-legacy-import-'));
  homeDirRef.value = tmpRoot;
  workspacePath = nodePath.join(tmpRoot, 'workspace');
  await nodeFs.mkdir(workspacePath, { recursive: true });

  vi.resetModules();
  const importMod = await import('../services/legacyImport');
  importLegacyDataForWorkspace = importMod.importLegacyDataForWorkspace;
  __resetForTests = importMod.__resetForTests;

  agentFileStore = await import('../services/agentFileStore');
  repoFileStore = await import('../services/repoFileStore');
  sessionCache = await import('../services/sessionCache');

  storageService = (await import('../services/storageService')).default as unknown as typeof storageService;
  storageService.__reset();
  storageService.get.mockClear();
  storageService.set.mockClear();

  __resetForTests();
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

// === Tests =================================================================

describe('importLegacyDataForWorkspace — happy paths', () => {
  it('drains workspace-scoped agents and clears the source key', async () => {
    const agentsKey = `agents:${workspacePath}`;
    storageService.__store.set(agentsKey, [
      makeLegacyAgent({ id: 'uuid-1', name: 'Agent One', kind: 'chat' }),
      makeLegacyAgent({ id: 'uuid-2', name: 'Agent Two', kind: 'agent' }),
      makeLegacyAgent({ id: 'uuid-3', name: 'Agent Three', kind: 'chat' }),
    ]);

    const result = await importLegacyDataForWorkspace(workspacePath);
    expect(result.imported).toBe(3);
    expect(result.errors).toBe(0);

    // Source key cleared.
    expect(storageService.__store.has(agentsKey)).toBe(false);

    // Files appear in the new layout.
    const loaded = await agentFileStore.loadAllAgents(workspacePath);
    expect(loaded.map((a) => a.name).sort()).toEqual(['Agent One', 'Agent Three', 'Agent Two']);

    // import-state marks this workspace.
    const importStatePath = nodePath.join(tmpRoot, '.quipu', 'import-state.json');
    const stateRaw = await nodeFs.readFile(importStatePath, 'utf8');
    const state = JSON.parse(stateRaw);
    expect(state.imported[workspacePath]).toBeTruthy();
  });

  it('drains workspace-scoped sessions, remapping old UUIDs to new slug-ids', async () => {
    const agentsKey = `agents:${workspacePath}`;
    const sessionsKey = `agent-sessions:${workspacePath}`;
    storageService.__store.set(agentsKey, [
      makeLegacyAgent({ id: 'uuid-1', name: 'Agent One', kind: 'chat' }),
    ]);
    storageService.__store.set(sessionsKey, {
      'uuid-1': makeLegacySession('uuid-1'),
    });

    await importLegacyDataForWorkspace(workspacePath);

    expect(storageService.__store.has(agentsKey)).toBe(false);
    expect(storageService.__store.has(sessionsKey)).toBe(false);

    // Session is now at the new id ('agent-one' from slugify).
    const loaded = await sessionCache.loadSession(workspacePath, 'agent-one');
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe('agent-one');
    expect(loaded!.messages).toHaveLength(2);

    // No orphan session at the old uuid id.
    const orphan = await sessionCache.loadSession(workspacePath, 'uuid-1');
    expect(orphan).toBeNull();
  });

  it('imports declared agent folders from the legacy {chats,agents} shape', async () => {
    const foldersKey = `agent-folders:${workspacePath}`;
    storageService.__store.set(foldersKey, {
      chats: ['Research'],
      agents: ['Daily Tools'],
    });

    await importLegacyDataForWorkspace(workspacePath);

    expect(storageService.__store.has(foldersKey)).toBe(false);

    const folders = await agentFileStore.loadAllFolders(workspacePath);
    const paths = folders.map((f) => f.path).sort();
    expect(paths).toEqual(['daily-tools', 'research']);
  });

  it('imports workspace-scoped repos and clears the source key', async () => {
    const reposKey = `repos:${workspacePath}`;
    storageService.__store.set(reposKey, [
      makeLegacyRepo({ id: 'r1', name: 'My Repo', url: 'https://example.com/r1.git' }),
      makeLegacyRepo({ id: 'r2', name: 'Other Repo', url: 'https://example.com/r2.git', folder: 'External' }),
    ]);

    const result = await importLegacyDataForWorkspace(workspacePath);
    expect(result.imported).toBe(2);
    expect(result.errors).toBe(0);
    expect(storageService.__store.has(reposKey)).toBe(false);

    const loaded = await repoFileStore.loadAllRepos(workspacePath);
    expect(loaded.map((r) => r.name).sort()).toEqual(['My Repo', 'Other Repo']);
  });

  it('falls back to global keys: first workspace claims, second is no-op for globals', async () => {
    storageService.__store.set('agents', [
      makeLegacyAgent({ id: 'g1', name: 'Global Agent A', kind: 'chat' }),
      makeLegacyAgent({ id: 'g2', name: 'Global Agent B', kind: 'agent' }),
      makeLegacyAgent({ id: 'g3', name: 'Global Agent C', kind: 'chat' }),
      makeLegacyAgent({ id: 'g4', name: 'Global Agent D', kind: 'agent' }),
      makeLegacyAgent({ id: 'g5', name: 'Global Agent E', kind: 'chat' }),
    ]);

    const wp1 = workspacePath;
    const wp2 = nodePath.join(tmpRoot, 'workspace2');
    await nodeFs.mkdir(wp2, { recursive: true });

    const r1 = await importLegacyDataForWorkspace(wp1);
    expect(r1.imported).toBe(5);
    expect(r1.errors).toBe(0);

    // First workspace got all 5 agents.
    const wp1Agents = await agentFileStore.loadAllAgents(wp1);
    expect(wp1Agents.map((a) => a.name).sort()).toEqual([
      'Global Agent A',
      'Global Agent B',
      'Global Agent C',
      'Global Agent D',
      'Global Agent E',
    ]);

    // Globals have been cleared.
    expect(storageService.__store.has('agents')).toBe(false);

    // import-state records which workspace claimed the globals.
    const stateRaw = await nodeFs.readFile(nodePath.join(tmpRoot, '.quipu', 'import-state.json'), 'utf8');
    const state = JSON.parse(stateRaw);
    expect(state.globalsClaimed).toBe(wp1);

    // Second workspace's import is a no-op for globals (and there are no
    // scoped keys for it either, so 0 imported).
    storageService.get.mockClear();
    const r2 = await importLegacyDataForWorkspace(wp2);
    expect(r2.imported).toBe(0);

    const wp2Agents = await agentFileStore.loadAllAgents(wp2);
    expect(wp2Agents).toHaveLength(0);
  });

  it('disambiguates legacy slug collisions within the same folder', async () => {
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'Same Name', kind: 'agent' }),
      makeLegacyAgent({ id: 'u2', name: 'Same Name', kind: 'agent' }),
    ]);

    await importLegacyDataForWorkspace(workspacePath);
    const loaded = await agentFileStore.loadAllAgents(workspacePath);
    expect(loaded.map((a) => a.slug).sort()).toEqual(['same-name', 'same-name-2']);
  });
});

describe('importLegacyDataForWorkspace — idempotency / fast-path', () => {
  it('legacy storage missing/empty: no-op import still marks workspace', async () => {
    const result = await importLegacyDataForWorkspace(workspacePath);
    expect(result.imported).toBe(0);
    expect(result.errors).toBe(0);
    const stateRaw = await nodeFs.readFile(nodePath.join(tmpRoot, '.quipu', 'import-state.json'), 'utf8');
    const state = JSON.parse(stateRaw);
    expect(state.imported[workspacePath]).toBeTruthy();
  });

  it('second invocation for the same workspace is a no-op fast-path', async () => {
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'A1', kind: 'chat' }),
    ]);

    await importLegacyDataForWorkspace(workspacePath);

    storageService.get.mockClear();
    storageService.set.mockClear();
    const r2 = await importLegacyDataForWorkspace(workspacePath);
    expect(r2.imported).toBe(0);
    expect(r2.errors).toBe(0);

    // Only ONE storage.get call: the import-state read at the top
    // (well, none — import-state lives in ~/.quipu, read via fileSystem,
    // not storageService). So 0 storage.get calls is the fast-path
    // proof.
    expect(storageService.get).not.toHaveBeenCalled();
    expect(storageService.set).not.toHaveBeenCalled();
  });
});

describe('importLegacyDataForWorkspace — failure-mode safety invariant', () => {
  it('saveAgent throws on agent N: source key NOT cleared, retry sees all agents again', async () => {
    const agentsKey = `agents:${workspacePath}`;
    const legacyAgents = [
      makeLegacyAgent({ id: 'u1', name: 'First', kind: 'chat' }),
      makeLegacyAgent({ id: 'u2', name: 'Second', kind: 'chat' }),
      makeLegacyAgent({ id: 'u3', name: 'Third', kind: 'chat' }),
    ];
    storageService.__store.set(agentsKey, legacyAgents);

    // Force the second saveAgent call to throw.
    let calls = 0;
    const realSaveAgent = agentFileStore.saveAgent;
    const spy = vi.spyOn(agentFileStore, 'saveAgent').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full (simulated)');
      return realSaveAgent(...args);
    });

    const result = await importLegacyDataForWorkspace(workspacePath);

    // CRITICAL: the source key is intact for next-launch retry.
    expect(storageService.__store.has(agentsKey)).toBe(true);
    expect(storageService.__store.get(agentsKey)).toEqual(legacyAgents);

    // 2 of 3 succeeded (first + third), 1 failed (second).
    expect(result.imported).toBe(2);
    expect(result.errors).toBe(1);

    spy.mockRestore();
  });

  it('saveAgent throws on a session: workspace-scoped session key NOT cleared', async () => {
    const sessionsKey = `agent-sessions:${workspacePath}`;
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'Solo', kind: 'chat' }),
    ]);
    storageService.__store.set(sessionsKey, {
      'u1': makeLegacySession('u1'),
    });

    const realSave = sessionCache.saveSession;
    const spy = vi.spyOn(sessionCache, 'saveSession').mockImplementation(async (...args) => {
      throw new Error('failure');
    });

    await importLegacyDataForWorkspace(workspacePath);

    // Sessions key NOT cleared.
    expect(storageService.__store.has(sessionsKey)).toBe(true);

    spy.mockRestore();
    void realSave;
  });

  it('global-import partial failure: all four global keys remain, globalsClaimed not set', async () => {
    storageService.__store.set('agents', [
      makeLegacyAgent({ id: 'g1', name: 'Global', kind: 'chat' }),
    ]);
    storageService.__store.set('repos', [
      makeLegacyRepo({ id: 'gr1', name: 'GR', url: 'https://x/y.git' }),
    ]);

    const realSave = repoFileStore.saveRepo;
    const spy = vi.spyOn(repoFileStore, 'saveRepo').mockImplementation(async (...args) => {
      throw new Error('repo write failed');
    });

    await importLegacyDataForWorkspace(workspacePath);

    // Globals still present.
    expect(storageService.__store.has('agents')).toBe(true);
    expect(storageService.__store.has('repos')).toBe(true);

    // globalsClaimed not set.
    const stateRaw = await nodeFs.readFile(nodePath.join(tmpRoot, '.quipu', 'import-state.json'), 'utf8');
    const state = JSON.parse(stateRaw);
    expect(state.globalsClaimed).toBeUndefined();

    spy.mockRestore();
    void realSave;
  });
});

describe('importLegacyDataForWorkspace — backup', () => {
  it('writes a backup file on the first call when there is data', async () => {
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'A1', kind: 'chat' }),
    ]);

    await importLegacyDataForWorkspace(workspacePath);

    const backupsDir = nodePath.join(tmpRoot, '.quipu', 'legacy-backups');
    const entries = await nodeFs.readdir(backupsDir);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const backupName = entries.find((n) => n.startsWith('quipu-state.pre-import.'));
    expect(backupName).toBeTruthy();
  });

  it('skips backup when legacy storage is empty', async () => {
    await importLegacyDataForWorkspace(workspacePath);

    const backupsDir = nodePath.join(tmpRoot, '.quipu', 'legacy-backups');
    let exists = true;
    try {
      await nodeFs.stat(backupsDir);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('does NOT re-backup on a second invocation (different workspace) within the same process', async () => {
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'A1', kind: 'chat' }),
    ]);

    await importLegacyDataForWorkspace(workspacePath);
    const backupsDir = nodePath.join(tmpRoot, '.quipu', 'legacy-backups');
    const firstEntries = await nodeFs.readdir(backupsDir);
    expect(firstEntries.length).toBe(1);

    // Second workspace import — should NOT add a new backup.
    const wp2 = nodePath.join(tmpRoot, 'wp2');
    await nodeFs.mkdir(wp2, { recursive: true });
    storageService.__store.set(`agents:${wp2}`, [
      makeLegacyAgent({ id: 'u2', name: 'A2', kind: 'chat' }),
    ]);
    await importLegacyDataForWorkspace(wp2);

    const secondEntries = await nodeFs.readdir(backupsDir);
    expect(secondEntries.length).toBe(1);
    expect(secondEntries[0]).toBe(firstEntries[0]);
  });
});

describe('importLegacyDataForWorkspace — concurrency', () => {
  it('concurrent invocations for the same workspace share a single in-flight promise', async () => {
    storageService.__store.set(`agents:${workspacePath}`, [
      makeLegacyAgent({ id: 'u1', name: 'A1', kind: 'chat' }),
      makeLegacyAgent({ id: 'u2', name: 'A2', kind: 'chat' }),
    ]);

    storageService.get.mockClear();

    const [r1, r2] = await Promise.all([
      importLegacyDataForWorkspace(workspacePath),
      importLegacyDataForWorkspace(workspacePath),
    ]);

    // Both calls return the same result.
    expect(r1).toEqual(r2);

    // Only one set of storage.get calls — concurrency is collapsed
    // through the in-flight promise. A single import reads 8 keys
    // for the backup snapshot + 8 keys during the import steps = 16.
    // If both invocations had separately run the full pipeline, we'd
    // see 2x that. The threshold here catches a regression where the
    // re-entry cache breaks.
    const getCalls = storageService.get.mock.calls.length;
    expect(getCalls).toBeLessThanOrEqual(16);

    // The agents only got imported once (no duplicates from a double-run).
    const loaded = await agentFileStore.loadAllAgents(workspacePath);
    expect(loaded.map((a) => a.name).sort()).toEqual(['A1', 'A2']);
  });
});
