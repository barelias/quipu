/**
 * Tests for `quipuFileStore` primitives.
 *
 * Strategy: mock `../services/fileSystem` so its methods proxy directly
 * to `node:fs/promises` against a tmp directory. This way we test the
 * real logic of `readJsonFile` / `writeJsonFile` / `listJsonFilesRecursive`
 * / etc. against a real filesystem, while bypassing the Electron-IPC and
 * Go-REST runtime layers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';

// In-memory listener registry for the watcher tests. We expose hooks so
// each test can fire synthetic 'directory-changed' events into the
// quipuFileStore listener.
type RawEvent = { type: string; path?: string };
const watchListeners: Array<(e: RawEvent) => void> = [];

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
    onDirectoryChanged: vi.fn((cb: (e: RawEvent) => void) => {
      watchListeners.push(cb);
      return () => {
        const idx = watchListeners.indexOf(cb);
        if (idx >= 0) watchListeners.splice(idx, 1);
      };
    }),
  };
  return { default: fakeFs };
});

import {
  readJsonFile,
  writeJsonFile,
  deleteFile,
  listJsonFilesRecursive,
  ensureDir,
  watchDirRecursive,
} from '../services/quipuFileStore';
import fakeFs from '../services/fileSystem';

const fakeFsTyped = fakeFs as unknown as {
  readDirectory: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  renamePath: ReturnType<typeof vi.fn>;
  deletePath: ReturnType<typeof vi.fn>;
  watchDirectory: ReturnType<typeof vi.fn>;
  onDirectoryChanged: ReturnType<typeof vi.fn>;
};

let tmpRoot = '';

beforeEach(async () => {
  tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'quipu-fs-test-'));
  watchListeners.length = 0;
  // Clear all mock call history but keep implementations.
  fakeFsTyped.readDirectory.mockClear();
  fakeFsTyped.readFile.mockClear();
  fakeFsTyped.writeFile.mockClear();
  fakeFsTyped.createFolder.mockClear();
  fakeFsTyped.renamePath.mockClear();
  fakeFsTyped.deletePath.mockClear();
  fakeFsTyped.watchDirectory.mockClear();
  fakeFsTyped.onDirectoryChanged.mockClear();
});

afterEach(async () => {
  if (tmpRoot) {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('writeJsonFile / readJsonFile happy path', () => {
  it('writes a JSON file and reads it back with the same value', async () => {
    const filePath = nodePath.join(tmpRoot, 'foo.json');
    await writeJsonFile(filePath, { hello: 'world', n: 42 });

    const onDisk = await nodeFs.readFile(filePath, 'utf8');
    // Should be pretty-printed with 2-space indent.
    expect(onDisk).toBe(JSON.stringify({ hello: 'world', n: 42 }, null, 2));

    const readBack = await readJsonFile<{ hello: string; n: number }>(filePath);
    expect(readBack).toEqual({ hello: 'world', n: 42 });
  });

  it('writes-list-read-delete round trip', async () => {
    const fileA = nodePath.join(tmpRoot, 'a.json');
    const fileB = nodePath.join(tmpRoot, 'b.json');
    await writeJsonFile(fileA, { a: 1 });
    await writeJsonFile(fileB, { b: 2 });

    const list = await listJsonFilesRecursive(tmpRoot);
    expect(list.map((e) => e.relativePath)).toEqual(['a.json', 'b.json']);

    const a = await readJsonFile<{ a: number }>(list[0].absolutePath);
    const b = await readJsonFile<{ b: number }>(list[1].absolutePath);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ b: 2 });

    await deleteFile(fileA);
    const list2 = await listJsonFilesRecursive(tmpRoot);
    expect(list2.map((e) => e.relativePath)).toEqual(['b.json']);
  });
});

describe('readJsonFile edge cases', () => {
  it('returns null for a non-existent file', async () => {
    const filePath = nodePath.join(tmpRoot, 'missing.json');
    const result = await readJsonFile(filePath);
    expect(result).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const filePath = nodePath.join(tmpRoot, 'empty.json');
    await nodeFs.writeFile(filePath, '', 'utf8');
    const result = await readJsonFile(filePath);
    expect(result).toBeNull();
  });

  it('throws on invalid JSON', async () => {
    const filePath = nodePath.join(tmpRoot, 'bad.json');
    await nodeFs.writeFile(filePath, '{not valid', 'utf8');
    await expect(readJsonFile(filePath)).rejects.toThrow();
  });
});

describe('writeJsonFile edge cases', () => {
  it('auto-creates the parent directory', async () => {
    const filePath = nodePath.join(tmpRoot, 'nested', 'deep', 'file.json');
    await writeJsonFile(filePath, { ok: true });
    const stat = await nodeFs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it('does not leave a .tmp file on success', async () => {
    const filePath = nodePath.join(tmpRoot, 'clean.json');
    await writeJsonFile(filePath, { x: 1 });
    const entries = await nodeFs.readdir(tmpRoot);
    expect(entries).toContain('clean.json');
    expect(entries).not.toContain('clean.json.tmp');
  });

  it('cleans up the .tmp file when rename fails halfway', async () => {
    const filePath = nodePath.join(tmpRoot, 'rename-fails.json');

    fakeFsTyped.renamePath.mockImplementationOnce(async () => {
      throw new Error('simulated rename failure');
    });

    await expect(writeJsonFile(filePath, { broken: true })).rejects.toThrow(
      'simulated rename failure',
    );

    const entries = await nodeFs.readdir(tmpRoot);
    expect(entries).not.toContain('rename-fails.json');
    expect(entries).not.toContain('rename-fails.json.tmp');
  });
});

describe('deleteFile', () => {
  it('deletes an existing file', async () => {
    const filePath = nodePath.join(tmpRoot, 'gone.json');
    await writeJsonFile(filePath, {});
    await deleteFile(filePath);
    await expect(nodeFs.stat(filePath)).rejects.toThrow();
  });

  it('is idempotent — does not throw on missing file', async () => {
    const filePath = nodePath.join(tmpRoot, 'never-existed.json');
    await expect(deleteFile(filePath)).resolves.toBeUndefined();
  });
});

describe('ensureDir', () => {
  it('creates a directory tree', async () => {
    const dirPath = nodePath.join(tmpRoot, 'a', 'b', 'c');
    await ensureDir(dirPath);
    const stat = await nodeFs.stat(dirPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent — calling twice does not throw', async () => {
    const dirPath = nodePath.join(tmpRoot, 'idem');
    await ensureDir(dirPath);
    await expect(ensureDir(dirPath)).resolves.toBeUndefined();
  });
});

describe('listJsonFilesRecursive', () => {
  it('returns [] for a non-existent directory', async () => {
    const result = await listJsonFilesRecursive(nodePath.join(tmpRoot, 'no-such-dir'));
    expect(result).toEqual([]);
  });

  it('returns [] for an empty directory', async () => {
    const dir = nodePath.join(tmpRoot, 'empty');
    await nodeFs.mkdir(dir);
    const result = await listJsonFilesRecursive(dir);
    expect(result).toEqual([]);
  });

  it('excludes .folder.json marker files', async () => {
    await writeJsonFile(nodePath.join(tmpRoot, 'a.json'), { a: 1 });
    await nodeFs.writeFile(
      nodePath.join(tmpRoot, '.folder.json'),
      JSON.stringify({ marker: true }),
      'utf8',
    );
    const result = await listJsonFilesRecursive(tmpRoot);
    expect(result.map((e) => e.relativePath)).toEqual(['a.json']);
  });

  it('excludes any other dotfile', async () => {
    await writeJsonFile(nodePath.join(tmpRoot, 'visible.json'), { v: 1 });
    await nodeFs.writeFile(nodePath.join(tmpRoot, '.gitkeep'), '', 'utf8');
    await nodeFs.writeFile(nodePath.join(tmpRoot, '.hidden.json'), '{}', 'utf8');
    const result = await listJsonFilesRecursive(tmpRoot);
    expect(result.map((e) => e.relativePath)).toEqual(['visible.json']);
  });

  it('excludes non-.json files', async () => {
    await writeJsonFile(nodePath.join(tmpRoot, 'data.json'), { ok: true });
    await nodeFs.writeFile(nodePath.join(tmpRoot, 'README.md'), '# hi', 'utf8');
    await nodeFs.writeFile(nodePath.join(tmpRoot, 'notes.txt'), 'plain', 'utf8');
    const result = await listJsonFilesRecursive(tmpRoot);
    expect(result.map((e) => e.relativePath)).toEqual(['data.json']);
  });

  it('returns nested paths with forward-slash separators in sorted order', async () => {
    // Create files in a non-alphabetical order to verify sorting kicks in.
    await writeJsonFile(nodePath.join(tmpRoot, 'z-root.json'), {});
    await writeJsonFile(nodePath.join(tmpRoot, 'a-root.json'), {});
    await writeJsonFile(nodePath.join(tmpRoot, 'research', 'web-scraping', 'foo.json'), {});
    await writeJsonFile(nodePath.join(tmpRoot, 'research', 'bar.json'), {});
    await writeJsonFile(nodePath.join(tmpRoot, 'research', 'a-leaf.json'), {});

    const result = await listJsonFilesRecursive(tmpRoot);
    expect(result.map((e) => e.relativePath)).toEqual([
      'a-root.json',
      'research/a-leaf.json',
      'research/bar.json',
      'research/web-scraping/foo.json',
      'z-root.json',
    ]);

    // All separators in relative paths are forward slashes, even on
    // platforms where node:path would use backslashes.
    for (const entry of result) {
      expect(entry.relativePath).not.toContain('\\');
    }
  });

  it('returns absolute paths in absolutePath', async () => {
    await writeJsonFile(nodePath.join(tmpRoot, 'sub', 'item.json'), { x: 1 });
    const result = await listJsonFilesRecursive(tmpRoot);
    expect(result).toHaveLength(1);
    expect(nodePath.isAbsolute(result[0].absolutePath)).toBe(true);
    // The absolute path should resolve to a real file.
    const stat = await nodeFs.stat(result[0].absolutePath);
    expect(stat.isFile()).toBe(true);
  });
});

describe('watchDirRecursive', () => {
  it('subscribes via onDirectoryChanged and returns an unsubscribe', () => {
    const events: Array<{ type: string; path?: string }> = [];
    const unsubscribe = watchDirRecursive(tmpRoot, (e) => events.push(e));

    expect(typeof unsubscribe).toBe('function');
    expect(fakeFsTyped.onDirectoryChanged).toHaveBeenCalledTimes(1);
    expect(fakeFsTyped.watchDirectory).toHaveBeenCalledWith(tmpRoot);

    // Unsubscribe should not throw.
    expect(() => unsubscribe()).not.toThrow();
    // Calling unsubscribe twice is also a no-op.
    expect(() => unsubscribe()).not.toThrow();
  });

  it('debounces a burst of events into a single callback', async () => {
    vi.useFakeTimers();
    try {
      const events: Array<{ type: string; path?: string }> = [];
      const unsubscribe = watchDirRecursive(tmpRoot, (e) => events.push(e));

      // Fire 5 rapid events through the subscribed listener.
      const listener = watchListeners[0];
      expect(listener).toBeDefined();
      listener({ type: 'change', path: 'a.json' });
      listener({ type: 'change', path: 'b.json' });
      listener({ type: 'rename', path: 'c.json' });
      listener({ type: 'change', path: 'd.json' });
      listener({ type: 'change', path: 'e.json' });

      // Before the debounce window expires, no callbacks have fired.
      expect(events).toHaveLength(0);

      vi.advanceTimersByTime(250);
      expect(events).toHaveLength(1);
      // Last event wins for the coarse type/path; callers reload the
      // whole subtree anyway.
      expect(events[0]).toEqual({ type: 'change', path: 'e.json' });

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invoke onChange after unsubscribe', async () => {
    vi.useFakeTimers();
    try {
      const events: Array<{ type: string; path?: string }> = [];
      const unsubscribe = watchDirRecursive(tmpRoot, (e) => events.push(e));
      const listener = watchListeners[0];

      listener({ type: 'change', path: 'a.json' });
      unsubscribe();
      vi.advanceTimersByTime(250);

      expect(events).toHaveLength(0);
      // After unsubscribe, the underlying listener should be gone too.
      expect(watchListeners).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
