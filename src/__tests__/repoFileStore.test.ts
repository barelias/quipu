/**
 * Tests for `repoFileStore`.
 *
 * Strategy: same as `agentFileStore.test.ts` — mock `../services/fileSystem`
 * with a node:fs/promises-backed fake against a tmp directory. The
 * domain logic in `repoFileStore` runs unchanged; only the
 * lowest-level adapter is faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import type { Repo } from '@/types/agent';

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
  loadAllRepos,
  loadAllFolders,
  saveRepo,
  deleteRepo,
  renameFolder,
  deleteFolder,
  createFolder,
} from '../services/repoFileStore';

let tmpRoot = '';

/** Fixture builder: minimal Repo with sensible defaults. */
function makeRepo(overrides: Partial<Repo> & Pick<Repo, 'name' | 'slug'>): Repo {
  const now = '2026-04-30T10:00:00.000Z';
  return {
    id: '', // recomputed by the store; placeholder here
    name: overrides.name,
    slug: overrides.slug,
    folder: overrides.folder,
    url: overrides.url ?? `git@github.com:example/${overrides.slug}.git`,
    localClonePath: overrides.localClonePath,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-repo-store-'));
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('loadAllRepos', () => {
  it('returns [] when .quipu/repos/ does not exist', async () => {
    const result = await loadAllRepos(tmpRoot);
    expect(result).toEqual([]);
  });

  it('loads repos from root and nested folders, sorted by id', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Root Repo', slug: 'root-repo' }));
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Nested', slug: 'nested', folder: 'external/upstream' }),
    );
    await saveRepo(tmpRoot, makeRepo({ name: 'Mid', slug: 'mid', folder: 'external' }));

    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id)).toEqual([
      'external/mid',
      'external/upstream/nested',
      'root-repo',
    ]);
    // Folder + slug derived from on-disk path.
    expect(repos[0]).toMatchObject({ folder: 'external', slug: 'mid', name: 'Mid' });
    expect(repos[1]).toMatchObject({
      folder: 'external/upstream',
      slug: 'nested',
      name: 'Nested',
    });
    expect(repos[2]).toMatchObject({ folder: '', slug: 'root-repo', name: 'Root Repo' });
  });

  it('handles a 3-deep nested folder mixed with root entries', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Top', slug: 'top' }));
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Deep', slug: 'deep', folder: 'a/b/c' }),
    );
    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id)).toEqual(['a/b/c/deep', 'top']);
    expect(repos[0].folder).toBe('a/b/c');
    expect(repos[0].slug).toBe('deep');
  });

  it('id, folder, and slug are derived even when the on-disk file does not include them', async () => {
    // Manually write a repo file WITHOUT an id field, with a `folder`
    // field that disagrees with the on-disk location to verify the
    // on-disk path wins.
    const targetDir = nodePath.join(tmpRoot, '.quipu', 'repos', 'real');
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
        url: 'git@github.com:example/leaf.git',
        createdAt: '2026-04-30T10:00:00.000Z',
        updatedAt: '2026-04-30T10:00:00.000Z',
      }),
      'utf8',
    );

    const repos = await loadAllRepos(tmpRoot);
    expect(repos).toHaveLength(1);
    expect(repos[0].id).toBe('real/leaf');
    expect(repos[0].folder).toBe('real');
    expect(repos[0].slug).toBe('leaf');
  });

  it('skips malformed JSON and logs a warning, other repos still load', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Good', slug: 'good' }));

    // Drop a malformed file alongside the good one.
    const badPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'bad.json');
    await nodeFs.writeFile(badPath, '{not valid json', 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const repos = await loadAllRepos(tmpRoot);
      expect(repos.map((r) => r.id)).toEqual(['good']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('saveRepo', () => {
  it('writes to <root>/<folder>/<slug>.json', async () => {
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'external' }),
    );
    const expectedPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'external', 'foo.json');
    const stat = await nodeFs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('does NOT persist `id` on disk (it is derived)', async () => {
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'external' }),
    );
    const filePath = nodePath.join(tmpRoot, '.quipu', 'repos', 'external', 'foo.json');
    const raw = JSON.parse(await nodeFs.readFile(filePath, 'utf8'));
    expect(raw).not.toHaveProperty('id');
    expect(raw).toMatchObject({ slug: 'foo', folder: 'external', name: 'Foo' });
  });

  it('returns the new id', async () => {
    const id = await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'external/upstream' }),
    );
    expect(id).toBe('external/upstream/foo');
  });

  it('rename via slug change deletes the old file', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Old', slug: 'old', folder: 'a' }));
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'New', slug: 'new', folder: 'a' }),
      'a/old',
    );

    const oldPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'a', 'old.json');
    const newPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'a', 'new.json');
    await expect(nodeFs.stat(oldPath)).rejects.toThrow();
    const stat = await nodeFs.stat(newPath);
    expect(stat.isFile()).toBe(true);
  });

  it('move via folder change deletes the old file and writes to the new dir', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Foo', slug: 'foo', folder: 'a' }));
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'b/c' }),
      'a/foo',
    );

    const oldPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'a', 'foo.json');
    const newPath = nodePath.join(tmpRoot, '.quipu', 'repos', 'b', 'c', 'foo.json');
    await expect(nodeFs.stat(oldPath)).rejects.toThrow();
    const stat = await nodeFs.stat(newPath);
    expect(stat.isFile()).toBe(true);
  });

  it('throws if slug is missing', async () => {
    await expect(
      saveRepo(tmpRoot, makeRepo({ name: 'No slug', slug: '' as unknown as string })),
    ).rejects.toThrow(/slug/);
  });
});

