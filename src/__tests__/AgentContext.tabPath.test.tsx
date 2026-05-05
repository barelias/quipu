/**
 * Unit 11 — Tab path id migration.
 *
 * Two behaviors live here:
 *   1. When `upsertAgent` produces a different id (slug rename or folder
 *      move), AgentContext repaths any open `agent://<oldId>` tab to
 *      `agent://<newId>` and updates its display name. A pure name
 *      change leaves the path alone.
 *   2. After agents load, any open `agent://<id>` tab whose id no
 *      longer resolves to a loaded agent (e.g. a persisted tab from
 *      the legacy UUID-based scheme) is closed silently — no toast.
 *      A tab whose id DOES resolve stays open.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import type { Agent } from '@/types/agent';

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
  // Per-test tab-context spies. `openTabs` is mutated by tests via
  // `setOpenTabs` so the AgentContext sees the desired starting state.
  tab: {
    openTabs: [] as Array<{ id: string; type?: string; path: string; name: string }>,
    renameTabsByPath: vi.fn(),
    renameTabPath: vi.fn(),
    closeTab: vi.fn(),
  },
}));
const mockAgentFileStore = hoisted.agentFileStore;
const mockSessionCache = hoisted.sessionCache;
const mockTab = hoisted.tab;

vi.mock('../services/agentFileStore', () => hoisted.agentFileStore);
vi.mock('../services/sessionCache', () => hoisted.sessionCache);
vi.mock('../services/quipuFileStore', () => ({
  watchDirRecursive: () => () => {},
}));
vi.mock('../services/legacyImport', () => ({
  importLegacyDataForWorkspace: vi.fn(async () => ({ imported: 0, errors: 0 })),
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
  useTab: () => ({
    openTabs: mockTab.openTabs,
    renameTabsByPath: mockTab.renameTabsByPath,
    renameTabPath: mockTab.renameTabPath,
    closeTab: mockTab.closeTab,
  }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../services/agentRuntime', () => ({
  isElectronAgentRuntime: () => false,
  startSession: vi.fn(),
}));

import { AgentProvider, useAgent } from '../context/AgentContext';

function makeAgent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'slug' | 'name'>): Agent {
  const now = '2026-04-30T10:00:00Z';
  return {
    id: overrides.id,
    slug: overrides.slug,
    name: overrides.name,
    folder: overrides.folder,
    kind: overrides.kind ?? 'chat',
    systemPrompt: overrides.systemPrompt ?? '',
    model: overrides.model ?? 'claude-sonnet-4-5',
    bindings: overrides.bindings ?? [],
    permissionMode: overrides.permissionMode ?? 'default',
    allowedTools: overrides.allowedTools,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

interface Api {
  upsertAgent: (a: Agent) => void;
  moveAgent: (id: string, patch: { folder?: string }) => void;
  isLoaded: boolean;
  agents: Agent[];
}

let api: Api | null = null;

function Probe() {
  const ctx = useAgent();
  React.useEffect(() => {
    api = {
      upsertAgent: ctx.upsertAgent,
      moveAgent: ctx.moveAgent,
      isLoaded: ctx.isLoaded,
      agents: ctx.agents,
    };
  });
  return <div data-testid="isLoaded">{String(ctx.isLoaded)}</div>;
}

function Harness({ initialPath }: { initialPath: string | null }) {
  const [path] = useState<string | null>(initialPath);
  currentWorkspacePath = path;
  return <AgentProvider><Probe /></AgentProvider>;
}

beforeEach(() => {
  for (const m of Object.values(mockAgentFileStore)) m.mockReset();
  for (const m of Object.values(mockSessionCache)) m.mockReset();
  mockTab.openTabs = [];
  mockTab.renameTabsByPath.mockReset();
  mockTab.renameTabPath.mockReset();
  mockTab.closeTab.mockReset();

  mockAgentFileStore.loadAllAgents.mockImplementation(async () => []);
  mockAgentFileStore.loadAllFolders.mockImplementation(async () => []);
  mockAgentFileStore.saveAgent.mockImplementation(async () => {});
  mockAgentFileStore.deleteAgent.mockImplementation(async () => {});
  mockAgentFileStore.createFolder.mockImplementation(async () => {});
  mockAgentFileStore.deleteFolder.mockImplementation(async () => {});
  mockAgentFileStore.renameFolder.mockImplementation(async () => {});
  mockSessionCache.loadSession.mockImplementation(async () => null);
  mockSessionCache.saveSession.mockImplementation(async () => {});
  mockSessionCache.deleteSession.mockImplementation(async () => {});

  currentWorkspacePath = null;
  api = null;
});

describe('AgentContext — tab path on rename / move', () => {
  it('slug rename: tab path is repathed via renameTabPath, name updated', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'old-slug', slug: 'old-slug', name: 'Old name' }),
    ]);
    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));

    const renamed = makeAgent({ id: 'old-slug', slug: 'new-slug', name: 'New name' });

    await act(async () => {
      api!.upsertAgent(renamed);
      await Promise.resolve();
    });

    expect(mockTab.renameTabPath).toHaveBeenCalledTimes(1);
    expect(mockTab.renameTabPath).toHaveBeenCalledWith(
      'agent://old-slug',
      'agent://new-slug',
      'New name',
    );
    // Name-only renameTabsByPath should NOT have fired for the rename
    // case — repathing carries the name update.
    expect(mockTab.renameTabsByPath).not.toHaveBeenCalled();
  });

  it('folder move: tab path repathed to include the new folder prefix', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'foo', slug: 'foo', name: 'Foo' }),
    ]);
    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));

    await act(async () => {
      api!.moveAgent('foo', { folder: 'research' });
      await Promise.resolve();
    });

    expect(mockTab.renameTabPath).toHaveBeenCalledWith(
      'agent://foo',
      'agent://research/foo',
      'Foo',
    );
  });

  it('name-only change (same id): renameTabsByPath fires, renameTabPath does NOT', async () => {
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'foo', slug: 'foo', name: 'Old' }),
    ]);
    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));

    // Rename that resolves to the same slug (e.g. user retyped the same
    // slug with a different display capitalization but the slugifier
    // produces the same value). Use the same slug to keep id stable.
    const renamed = makeAgent({ id: 'foo', slug: 'foo', name: 'New display' });

    await act(async () => {
      api!.upsertAgent(renamed);
      await Promise.resolve();
    });

    expect(mockTab.renameTabsByPath).toHaveBeenCalledWith('agent://foo', 'New display');
    expect(mockTab.renameTabPath).not.toHaveBeenCalled();
  });
});

describe('AgentContext — stale agent tab prune on load', () => {
  it('drops a tab whose id does not resolve (legacy UUID-based path)', async () => {
    // Pre-seed a session-restored tab with a UUID-based path that no
    // agent will match.
    mockTab.openTabs = [
      { id: 'tab-1', type: 'agent', path: 'agent://3f9b2-deadbeef', name: 'Stale' },
      { id: 'tab-2', type: 'agent', path: 'agent://still-here', name: 'Live' },
    ];
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'still-here', slug: 'still-here', name: 'Live' }),
    ]);

    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));
    // Allow the prune effect to run after isLoaded flips.
    await waitFor(() => expect(mockTab.closeTab).toHaveBeenCalled());

    // Only the stale tab should have been closed.
    expect(mockTab.closeTab).toHaveBeenCalledTimes(1);
    expect(mockTab.closeTab).toHaveBeenCalledWith('tab-1');
  });

  it('preserves tabs whose id resolves to a loaded agent', async () => {
    mockTab.openTabs = [
      { id: 'tab-1', type: 'agent', path: 'agent://research/foo', name: 'Foo' },
    ];
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([
      makeAgent({ id: 'research/foo', slug: 'foo', folder: 'research', name: 'Foo' }),
    ]);

    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));
    // Give the prune effect at least one tick to run.
    await act(async () => { await Promise.resolve(); });

    expect(mockTab.closeTab).not.toHaveBeenCalled();
  });

  it('does NOT close non-agent tabs even when their path looks unrelated', async () => {
    // A file tab with an arbitrary path must never be touched by the
    // agent prune logic — only `type === 'agent'` is in scope.
    mockTab.openTabs = [
      { id: 'file-tab', type: undefined, path: '/some/file.md', name: 'file.md' },
      { id: 'editor-tab', type: 'agent-editor', path: 'agent-editor://something', name: 'edit' },
    ];
    mockAgentFileStore.loadAllAgents.mockResolvedValueOnce([]);

    render(<Harness initialPath="/foo" />);
    await waitFor(() => expect(api?.isLoaded).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(mockTab.closeTab).not.toHaveBeenCalled();
  });
});
