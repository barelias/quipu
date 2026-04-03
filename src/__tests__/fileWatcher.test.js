import { describe, it, expect } from 'vitest';

describe('File watcher save guard', () => {
  // Simulates the recentSavesRef guard logic from WorkspaceContext
  const createSaveGuard = () => {
    const recentSaves = new Map();
    return {
      markSaved: (path) => recentSaves.set(path, Date.now()),
      shouldSkip: (path) => {
        const savedAt = recentSaves.get(path);
        return savedAt && Date.now() - savedAt < 3000;
      },
      getMap: () => recentSaves,
    };
  };

  it('skips file change events right after save', () => {
    const guard = createSaveGuard();
    guard.markSaved('/path/to/file.md');
    expect(guard.shouldSkip('/path/to/file.md')).toBe(true);
  });

  it('does not skip unrelated files', () => {
    const guard = createSaveGuard();
    guard.markSaved('/path/to/file.md');
    expect(guard.shouldSkip('/path/to/other.md')).toBeFalsy();
  });

  it('does not skip after guard expires', () => {
    const guard = createSaveGuard();
    const now = Date.now();
    // Manually set timestamp 4 seconds ago
    guard.getMap().set('/path/to/file.md', now - 4000);
    expect(guard.shouldSkip('/path/to/file.md')).toBe(false);
  });

  it('does not delete entry on match (handles multiple OS events)', () => {
    const guard = createSaveGuard();
    guard.markSaved('/path/to/file.md');
    // First check
    expect(guard.shouldSkip('/path/to/file.md')).toBe(true);
    // Second check (OS fires another event) — still skipped
    expect(guard.shouldSkip('/path/to/file.md')).toBe(true);
  });
});