describe('deleteRepo', () => {
  it('deletes the file', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'X', slug: 'x', folder: 'p' }));
    await deleteRepo(tmpRoot, 'p/x');
    const filePath = nodePath.join(tmpRoot, '.quipu', 'repos', 'p', 'x.json');
    await expect(nodeFs.stat(filePath)).rejects.toThrow();
  });

  it('is idempotent — deleting a missing repo is a no-op', async () => {
    await expect(deleteRepo(tmpRoot, 'never/existed')).resolves.toBeUndefined();
  });

  it('does not affect sibling repos in the same folder', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'p' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'B', slug: 'b', folder: 'p' }));
    await deleteRepo(tmpRoot, 'p/a');
    const remaining = await loadAllRepos(tmpRoot);
    expect(remaining.map((r) => r.id)).toEqual(['p/b']);
  });

  it('deleting a repo in a nested folder does not break siblings elsewhere', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'Sib1', slug: 'sib1' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'Sib2', slug: 'sib2', folder: 'other' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'Doomed', slug: 'doomed', folder: 'a/b/c' }));

    await deleteRepo(tmpRoot, 'a/b/c/doomed');

    const remaining = await loadAllRepos(tmpRoot);
    expect(remaining.map((r) => r.id).sort()).toEqual(['other/sib2', 'sib1']);
  });
});

describe('createFolder + loadAllFolders', () => {
  it('createFolder writes a .folder.json marker', async () => {
    await createFolder(tmpRoot, 'planning', 'Planning Repos');
    const markerPath = nodePath.join(
      tmpRoot,
      '.quipu',
      'repos',
      'planning',
      '.folder.json',
    );
    const raw = JSON.parse(await nodeFs.readFile(markerPath, 'utf8'));
    expect(raw).toMatchObject({
      schemaVersion: 1,
      displayName: 'Planning Repos',
    });
    expect(typeof raw.createdAt).toBe('string');
  });

  it('createFolder is idempotent and preserves original createdAt on re-create', async () => {
    await createFolder(tmpRoot, 'p', 'First');
    const firstMarker = JSON.parse(
      await nodeFs.readFile(
        nodePath.join(tmpRoot, '.quipu', 'repos', 'p', '.folder.json'),
        'utf8',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createFolder(tmpRoot, 'p', 'Second');
    const secondMarker = JSON.parse(
      await nodeFs.readFile(
        nodePath.join(tmpRoot, '.quipu', 'repos', 'p', '.folder.json'),
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
    await createFolder(tmpRoot, 'planning', 'Planning Repos');
    const folders = await loadAllFolders(tmpRoot);
    expect(folders).toEqual([{ path: 'planning', displayName: 'Planning Repos' }]);
  });

  it('loadAllFolders surfaces implicit ancestors of repos', async () => {
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'external/upstream' }),
    );
    const folders = await loadAllFolders(tmpRoot);
    expect(folders.map((f) => f.path)).toEqual(['external', 'external/upstream']);
  });

  it('loadAllFolders dedupes between markers and implicit ancestors', async () => {
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'Foo', slug: 'foo', folder: 'external/upstream' }),
    );
    await createFolder(tmpRoot, 'external', 'External');
    await createFolder(tmpRoot, 'planning', 'Planning');

    const folders = await loadAllFolders(tmpRoot);
    expect(folders).toEqual([
      { path: 'external', displayName: 'External' },
      { path: 'external/upstream' },
      { path: 'planning', displayName: 'Planning' },
    ]);
  });
});

