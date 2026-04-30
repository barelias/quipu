/**
 * Tests for `sessionCache`.
 *
 * Strategy: same pattern as Units 2-4 — mock `../services/fileSystem`
 * with a node:fs/promises-backed fake against a tmp directory. The
 * fake's `getHomeDir` returns our tmp root so all `~/.quipu/...` paths
 * land inside the test's sandbox.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import type { AgentSession } from '@/types/agent';

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
// sessionCache binds to our fake. The cache is module-scoped, but each
// test uses a unique fake `homeDir` — see resetModules() in beforeEach.
let workspaceHash: typeof import('../services/sessionCache').workspaceHash;
let loadSession: typeof import('../services/sessionCache').loadSession;
let saveSession: typeof import('../services/sessionCache').saveSession;
let deleteSession: typeof import('../services/sessionCache').deleteSession;
let renameSession: typeof import('../services/sessionCache').renameSession;

let tmpRoot = '';

/** Fixture builder: minimal AgentSession with sensible defaults. */
function makeSession(overrides: Partial<AgentSession> & Pick<AgentSession, 'agentId'>): AgentSession {
  return {
    agentId: overrides.agentId,
    claudeSessionId: overrides.claudeSessionId,
    messages: overrides.messages ?? [
      {
        id: 'msg-1',
        role: 'user',
        body: 'hello',
        createdAt: '2026-04-30T10:00:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        body: 'hi there',
        createdAt: '2026-04-30T10:00:01.000Z',
      },
    ],
    updatedAt: overrides.updatedAt ?? '2026-04-30T10:00:01.000Z',
  };
}

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-session-cache-'));
  homeDirRef.value = tmpRoot;
  // Reset module state between tests so the in-process workspaceHash
  // cache and homeDir promise don't leak across tests.
  vi.resetModules();
  const mod = await import('../services/sessionCache');
  workspaceHash = mod.workspaceHash;
  loadSession = mod.loadSession;
  saveSession = mod.saveSession;
  deleteSession = mod.deleteSession;
  renameSession = mod.renameSession;
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('workspaceHash', () => {
  it('returns a stable 12-character hex string', async () => {
    const hash = await workspaceHash('/some/workspace');
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input across calls (uses cache)', async () => {
    const a = await workspaceHash('/some/workspace');
    const b = await workspaceHash('/some/workspace');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await workspaceHash('/foo');
    const b = await workspaceHash('/bar');
    expect(a).not.toBe(b);
  });
});

describe('saveSession + loadSession happy path', () => {
  it('writes a session and reads it back deeply equal', async () => {
    const ws = '/path/to/workspace';
    const session = makeSession({ agentId: 'frame-responder', claudeSessionId: 'claude-abc' });
    await saveSession(ws, 'frame-responder', session);

    const loaded = await loadSession(ws, 'frame-responder');
    expect(loaded).toEqual(session);
  });

  it('writes the session at <home>/.quipu/sessions-cache/<hash>/<agentId>.json', async () => {
    const ws = '/some/workspace';
    const hash = await workspaceHash(ws);
    const session = makeSession({ agentId: 'foo' });

    await saveSession(ws, 'foo', session);

    const expected = nodePath.join(tmpRoot, '.quipu', 'sessions-cache', hash, 'foo.json');
    const stat = await nodeFs.stat(expected);
    expect(stat.isFile()).toBe(true);
  });
});

