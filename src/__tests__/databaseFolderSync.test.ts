import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service uses fs (the file-system adapter) under the hood. We mock it
// per test so we can drive the various exists/missing/collision paths.
vi.mock('../services/fileSystem', () => {
  const mock = {
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
  };
  return { default: mock };
});

import {
  isDatabaseFile,
  siblingFolderPath,
  ensureSiblingFolder,
  renameSiblingFolder,
  deleteSiblingFolder,
  siblingFolderEntries,
} from '../services/databaseFolderSync';
import fs from '../services/fileSystem';

const mockedFs = fs as unknown as {
  readDirectory: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  renamePath: ReturnType<typeof vi.fn>;
  deletePath: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isDatabaseFile (Unit 6)', () => {
  it('matches paths ending in .quipudb.jsonl regardless of case', () => {
    expect(isDatabaseFile('/a/tasks.quipudb.jsonl')).toBe(true);
    expect(isDatabaseFile('Tasks.QUIPUDB.JSONL')).toBe(true);
  });
  it('rejects unrelated extensions', () => {
    expect(isDatabaseFile('/a/notes.md')).toBe(false);
    expect(isDatabaseFile('/a/data.jsonl')).toBe(false);
  });
});

describe('siblingFolderPath (Unit 6)', () => {
  it('strips the suffix and keeps the directory', () => {
    expect(siblingFolderPath('/ws/tasks.quipudb.jsonl')).toBe('/ws/tasks');
  });
  it('handles bare basenames', () => {
    expect(siblingFolderPath('tasks.quipudb.jsonl')).toBe('tasks');
  });
});

describe('ensureSiblingFolder (Unit 6)', () => {
  it('creates the folder when missing', async () => {
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    mockedFs.readFile.mockRejectedValueOnce(new Error('missing'));
    mockedFs.createFolder.mockResolvedValueOnce({ success: true });
    const result = await ensureSiblingFolder('/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.createFolder).toHaveBeenCalledWith('/ws/tasks');
  });

  it('is a no-op when the folder already exists', async () => {
    mockedFs.readDirectory.mockResolvedValueOnce([]);
    const result = await ensureSiblingFolder('/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.createFolder).not.toHaveBeenCalled();
  });

  it('refuses when a regular file collides at the sibling path', async () => {
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('not a dir'));
    mockedFs.readFile.mockResolvedValueOnce('whatever');
    const result = await ensureSiblingFolder('/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/file already exists/i);
    expect(mockedFs.createFolder).not.toHaveBeenCalled();
  });
});

describe('renameSiblingFolder (Unit 6)', () => {
  it('renames the folder when the source exists and the destination is free', async () => {
    // Old folder exists (readDirectory succeeds)
    mockedFs.readDirectory.mockResolvedValueOnce([]);
    // New folder probe: readDirectory rejects, readFile rejects -> not exists
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    mockedFs.readFile.mockRejectedValueOnce(new Error('missing'));
    mockedFs.renamePath.mockResolvedValueOnce({ success: true });

    const result = await renameSiblingFolder('/ws/tasks.quipudb.jsonl', '/ws/roadmap.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.renamePath).toHaveBeenCalledWith('/ws/tasks', '/ws/roadmap');
  });

  it('skips silently when the source folder does not exist', async () => {
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    mockedFs.readFile.mockRejectedValueOnce(new Error('missing'));

    const result = await renameSiblingFolder('/ws/tasks.quipudb.jsonl', '/ws/roadmap.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.renamePath).not.toHaveBeenCalled();
  });

  it('aborts when the destination already exists', async () => {
    // Source exists
    mockedFs.readDirectory.mockResolvedValueOnce([]);
    // Destination exists as a directory
    mockedFs.readDirectory.mockResolvedValueOnce([]);

    const result = await renameSiblingFolder('/ws/tasks.quipudb.jsonl', '/ws/roadmap.quipudb.jsonl');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(mockedFs.renamePath).not.toHaveBeenCalled();
  });

  it('returns ok=true when source and destination are the same path', async () => {
    const result = await renameSiblingFolder('/ws/tasks.quipudb.jsonl', '/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.renamePath).not.toHaveBeenCalled();
  });

  it('rejects non-database paths', async () => {
    const result = await renameSiblingFolder('/ws/notes.md', '/ws/notes.txt');
    expect(result.ok).toBe(false);
  });
});

describe('siblingFolderEntries (Unit 6)', () => {
  it('returns count when the folder exists', async () => {
    mockedFs.readDirectory.mockResolvedValueOnce([
      { name: 'a.md', path: '', isDirectory: false } as any,
      { name: 'b.md', path: '', isDirectory: false } as any,
    ]);
    const result = await siblingFolderEntries('/ws/tasks.quipudb.jsonl');
    expect(result).toEqual({ exists: true, count: 2 });
  });

  it('returns exists=false when the folder is missing', async () => {
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    const result = await siblingFolderEntries('/ws/tasks.quipudb.jsonl');
    expect(result).toEqual({ exists: false, count: 0 });
  });
});

describe('deleteSiblingFolder (Unit 6)', () => {
  it('deletes the folder when present', async () => {
    mockedFs.readDirectory.mockResolvedValueOnce([]);
    mockedFs.deletePath.mockResolvedValueOnce({ success: true });
    const result = await deleteSiblingFolder('/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.deletePath).toHaveBeenCalledWith('/ws/tasks');
  });

  it('is a no-op when the folder is missing', async () => {
    mockedFs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    mockedFs.readFile.mockRejectedValueOnce(new Error('missing'));
    const result = await deleteSiblingFolder('/ws/tasks.quipudb.jsonl');
    expect(result.ok).toBe(true);
    expect(mockedFs.deletePath).not.toHaveBeenCalled();
  });
});
