/**
 * respondToPermission tests — the public API didn't change. The persisted
 * pending request now arrives via `sessionCache.loadSession` (instead of
 * the old workspace-scoped storage key).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent, AgentMessage, AgentPermissionRequest, AgentSession } from '@/types/agent';

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

const showToast = vi.fn();
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

const respondToPermissionSpy = vi.fn();
const startSessionSpy = vi.fn(async () => ({
  sessionKey: 'sk-1',
  sendUserMessage: vi.fn(),
  respondToPermission: respondToPermissionSpy,
  stop: vi.fn(async () => {}),
}));
vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => true,
  startSession: () => startSessionSpy(),
}));

import { AgentProvider, useAgent } from '../context/AgentContext';

interface ApiHandle {
  respondToPermission: ReturnType<typeof useAgent>['respondToPermission'];
  resumeSession: ReturnType<typeof useAgent>['resumeSession'];
  upsertAgent: ReturnType<typeof useAgent>['upsertAgent'];
}

let api: ApiHandle | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      respondToPermission: ctx.respondToPermission,
      resumeSession: ctx.resumeSession,
      upsertAgent: ctx.upsertAgent,
    };
  });
  return <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>;
}

function Harness({ children }: { children: React.ReactNode }) {
  const [path] = useState<string | null>('/foo');
  currentWorkspacePath = path;
  return <AgentProvider>{children}</AgentProvider>;
}

const AGENT_ID = 'agent-1';
const MESSAGE_ID = 'msg-1';

function seedAgentAndPendingRequest() {
  const agent: Agent = {
    id: AGENT_ID,
    slug: AGENT_ID,
    name: 'Test agent',
    kind: 'agent',
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    bindings: [],
    permissionMode: 'default',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  mockAgentFileStore.loadAllAgents.mockResolvedValue([agent]);

  const pendingReq: AgentPermissionRequest = {
    toolUseId: 'tu-1',
    toolName: 'AskUserQuestion',
    action: 'AskUserQuestion',
    input: { questions: [{ question: 'Q', options: [{ label: 'A' }] }] },
    status: 'pending',
  };
  const msg: AgentMessage = {
    id: MESSAGE_ID,
    role: 'permission-request',
    body: '',
    createdAt: '2026-01-01T00:00:00Z',
    permissionRequest: pendingReq,
  };
  mockSessionCache.loadSession.mockImplementation(async (_w: string, id: string) => {
    if (id !== AGENT_ID) return null;
    return {
      agentId: AGENT_ID,
      messages: [msg],
      updatedAt: '2026-01-01T00:00:00Z',
    };
  });
}

async function renderAndWaitLoaded() {
  const renderResult = render(
    <Harness>
      <ApiProbe />
    </Harness>,
  );
  await waitFor(() => {
    expect(renderResult.getByTestId('isLoaded').textContent).toBe('true');
  });
  // Flush any remaining post-render effects (in particular the
  // `sessionsRef.current = sessions` sync effect — without this, the
  // ref could lag a microtask behind the rendered state on the
  // `isLoaded=true` commit, intermittently causing
  // respondToPermission to read a stale empty sessions ref).
  await act(async () => { await Promise.resolve(); });
  // Warm up the Claude session handle so respondToPermission can forward.
  await act(async () => {
    await api!.resumeSession(AGENT_ID);
  });
  return renderResult;
}

beforeEach(() => {
  for (const m of Object.values(mockAgentFileStore)) m.mockReset();
  for (const m of Object.values(mockSessionCache)) m.mockReset();
  mockAgentFileStore.loadAllAgents.mockResolvedValue([]);
  mockAgentFileStore.loadAllFolders.mockResolvedValue([]);
  mockAgentFileStore.saveAgent.mockResolvedValue('');
  mockSessionCache.loadSession.mockResolvedValue(null);
  respondToPermissionSpy.mockClear();
  startSessionSpy.mockClear();
  showToast.mockClear();
  currentWorkspacePath = '/foo';
  api = null;
});

describe('AgentContext.respondToPermission — extended opts', () => {
  it('forwards { message } to the runtime handle on deny', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();
    expect(startSessionSpy).toHaveBeenCalled();

    const payload = JSON.stringify({ answers: [{ question: 'Q', answer: 'A' }] });
    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: payload });
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'deny', { message: payload });
  });

  it('forwards { updatedInput } to the runtime handle on allow', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'allow', { updatedInput: { foo: 'bar' } });
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'allow', { updatedInput: { foo: 'bar' } });
  });

  it('omits opts entirely when caller does not pass them (legacy behavior preserved)', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'allow');
    });

    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(respondToPermissionSpy).toHaveBeenCalledWith('tu-1', 'allow', undefined);
  });

  it('does nothing when the request is no longer pending (idempotent on double-click)', async () => {
    seedAgentAndPendingRequest();
    await renderAndWaitLoaded();

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: 'x' });
    });
    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      api!.respondToPermission(AGENT_ID, MESSAGE_ID, 'deny', { message: 'y' });
    });
    expect(respondToPermissionSpy).toHaveBeenCalledTimes(1);
  });
});