describe('cross-workspace isolation', () => {
  it('same agent id in two different workspaces produces two different cache files', async () => {
    const wsFoo = '/foo';
    const wsBar = '/bar';
    const sessionFoo = makeSession({ agentId: 'shared', claudeSessionId: 'in-foo' });
    const sessionBar = makeSession({ agentId: 'shared', claudeSessionId: 'in-bar' });

    await saveSession(wsFoo, 'shared', sessionFoo);
    await saveSession(wsBar, 'shared', sessionBar);

    const loadedFoo = await loadSession(wsFoo, 'shared');
    const loadedBar = await loadSession(wsBar, 'shared');

    expect(loadedFoo?.claudeSessionId).toBe('in-foo');
    expect(loadedBar?.claudeSessionId).toBe('in-bar');

    // Verify two distinct directories exist on disk.
    const hashFoo = await workspaceHash(wsFoo);
    const hashBar = await workspaceHash(wsBar);
    expect(hashFoo).not.toBe(hashBar);

    const fooFile = nodePath.join(tmpRoot, '.quipu', 'sessions-cache', hashFoo, 'shared.json');
    const barFile = nodePath.join(tmpRoot, '.quipu', 'sessions-cache', hashBar, 'shared.json');
    await expect(nodeFs.stat(fooFile)).resolves.toBeTruthy();
    await expect(nodeFs.stat(barFile)).resolves.toBeTruthy();
  });
});

describe('nested agent ids', () => {
  it('writes a nested agent id to the expected nested directory under the workspace hash', async () => {
    const ws = '/some/workspace';
    const agentId = 'research/web-scraping/foo';
    const session = makeSession({ agentId });

    await saveSession(ws, agentId, session);

    const hash = await workspaceHash(ws);
    const expected = nodePath.join(
      tmpRoot,
      '.quipu',
      'sessions-cache',
      hash,
      'research',
      'web-scraping',
      'foo.json',
    );
    const stat = await nodeFs.stat(expected);
    expect(stat.isFile()).toBe(true);

    const loaded = await loadSession(ws, agentId);
    expect(loaded).toEqual(session);
  });
});

describe('loadSession edge cases', () => {
  it('returns null for a non-existent session', async () => {
    const result = await loadSession('/no/such/workspace', 'no-such-agent');
    expect(result).toBeNull();
  });
});

describe('deleteSession', () => {
  it('removes the session file', async () => {
    const ws = '/ws';
    const session = makeSession({ agentId: 'goner' });
    await saveSession(ws, 'goner', session);

    await deleteSession(ws, 'goner');

    const loaded = await loadSession(ws, 'goner');
    expect(loaded).toBeNull();
  });

  it('is a no-op when the session file does not exist', async () => {
    await expect(deleteSession('/never-saved', 'never-existed')).resolves.toBeUndefined();
  });
});

describe('renameSession', () => {
  it('moves the session from oldAgentId to newAgentId', async () => {
    const ws = '/ws';
    const original = makeSession({ agentId: 'old-slug', claudeSessionId: 'preserved' });
    await saveSession(ws, 'old-slug', original);

    await renameSession(ws, 'old-slug', 'new-slug');

    const oldAfter = await loadSession(ws, 'old-slug');
    const newAfter = await loadSession(ws, 'new-slug');

    expect(oldAfter).toBeNull();
    expect(newAfter).not.toBeNull();
    expect(newAfter?.claudeSessionId).toBe('preserved');
    expect(newAfter?.messages).toEqual(original.messages);
  });

  it('moves a session into a different folder', async () => {
    const ws = '/ws';
    const original = makeSession({ agentId: 'foo' });
    await saveSession(ws, 'foo', original);

    await renameSession(ws, 'foo', 'research/foo');

    const oldAfter = await loadSession(ws, 'foo');
    const newAfter = await loadSession(ws, 'research/foo');
    expect(oldAfter).toBeNull();
    expect(newAfter).not.toBeNull();
  });

  it('is a no-op when the source session does not exist', async () => {
    await expect(renameSession('/ws', 'missing', 'whatever')).resolves.toBeUndefined();
    const after = await loadSession('/ws', 'whatever');
    expect(after).toBeNull();
  });
});

describe('manifest', () => {
  it('writes a manifest.json mapping hash -> workspace path on saveSession', async () => {
    const ws = '/path/to/the/workspace';
    const session = makeSession({ agentId: 'agent-x' });
    await saveSession(ws, 'agent-x', session);

    const hash = await workspaceHash(ws);
    const manifestPath = nodePath.join(
      tmpRoot,
      '.quipu',
      'sessions-cache',
      hash,
      'manifest.json',
    );
    const raw = await nodeFs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ [hash]: ws });
  });
});
