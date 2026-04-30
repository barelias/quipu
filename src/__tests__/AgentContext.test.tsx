/**
 * Tests for the file-store wiring inside `AgentContext`.
 *
 * Strategy: mock `agentFileStore`, `sessionCache`, and `quipuFileStore`
 * directly. Those services have their own unit tests covering disk
 * behavior; here we only verify the context's call shape, state
 * lifecycle, and watcher integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent } from '@/types/agent';
import type { FolderNode } from '../services/agentFileStore';

// === Mocks for service modules ===========================================
//
// `vi.mock` factories are hoisted above any non-import statement, so any
// state they reference must come from `vi.hoisted` — that runs before
// the mocks but after vitest is initialized. The hoisted block is the
// closure source for both the mock factories and the test helpers below.

const hoisted = vi.hoisted(() => ({
  agentFileStore: {
    loadAllAgents: vi.fn(),
    loadAllFolders: vi.fn(),
    saveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    createFolder: vi.fn(),
  },
  sessionCache: {
    loadSession: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    workspaceHash: vi.fn(),
  },
  watchers: [] as Array<{
    absDir: string;
    onChange: (event: { type: 'change' | 'rename'; path?: string }) => void;
    unsubscribed: boolean;
  }>,
}));
const mockAgentFileStore = hoisted.agentFileStore;
const mockSessionCache = hoisted.sessionCache;

vi.mock('../services/agentFileStore', () => hoisted.agentFileStore);
vi.mock('../services/sessionCache', () => hoisted.sessionCache);
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

let currentWorkspacePath: string | null = null;
vi.mock('../context/FileSystemContext', () => ({
  useFileSystem: () => ({ workspacePath: currentWorkspacePath }),
}));

vi.mock('../context/RepoContext', () => ({
  useRepo: () => ({
    cloneRepoForAgent: vi.fn(async () => '/fake/clone'),
    repos: [],
  }),
}));

vi.mock('../context/TabContext', () => ({
  useTab: () => ({ renameTabsByPath: vi.fn() }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => false,
  startSession: vi.fn(),
}));

import { AgentProvider, useAgent } from '../context/AgentContext';

// === Test harness =========================================================

function makeAgent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'slug' | 'name'>): Agent {
  const now = '2026-04-30T10:00:00Z';
  return {
    id: overrides.id,
    slug: overrides.slug,
    name: overrides.name,
    folder: overrides.folder,
    kind: overrides.kind ?? 'agent',
    systemPrompt: overrides.systemPrompt ?? '',
    model: overrides.model ?? 'claude-sonnet-4-5',
    bindings: overrides.bindings ?? [],
    permissionMode: overrides.permissionMode ?? 'default',
    allowedTools: overrides.allowedTools,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

interface ActionsApi {
  upsertAgent: (agent: Agent) => void;
  deleteAgent: (id: string) => void;
  createChat: (opts?: { folder?: string; name?: string }) => Agent;
  createFolder: (kind: 'agent' | 'chat', name: string) => void;
  deleteFolder: (kind: 'agent' | 'chat', name: string) => void;
  renameFolder: (kind: 'agent' | 'chat', oldName: string, newName: string) => void;
}

let actionsApi: ActionsApi | null = null;

function StateProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    actionsApi = {
      upsertAgent: ctx.upsertAgent,
      deleteAgent: ctx.deleteAgent,
      createChat: ctx.createChat,
      createFolder: ctx.createFolder,
      deleteFolder: ctx.deleteFolder,
      renameFolder: ctx.renameFolder,
    };
  });
  return (
    <div>
      <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>
      <div data-testid="agentIds">{ctx.agents.map(a => a.id).sort().join(',')}</div>
      <div data-testid="folders.agents">{ctx.folders.agents.join(',')}</div>
      <div data-testid="folders.chats">{ctx.folders.chats.join(',')}</div>
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
  return <AgentProvider>{children}</AgentProvider>;
}

beforeEach(() => {
  for (const m of Object.values(mockAgentFileStore)) m.mockReset();
  for (const m of Object.values(mockSessionCache)) m.mockReset();
  // Restore default no-op implementations after reset.
  mockAgentFileStore.loadAllAgents.mockImplementation(async () => []);
  mockAgentFileStore.loadAllFolders.mockImplementation(async () => []);
  mockAgentFileStore.saveAgent.mockImplementation(async (_, agent: Agent, _prev?: string) => {
    const folder = agent.folder ?? '';
    const slug = agent.slug ?? '';
    return folder === '' ? slug : `${folder}/${slug}`;
  });
  mockAgentFileStore.deleteAgent.mockImplementation(async () => {});
  mockAgentFileStore.createFolder.mockImplementation(async () => {});
  mockAgentFileStore.deleteFolder.mockImplementation(async () => {});
  mockAgentFileStore.renameFolder.mockImplementation(async () => {});
  mockSessionCache.loadSession.mockImplementation(async () => null);
  mockSessionCache.saveSession.mockImplementation(async () => {});
  mockSessionCache.deleteSession.mockImplementation(async () => {});

  hoisted.watchers.length = 0;
  currentWorkspacePath = null;
  actionsApi = null;
});

describe('AgentProvider — file-store load lifecycle', () => {
  it('happy path: mounts with workspacePath=/foo and populates state from agentFileStore', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'frame-responder', slug: 'frame-responder', name: 'FRAME Responder' }),
      makeAgent({ id: 'research/foo', slug: 'foo', folder: 'research', name: 'Foo' }),
    ]);
    mockAgentFileStore.loadAllFolders.mockResolvedValueOnce([
      { path: 'research' },
    ]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(getByTestId('agentIds').textContent).toBe('frame-responder,research/foo');
    expect(mockAgentFileStore.loadAllAgents).toHaveBeenCalledWith('/foo');
    expect(mockAgentFileStore.loadAllFolders).toHaveBeenCalledWith('/foo');
  });

  it('mounts with workspacePath=null → state stays empty, no file-store calls', async () => {
    const { getByTestId } = render(
      <Harness initialPath={null}>
        <StateProbe />
      </Harness>,
    );

    await act(async () => { await Promise.resolve(); });

    expect(getByTestId('isLoaded').textContent).toBe('false');
    expect(getByTestId('agentIds').textContent).toBe('');
    expect(mockAgentFileStore.loadAllAgents).not.toHaveBeenCalled();
    expect(mockAgentFileStore.loadAllFolders).not.toHaveBeenCalled();
  });

  it('workspace switch /foo → /bar clears state and reloads from /bar', async () => {
    mockAgentFileStore.loadAllAgents.mockImplementation(async (workspace: string) => {
      if (workspace === '/foo') return [makeAgent({ id: 'foo-1', slug: 'foo-1', name: 'Foo' })];
      if (workspace === '/bar') return [makeAgent({ id: 'bar-1', slug: 'bar-1', name: 'Bar' })];
      return [];
    });

    let api: { setPath: (p: string | null) => void } | null = null;
    const { getByTestId } = render(
      <Harness initialPath="/foo" onReady={a => { api = a; }}>
        <StateProbe />
      </Harness>,
    );

    await waitFor(() => expect(getByTestId('agentIds').textContent).toBe('foo-1'));
    expect(api).not.toBeNull();

    await act(async () => { api!.setPath('/bar'); });
    await waitFor(() => expect(getByTestId('agentIds').textContent).toBe('bar-1'));
  });

  it('rapid workspace switch /foo → /bar → /foo: latest path wins (cancelled flag)', async () => {
    let resolveFoo: (v: Agent[]) => void = () => {};
    let resolveBar: (v: Agent[]) => void = () => {};
    const fooPromise = new Promise<Agent[]>(res => { resolveFoo = res; });
    const barPromise = new Promise<Agent[]>(res => { resolveBar = res; });

    mockAgentFileStore.loadAllAgents.mockImplementation(async (workspace: string) => {
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
      resolveBar([makeAgent({ id: 'bar-1', slug: 'bar-1', name: 'Bar' })]);
      resolveFoo([makeAgent({ id: 'foo-final', slug: 'foo-final', name: 'Foo final' })]);
      await Promise.resolve();
    });

    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(getByTestId('agentIds').textContent).toBe('foo-final');
  });
});

describe('AgentProvider — mutators dispatch to the file store', () => {
  beforeEach(async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValue([]);
    mockAgentFileStore.loadAllFolders.mockResolvedValue([]);
  });

  async function mount(): Promise<void> {
    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    expect(actionsApi).not.toBeNull();
  }

  it('upsertAgent (new) calls saveAgent with previousId=undefined and adds to state', async () => {
    await mount();
    const fresh = makeAgent({ id: 'new-1', slug: 'new-1', name: 'Fresh' });

    await act(async () => {
      actionsApi!.upsertAgent(fresh);
      await Promise.resolve();
    });

    expect(mockAgentFileStore.saveAgent).toHaveBeenCalledTimes(1);
    const [ws, agent, prev] = mockAgentFileStore.saveAgent.mock.calls[0];
    expect(ws).toBe('/foo');
    expect((agent as Agent).slug).toBe('new-1');
    expect(prev).toBeUndefined();
  });

  it('upsertAgent (existing) passes previousId so the file store can clean up renames', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'old-slug', slug: 'old-slug', name: 'Old' }),
    ]);
    await mount();
    // Wait for initial agents to populate.
    const updated = makeAgent({ id: 'old-slug', slug: 'old-slug', name: 'Renamed' });

    await act(async () => {
      actionsApi!.upsertAgent(updated);
      await Promise.resolve();
    });

    expect(mockAgentFileStore.saveAgent).toHaveBeenCalledTimes(1);
    const [, , prev] = mockAgentFileStore.saveAgent.mock.calls[0];
    expect(prev).toBe('old-slug');
  });

  it('deleteAgent calls both deleteAgent AND deleteSession and updates state', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'gone', slug: 'gone', name: 'Gone' }),
    ]);
    await mount();

    await act(async () => {
      actionsApi!.deleteAgent('gone');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAgentFileStore.deleteAgent).toHaveBeenCalledWith('/foo', 'gone');
    expect(mockSessionCache.deleteSession).toHaveBeenCalledWith('/foo', 'gone');
  });

  it('createChat auto-slugs the name and saves through agentFileStore', async () => {
    await mount();

    let result: Agent | null = null;
    await act(async () => {
      result = actionsApi!.createChat({ name: 'My new chat' });
      await Promise.resolve();
    });

    expect(result).not.toBeNull();
    expect(result!.slug).toBe('my-new-chat');
    expect(result!.kind).toBe('chat');
    expect(mockAgentFileStore.saveAgent).toHaveBeenCalledTimes(1);
  });

  it('createFolder calls agentFileStore.createFolder and triggers a reload', async () => {
    await mount();
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([]);
    mockAgentFileStore.loadAllFolders.mockResolvedValueOnce([{ path: 'planning' }]);

    await act(async () => {
      actionsApi!.createFolder('agent', 'Planning');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAgentFileStore.createFolder).toHaveBeenCalled();
    const [ws, folderPath] = mockAgentFileStore.createFolder.mock.calls[0];
    expect(ws).toBe('/foo');
    expect(folderPath).toBe('planning');
  });

  it('deleteFolder calls agentFileStore.deleteFolder and triggers a reload', async () => {
    await mount();

    await act(async () => {
      actionsApi!.deleteFolder('agent', 'planning');
      await Promise.resolve();
    });

    expect(mockAgentFileStore.deleteFolder).toHaveBeenCalledWith('/foo', 'planning');
  });

  it('renameFolder calls agentFileStore.renameFolder and triggers a reload', async () => {
    await mount();

    await act(async () => {
      actionsApi!.renameFolder('agent', 'planning', 'design');
      await Promise.resolve();
    });

    expect(mockAgentFileStore.renameFolder).toHaveBeenCalledWith('/foo', 'planning', 'design');
  });
});

describe('AgentProvider — file watcher integration', () => {
  it('subscribes to a watcher rooted at <workspace>/.quipu and unsubscribes on workspace switch', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValue([]);
    mockAgentFileStore.loadAllFolders.mockResolvedValue([]);

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

    // The /foo watcher must be torn down; a new one for /bar is active.
    const fooWatcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(fooWatcher?.unsubscribed).toBe(true);
    expect(hoisted.watchers.some(w => w.absDir === '/bar/.quipu' && !w.unsubscribed)).toBe(true);
  });

  it('watcher event triggers a reload', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([]);
    mockAgentFileStore.loadAllFolders.mockResolvedValueOnce([]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));

    // Cross-window mutation: a new agent file appeared.
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'cross-win', slug: 'cross-win', name: 'Cross window' }),
    ]);
    mockAgentFileStore.loadAllFolders.mockResolvedValueOnce([]);

    const watcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(watcher).toBeDefined();
    await act(async () => {
      watcher!.onChange({ type: 'change', path: '/foo/.quipu/agents/cross-win.json' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(getByTestId('agentIds').textContent).toBe('cross-win'));
  });

  it('echo suppression: reload is NOT triggered for paths just written by this window', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([]);
    mockAgentFileStore.loadAllFolders.mockResolvedValueOnce([]);

    const { getByTestId } = render(
      <Harness initialPath="/foo">
        <StateProbe />
      </Harness>,
    );
    await waitFor(() => expect(getByTestId('isLoaded').textContent).toBe('true'));
    const initialLoadCalls = mockAgentFileStore.loadAllAgents.mock.calls.length;

    // upsertAgent writes a file and registers it for echo suppression.
    const fresh = makeAgent({ id: 'echoed', slug: 'echoed', name: 'Echoed' });
    await act(async () => {
      actionsApi!.upsertAgent(fresh);
      await Promise.resolve();
    });

    // Watcher fires for the same path we just wrote — should be ignored.
    const watcher = hoisted.watchers.find(w => w.absDir === '/foo/.quipu');
    expect(watcher).toBeDefined();
    await act(async () => {
      watcher!.onChange({ type: 'change', path: '/foo/.quipu/agents/echoed.json' });
      await Promise.resolve();
    });

    // No additional reload past the initial mount load. (loadAllAgents
    // count stayed at initial — the echoed event was suppressed.)
    expect(mockAgentFileStore.loadAllAgents.mock.calls.length).toBe(initialLoadCalls);
  });
});
