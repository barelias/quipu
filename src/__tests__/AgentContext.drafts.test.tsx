/**
 * Drafts test — the in-memory draft API is unchanged by the file-store
 * refactor (drafts intentionally never persist), but it still has to run
 * against the new AgentProvider with its new mock surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent, AgentImageAttachment } from '@/types/agent';

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

vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => false,
  startSession: vi.fn(),
}));

import { AgentProvider, useAgent, type AgentDraft } from '../context/AgentContext';

interface DraftsApi {
  getDraft: (id: string) => AgentDraft;
  setDraft: (id: string, patch: Partial<AgentDraft>) => void;
  upsertAgent: (id: string) => void;
  deleteAgent: (id: string) => void;
}

let api: DraftsApi | null = null;

function ApiProbe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      getDraft: ctx.getDraft,
      setDraft: ctx.setDraft,
      upsertAgent: (id: string) => ctx.upsertAgent({
        id,
        slug: id,
        name: id,
        kind: 'agent',
        systemPrompt: '',
        model: 'claude-sonnet-4-5',
        bindings: [],
        permissionMode: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Agent),
      deleteAgent: (id: string) => ctx.deleteAgent(id),
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

const img = (id: string): AgentImageAttachment => ({
  id,
  mediaType: 'image/png',
  base64: 'AAAA',
  name: `${id}.png`,
});

beforeEach(() => {
  for (const m of Object.values(mockAgentFileStore)) m.mockReset();
  for (const m of Object.values(mockSessionCache)) m.mockReset();
  mockAgentFileStore.loadAllAgents.mockResolvedValue([]);
  mockAgentFileStore.loadAllFolders.mockResolvedValue([]);
  mockAgentFileStore.saveAgent.mockResolvedValue('');
  mockSessionCache.loadSession.mockResolvedValue(null);
  api = null;
  currentWorkspacePath = '/foo';
});

async function renderProvider() {
  const result = render(
    <Harness initialPath="/foo">
      <ApiProbe />
    </Harness>,
  );
  await waitFor(() => {
    expect(result.getByTestId('isLoaded').textContent).toBe('true');
  });
  expect(api).not.toBeNull();
  return result;
}

describe('AgentContext drafts', () => {
  it('returns the empty default for an unknown agent id', async () => {
    await renderProvider();
    const d = api!.getDraft('nope');
    expect(d.input).toBe('');
    expect(d.attachments).toEqual([]);
  });

  it('returns the SAME empty-default reference across calls (stable for memoization)', async () => {
    await renderProvider();
    const a = api!.getDraft('agent-x');
    const b = api!.getDraft('agent-y');
    expect(a).toBe(b);
  });

  it('happy path: setDraft on A then getDraft on A returns A; getDraft on B is empty', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'hello A' });
    });
    expect(api!.getDraft('A')).toEqual({ input: 'hello A', attachments: [] });
    expect(api!.getDraft('B')).toEqual({ input: '', attachments: [] });
  });

  it('preserves both agents independently when text is set on each', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'draft for A' });
      api!.setDraft('B', { input: 'draft for B' });
    });
    expect(api!.getDraft('A').input).toBe('draft for A');
    expect(api!.getDraft('B').input).toBe('draft for B');
  });

  it('merges patches: setting input then attachments preserves both', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'partial' });
      api!.setDraft('A', { attachments: [img('p1')] });
    });
    const d = api!.getDraft('A');
    expect(d.input).toBe('partial');
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0].id).toBe('p1');
  });

  it('clearing both fields removes the entry (returns the empty default)', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { input: 'something' });
    });
    expect(api!.getDraft('A').input).toBe('something');

    await act(async () => {
      api!.setDraft('A', { input: '', attachments: [] });
    });
    expect(api!.getDraft('A')).toBe(api!.getDraft('B'));
  });

  it('attachments only (no text): set, retrieve, clear, all behave', async () => {
    await renderProvider();
    await act(async () => {
      api!.setDraft('A', { attachments: [img('att-1'), img('att-2')] });
    });
    const d = api!.getDraft('A');
    expect(d.input).toBe('');
    expect(d.attachments.map(a => a.id)).toEqual(['att-1', 'att-2']);

    await act(async () => {
      api!.setDraft('A', { attachments: [] });
    });
    expect(api!.getDraft('A')).toBe(api!.getDraft('unknown'));
  });

  it('deleting an agent drops its draft entry', async () => {
    await renderProvider();
    await act(async () => {
      api!.upsertAgent('A');
      api!.setDraft('A', { input: 'about to be deleted' });
    });
    expect(api!.getDraft('A').input).toBe('about to be deleted');

    await act(async () => {
      api!.deleteAgent('A');
    });
    expect(api!.getDraft('A')).toBe(api!.getDraft('unknown'));
  });

  it('integration: simulated tab-switch flow — type in A, switch to B, switch back to A', async () => {
    await renderProvider();
    let aSeed = api!.getDraft('A');
    expect(aSeed.input).toBe('');

    await act(async () => {
      api!.setDraft('A', { input: 'hello' });
    });

    let bSeed = api!.getDraft('B');
    expect(bSeed.input).toBe('');

    await act(async () => {
      api!.setDraft('B', { input: 'B draft' });
    });

    aSeed = api!.getDraft('A');
    expect(aSeed.input).toBe('hello');

    bSeed = api!.getDraft('B');
    expect(bSeed.input).toBe('B draft');
  });
});
