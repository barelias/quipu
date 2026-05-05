/**
 * Tests for `agentFileStore`.
 *
 * Strategy: same as `quipuFileStore.test.ts` — mock `../services/fileSystem`
 * with a node:fs/promises-backed fake against a tmp directory. The
 * domain logic in `agentFileStore` runs unchanged; only the
 * lowest-level adapter is faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import type { Agent } from '@/types/agent';

vi.mock('../services/fileSystem', () => {
  const fakeFs = {
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

import {
  loadAllAgents,
  loadAllFolders,
  saveAgent,
  deleteAgent,
  renameFolder,
  deleteFolder,
  createFolder,
} from '../services/agentFileStore';

let tmpRoot = '';

/** Fixture builder: minimal Agent with sensible defaults. */
function makeAgent(overrides: Partial<Agent> & Pick<Agent, 'name' | 'slug'>): Agent {
  const now = '2026-04-30T10:00:00.000Z';
  return {
    id: '', // recomputed by the store; placeholder here
    name: overrides.name,
    slug: overrides.slug,
    folder: overrides.folder,
    kind: overrides.kind ?? 'chat',
    systemPrompt: overrides.systemPrompt ?? 'system',
    model: overrides.model ?? 'claude-sonnet-4-5',
    bindings: overrides.bindings ?? [],
    permissionMode: overrides.permissionMode ?? 'default',
    allowedTools: overrides.allowedTools,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-agent-store-'));
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('loadAllAgents', () => {
  it('returns [] when .quipu/agents/ does not exist', async () => {
    const result = await loadAllAgents(tmpRoot);
    expect(result).toEqual([]);
  });

  it('loads agents from root and nested folders, sorted by id', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'Root Agent', slug: 'root-agent' }));
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Nested', slug: 'nested', folder: 'research/web-scraping' }),
    );
    await saveAgent(tmpRoot, makeAgent({ name: 'Mid', slug: 'mid', folder: 'research' }));

    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id)).toEqual([
      'research/mid',
      'research/web-scraping/nested',
      'root-agent',
    ]);
    // Folder + slug derived from on-disk path.
    expect(agents[0]).toMatchObject({ folder: 'research', slug: 'mid', name: 'Mid' });
    expect(agents[1]).toMatchObject({
      folder: 'research/web-scraping',
      slug: 'nested',
      name: 'Nested',
    });
    expect(agents[2]).toMatchObject({ folder: '', slug: 'root-agent', name: 'Root Agent' });
  });

  it('id, folder, and slug are derived even when the on-disk file does not include them', async () => {
    // Manually write an agent file WITHOUT an id field, with a `folder`
    // field that disagrees with the on-disk location to verify the
    // on-disk path wins.
    const targetDir = nodePath.join(tmpRoot, '.quipu', 'agents', 'real');
    await nodeFs.mkdir(targetDir, { recursive: true });
    const targetFile = nodePath.join(targetDir, 'leaf.json');
    await nodeFs.writeFile(
      targetFile,
      JSON.stringify({
        schemaVersion: 1,
        name: 'Leaf',
        // Intentionally wrong:
        folder: 'totally-wrong',
        slug: 'totally-wrong',
        kind: 'chat',
        systemPrompt: '',
        model: 'claude-sonnet-4-5',
        bindings: [],
        permissionMode: 'default',
        createdAt: '2026-04-30T10:00:00.000Z',
        updatedAt: '2026-04-30T10:00:00.000Z',
      }),
      'utf8',
    );

    const agents = await loadAllAgents(tmpRoot);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('real/leaf');
    expect(agents[0].folder).toBe('real');
    expect(agents[0].slug).toBe('leaf');
  });

  it('skips malformed JSON and logs a warning, other agents still load', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'Good', slug: 'good' }));

    // Drop a malformed file alongside the good one.
    const badPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'bad.json');
    await nodeFs.writeFile(badPath, '{not valid json', 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const agents = await loadAllAgents(tmpRoot);
      expect(agents.map((a) => a.id)).toEqual(['good']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('saveAgent', () => {
  it('writes to <root>/<folder>/<slug>.json', async () => {
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'research' }),
    );
    const expectedPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'research', 'foo.json');
    const stat = await nodeFs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('does NOT persist `id` on disk (it is derived)', async () => {
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'research' }),
    );
    const filePath = nodePath.join(tmpRoot, '.quipu', 'agents', 'research', 'foo.json');
    const raw = JSON.parse(await nodeFs.readFile(filePath, 'utf8'));
    expect(raw).not.toHaveProperty('id');
    expect(raw).toMatchObject({ slug: 'foo', folder: 'research', name: 'Foo' });
  });

  it('returns the new id', async () => {
    const id = await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'research/web' }),
    );
    expect(id).toBe('research/web/foo');
  });

  it('rename via slug change deletes the old file', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'Old', slug: 'old', folder: 'a' }));
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'New', slug: 'new', folder: 'a' }),
      'a/old',
    );

    const oldPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'a', 'old.json');
    const newPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'a', 'new.json');
    await expect(nodeFs.stat(oldPath)).rejects.toThrow();
    const stat = await nodeFs.stat(newPath);
    expect(stat.isFile()).toBe(true);
  });

  it('move via folder change deletes the old file and writes to the new dir', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'Foo', slug: 'foo', folder: 'a' }));
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'b/c' }),
      'a/foo',
    );

    const oldPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'a', 'foo.json');
    const newPath = nodePath.join(tmpRoot, '.quipu', 'agents', 'b', 'c', 'foo.json');
    await expect(nodeFs.stat(oldPath)).rejects.toThrow();
    const stat = await nodeFs.stat(newPath);
    expect(stat.isFile()).toBe(true);
  });

  it('throws if slug is missing', async () => {
    await expect(
      saveAgent(tmpRoot, makeAgent({ name: 'No slug', slug: '' as unknown as string })),
    ).rejects.toThrow(/slug/);
  });
});

