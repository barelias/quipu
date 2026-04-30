/**
 * resumeSession tests — the public API didn't change, but the seeding
 * path did: persisted session transcripts now come from `sessionCache`
 * rather than the storage-keys layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent, AgentSession } from '@/types/agent';

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
}));
const mockAgentFileStore = hoisted.agentFileStore;
const mockSessionCache = hoisted.sessionCache;

vi.mock('../services/agentFileStore', () => hoisted.agentFileStore);
vi.mock('../services/sessionCache', () => hoisted.sessionCache);
vi.mock('../services/quipuFileStore', () => ({
  watchDirRecursive: () => () => {},
}));

let currentWorkspacePath: string | null = '/foo';
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

let runtimeIsElectron = true;
const startSessionMock = vi.fn();
vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => runtimeIsElectron,
  startSession: (...args: unknown[]) => startSessionMock(...args),
}));

import { AgentProvider, useAgent } from '../context/AgentContext';

interface ResumeApi {
  resumeSession: (id: string) => Promise<void>;
  getSessionMessages: (id: string) => Array<{ role: string; body: string }>;
}

let api: ResumeApi | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      resumeSession: ctx.resumeSession,
      getSessionMessages: (id: string) => {
        const s = ctx.getSession(id);
        return (s?.messages ?? []).map(m => ({ role: m.role, body: m.body }));
      },
    };
  });
  return <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>;
}

function Harness({ initialPath = '/foo' as string | null, children }: {
  initialPath?: string | null;
  children: React.ReactNode;
}) {
  const [path] = useState<string | null>(initialPath);
  currentWorkspacePath = path;
  return <AgentProvider>{children}</AgentProvider>;
}

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  const now = new Date().toISOString();
  return {
    id,
    slug: id,
    name: id,
    kind: 'agent',
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    bindings: [],
    permissionMode: 'default',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeHandle() {
  return {
    sessionKey: 'fake-session',
    sendUserMessage: vi.fn(),
    respondToPermission: vi.fn(),
    stop: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  for (const m of Object.values(mockAgentFileStore)) m.mockReset();
  for (const m of Object.values(mockSessionCache)) m.mockReset();
  mockAgentFileStore.loadAllAgents.mockResolvedValue([]);
  mockAgentFileStore.loadAllFolders.mockResolvedValue([]);
  mockAgentFileStore.saveAgent.mockResolvedValue('');
  mockSessionCache.loadSession.mockResolvedValue(null);
  api = null;
  currentWorkspacePath = '/foo';
  runtimeIsElectron = true;
  startSessionMock.mockReset();
  startSessionMock.mockImplementation(async () => makeFakeHandle());
});

async function renderWith(seededAgents: Agent[], sessionByAgent: Record<string, AgentSession> = {}) {
  mockAgentFileStore.loadAllAgents.mockResolvedValue(seededAgents);
  mockSessionCache.loadSession.mockImplementation(async (_w: string, id: string) => sessionByAgent[id] ?? null);

  const result = render(
    <Harness initialPath="/foo">
      <ApiProbe />
    </Harness>,
  );
  await waitFor(() => {
    expect(result.getByTestId('isLoaded').textContent).toBe('true');
  });
  // Flush the post-render `sessionsRef = sessions` sync effect so the
  // first resumeSession reads the freshly-loaded transcript.
  await act(async () => { await Promise.resolve(); });
  expect(api).not.toBeNull();
  return result;
}

describe('AgentContext.resumeSession', () => {
  it('happy path: agent has stored claudeSessionId from sessionCache → startSession called with resumeSessionId', async () => {
    await renderWith(
      [makeAgent('a1')],
      { 'a1': { agentId: 'a1', messages: [], updatedAt: '2026-01-01T00:00:00Z', claudeSessionId: 'claude-abc' } },
    );

    await act(async () => { await api!.resumeSession('a1'); });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const [agentIdArg, opts] = startSessionMock.mock.calls[0];
    expect(agentIdArg).toBe('a1');
    expect((opts as { resumeSessionId?: string }).resumeSessionId).toBe('claude-abc');
  });

  it('happy path: agent has no stored session → startSession called with resumeSessionId === undefined', async () => {
    await renderWith([makeAgent('fresh')]);

    await act(async () => { await api!.resumeSession('fresh'); });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const [, opts] = startSessionMock.mock.calls[0];
    expect((opts as { resumeSessionId?: string }).resumeSessionId).toBeUndefined();
  });

  it('runtimeAvailable === false (browser mode) → no-op, startSession not called', async () => {
    runtimeIsElectron = false;
    await renderWith([makeAgent('browser-agent')]);

    await act(async () => { await api!.resumeSession('browser-agent'); });

    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it('agent does not exist → no crash, no spawned process', async () => {
    await renderWith([makeAgent('exists')]);

    await act(async () => { await api!.resumeSession('does-not-exist'); });

    expect(startSessionMock).not.toHaveBeenCalled();
    expect(api!.getSessionMessages('does-not-exist')).toEqual([]);
  });

  it('sequential rapid resumeSession calls for the same agent → only one subprocess spawns', async () => {
    await renderWith([makeAgent('cached')]);

    await act(async () => { await api!.resumeSession('cached'); });
    await act(async () => { await api!.resumeSession('cached'); });
    await act(async () => { await api!.resumeSession('cached'); });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
  });

  it('error path: startSession throws → an error message is appended to the agent session', async () => {
    startSessionMock.mockImplementationOnce(async () => {
      throw new Error('spawn failed: no claude binary');
    });

    await renderWith([makeAgent('boom')]);

    await act(async () => { await api!.resumeSession('boom'); });

    const messages = api!.getSessionMessages('boom');
    expect(messages.some(m => m.role === 'error' && m.body.includes('spawn failed'))).toBe(true);
  });

  it('error path: startSession throws non-Error → string message still surfaces', async () => {
    startSessionMock.mockImplementationOnce(async () => {
      throw 'plain string failure';
    });

    await renderWith([makeAgent('strerr')]);

    await act(async () => { await api!.resumeSession('strerr'); });

    const messages = api!.getSessionMessages('strerr');
    expect(messages.some(m => m.role === 'error' && m.body === 'plain string failure')).toBe(true);
  });
});
