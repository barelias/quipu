import { describe, it, expect } from 'vitest';
import { siblingFolderPath, resolveLinkPath } from '@/extensions/database-viewer/components/cells/LinkCell';
import type { LinkColumnDef } from '@/extensions/database-viewer/types';

const globalCol: LinkColumnDef = {
  id: 'notes',
  name: 'Notes',
  type: 'link',
  mode: 'global',
  defaultExtension: '.md',
};

const relCol: LinkColumnDef = {
  id: 'notes',
  name: 'Notes',
  type: 'link',
  mode: 'relative',
  defaultExtension: '.md',
};

describe('siblingFolderPath (Unit 5)', () => {
  it('strips the .quipudb.jsonl suffix', () => {
    expect(siblingFolderPath('/ws/tasks.quipudb.jsonl')).toBe('/ws/tasks');
  });

  it('handles nested directories', () => {
    expect(siblingFolderPath('/ws/projects/2026/q2.quipudb.jsonl')).toBe('/ws/projects/2026/q2');
  });

  it('returns just the stem when no directory', () => {
    expect(siblingFolderPath('tasks.quipudb.jsonl')).toBe('tasks');
  });
});

describe('resolveLinkPath (Unit 5)', () => {
  it('returns null for empty value', () => {
    expect(resolveLinkPath('', globalCol, '/ws/db.quipudb.jsonl', '/ws')).toBeNull();
  });

  it('resolves an absolute value verbatim', () => {
    expect(resolveLinkPath('/abs/path.md', globalCol, '/ws/db.quipudb.jsonl', '/ws')).toBe('/abs/path.md');
  });

  it('joins a global value with the workspace path', () => {
    expect(resolveLinkPath('docs/spec.md', globalCol, '/ws/db.quipudb.jsonl', '/ws')).toBe('/ws/docs/spec.md');
  });

  it('falls back to bare value when no workspace is known', () => {
    expect(resolveLinkPath('docs/spec.md', globalCol, '/ws/db.quipudb.jsonl', null)).toBe('docs/spec.md');
  });

  it('joins a relative value with the sibling folder', () => {
    expect(resolveLinkPath('ship-v1.md', relCol, '/ws/tasks.quipudb.jsonl', '/ws')).toBe('/ws/tasks/ship-v1.md');
  });

  it('returns null for a relative value with no database path', () => {
    expect(resolveLinkPath('ship-v1.md', relCol, null, '/ws')).toBeNull();
  });
});