describe('deleteAgent', () => {
  it('deletes the file', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'X', slug: 'x', folder: 'p' }));
    await deleteAgent(tmpRoot, 'p/x');
    const filePath = nodePath.join(tmpRoot, '.quipu', 'agents', 'p', 'x.json');
    await expect(nodeFs.stat(filePath)).rejects.toThrow();
  });

  it('is idempotent — deleting a missing agent is a no-op', async () => {
    await expect(deleteAgent(tmpRoot, 'never/existed')).resolves.toBeUndefined();
  });

  it('does not affect sibling agents in the same folder', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'p' }));
    await saveAgent(tmpRoot, makeAgent({ name: 'B', slug: 'b', folder: 'p' }));
    await deleteAgent(tmpRoot, 'p/a');
    const remaining = await loadAllAgents(tmpRoot);
    expect(remaining.map((a) => a.id)).toEqual(['p/b']);
  });
});

describe('createFolder + loadAllFolders', () => {
  it('createFolder writes a .folder.json marker', async () => {
    await createFolder(tmpRoot, 'planning', 'Planning Docs');
    const markerPath = nodePath.join(
      tmpRoot,
      '.quipu',
      'agents',
      'planning',
      '.folder.json',
    );
    const raw = JSON.parse(await nodeFs.readFile(markerPath, 'utf8'));
    expect(raw).toMatchObject({
      schemaVersion: 1,
      displayName: 'Planning Docs',
    });
    expect(typeof raw.createdAt).toBe('string');
  });

  it('createFolder is idempotent and preserves original createdAt on re-create', async () => {
    await createFolder(tmpRoot, 'p', 'First');
    const firstMarker = JSON.parse(
      await nodeFs.readFile(
        nodePath.join(tmpRoot, '.quipu', 'agents', 'p', '.folder.json'),
        'utf8',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createFolder(tmpRoot, 'p', 'Second');
    const secondMarker = JSON.parse(
      await nodeFs.readFile(
        nodePath.join(tmpRoot, '.quipu', 'agents', 'p', '.folder.json'),
        'utf8',
      ),
    );
    expect(secondMarker.createdAt).toBe(firstMarker.createdAt);
    expect(secondMarker.displayName).toBe('Second');
  });

  it('loadAllFolders returns [] for a missing root', async () => {
    const folders = await loadAllFolders(tmpRoot);
    expect(folders).toEqual([]);
  });

  it('loadAllFolders surfaces empty folders declared via .folder.json with displayName', async () => {
    await createFolder(tmpRoot, 'planning', 'Planning Docs');
    const folders = await loadAllFolders(tmpRoot);
    expect(folders).toEqual([{ path: 'planning', displayName: 'Planning Docs' }]);
  });

  it('loadAllFolders surfaces implicit ancestors of agents', async () => {
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'research/web-scraping' }),
    );
    const folders = await loadAllFolders(tmpRoot);
    expect(folders.map((f) => f.path)).toEqual(['research', 'research/web-scraping']);
  });

  it('loadAllFolders dedupes between markers and implicit ancestors', async () => {
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'Foo', slug: 'foo', folder: 'research/web-scraping' }),
    );
    await createFolder(tmpRoot, 'research', 'Research');
    await createFolder(tmpRoot, 'planning', 'Planning');

    const folders = await loadAllFolders(tmpRoot);
    expect(folders).toEqual([
      { path: 'planning', displayName: 'Planning' },
      { path: 'research', displayName: 'Research' },
      { path: 'research/web-scraping' },
    ]);
  });
});