describe('renameFolder', () => {
  it('moves all child repos along with the directory', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'old' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'B', slug: 'b', folder: 'old/sub' }));

    await renameFolder(tmpRoot, 'old', 'new');

    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id).sort()).toEqual(['new/a', 'new/sub/b']);

    // Old paths no longer exist.
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'repos', 'old')),
    ).rejects.toThrow();
  });

  it('throws when the destination already exists', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'src' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'B', slug: 'b', folder: 'dest' }));
    await expect(renameFolder(tmpRoot, 'src', 'dest')).rejects.toThrow();
  });

  it('rejects renaming the root', async () => {
    await expect(renameFolder(tmpRoot, '', 'dest')).rejects.toThrow();
    await expect(renameFolder(tmpRoot, 'src', '')).rejects.toThrow();
  });

  it('renaming into a nested destination creates parent dirs', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'old' }));
    await renameFolder(tmpRoot, 'old', 'a/b/c');
    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id)).toEqual(['a/b/c/a']);
  });
});

describe('deleteFolder', () => {
  it('recursive: true removes every child', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'doomed' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'B', slug: 'b', folder: 'doomed/sub' }));
    await deleteFolder(tmpRoot, 'doomed', { recursive: true });

    const repos = await loadAllRepos(tmpRoot);
    expect(repos).toEqual([]);
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'repos', 'doomed')),
    ).rejects.toThrow();
  });

  it('non-recursive moves children into the parent (or root)', async () => {
    await saveRepo(tmpRoot, makeRepo({ name: 'A', slug: 'a', folder: 'p' }));
    await saveRepo(tmpRoot, makeRepo({ name: 'B', slug: 'b', folder: 'p' }));
    await deleteFolder(tmpRoot, 'p');

    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id).sort()).toEqual(['a', 'b']);
    // Folder dir is gone.
    await expect(
      nodeFs.stat(nodePath.join(tmpRoot, '.quipu', 'repos', 'p')),
    ).rejects.toThrow();
  });

  it('non-recursive collapses one level (external/upstream -> external)', async () => {
    await saveRepo(
      tmpRoot,
      makeRepo({ name: 'X', slug: 'x', folder: 'external/upstream' }),
    );
    await deleteFolder(tmpRoot, 'external/upstream');

    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id)).toEqual(['external/x']);
  });

  it('non-recursive disambiguates slugs that collide with existing siblings', async () => {
    // Root has a sibling named "foo" already.
    await saveRepo(tmpRoot, makeRepo({ name: 'Foo Sibling', slug: 'foo' }));
    // The folder being collapsed also has a "foo".
    await saveRepo(tmpRoot, makeRepo({ name: 'Foo Inner', slug: 'foo', folder: 'box' }));

    await deleteFolder(tmpRoot, 'box');

    const repos = await loadAllRepos(tmpRoot);
    expect(repos.map((r) => r.id).sort()).toEqual(['foo', 'foo-2']);
    // The original sibling kept its slug; the moved one got disambiguated.
    const original = repos.find((r) => r.id === 'foo');
    const moved = repos.find((r) => r.id === 'foo-2');
    expect(original?.name).toBe('Foo Sibling');
    expect(moved?.name).toBe('Foo Inner');
  });

  it('rejects deleting the root', async () => {
    await expect(deleteFolder(tmpRoot, '')).rejects.toThrow();
  });
});