describe('renameFolder', () => {
  it('moves all child agents along with the directory', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'old' }));
    await saveAgent(tmpRoot, makeAgent({ name: 'B', slug: 'b', folder: 'old/sub' }));

    await renameFolder(tmpRoot, 'old', 'new');

    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id).sort()).toEqual(['new/a', 'new/sub/b']);

    // Old paths no longer exist.
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'agents', 'old')),
    ).rejects.toThrow();
  });

  it('throws when the destination already exists', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'src' }));
    await saveAgent(tmpRoot, makeAgent({ name: 'B', slug: 'b', folder: 'dest' }));
    await expect(renameFolder(tmpRoot, 'src', 'dest')).rejects.toThrow();
  });

  it('rejects renaming the root', async () => {
    await expect(renameFolder(tmpRoot, '', 'dest')).rejects.toThrow();
    await expect(renameFolder(tmpRoot, 'src', '')).rejects.toThrow();
  });

  it('renaming into a nested destination creates parent dirs', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'old' }));
    await renameFolder(tmpRoot, 'old', 'a/b/c');
    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id)).toEqual(['a/b/c/a']);
  });
});

describe('deleteFolder', () => {
  it('recursive: true removes every child', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'doomed' }));
    await saveAgent(tmpRoot, makeAgent({ name: 'B', slug: 'b', folder: 'doomed/sub' }));
    await deleteFolder(tmpRoot, 'doomed', { recursive: true });

    const agents = await loadAllAgents(tmpRoot);
    expect(agents).toEqual([]);
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'agents', 'doomed')),
    ).rejects.toThrow();
  });

  it('non-recursive moves children into the parent (or root)', async () => {
    await saveAgent(tmpRoot, makeAgent({ name: 'A', slug: 'a', folder: 'p' }));
    await saveAgent(tmpRoot, makeAgent({ name: 'B', slug: 'b', folder: 'p' }));
    await deleteFolder(tmpRoot, 'p');

    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id).sort()).toEqual(['a', 'b']);
    // Folder dir is gone.
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'agents', 'p')),
    ).rejects.toThrow();
  });

  it('non-recursive collapses one level (research/web -> research)', async () => {
    await saveAgent(
      tmpRoot,
      makeAgent({ name: 'X', slug: 'x', folder: 'research/web' }),
    );
    await deleteFolder(tmpRoot, 'research/web');

    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id)).toEqual(['research/x']);
  });

  it('non-recursive disambiguates slugs that collide with existing siblings', async () => {
    // Root has a sibling named "foo" already.
    await saveAgent(tmpRoot, makeAgent({ name: 'Foo Sibling', slug: 'foo' }));
    // The folder being collapsed also has a "foo".
    await saveAgent(tmpRoot, makeAgent({ name: 'Foo Inner', slug: 'foo', folder: 'box' }));

    await deleteFolder(tmpRoot, 'box');

    const agents = await loadAllAgents(tmpRoot);
    expect(agents.map((a) => a.id).sort()).toEqual(['foo', 'foo-2']);
    // The original sibling kept its slug; the moved one got disambiguated.
    const original = agents.find((a) => a.id === 'foo');
    const moved = agents.find((a) => a.id === 'foo-2');
    expect(original?.name).toBe('Foo Sibling');
    expect(moved?.name).toBe('Foo Inner');
  });

  it('rejects deleting the root', async () => {
    await expect(deleteFolder(tmpRoot, '')).rejects.toThrow();
  });
});
