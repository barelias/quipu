import { describe, it, expect } from 'vitest';
import { isMdxFile } from '@/utils/fileTypes';
import mdxViewerDescriptor from '@/extensions/mdx-viewer';
import type { Tab } from '@/types/tab';

function tab(name: string, extras: Partial<Tab> = {}): Tab {
  return {
    id: 'test',
    path: `/ws/${name}`,
    name,
    content: '',
    tiptapJSON: null,
    isDirty: false,
    isQuipu: false,
    isMarkdown: false,
    scrollPosition: 0,
    frontmatter: null,
    frontmatterRaw: null,
    diskContent: null,
    frontmatterCollapsed: true,
    ...extras,
  } as Tab;
}

describe('isMdxFile (Unit 2)', () => {
  it('matches .mdx files case-insensitively', () => {
    expect(isMdxFile('notes.mdx')).toBe(true);
    expect(isMdxFile('Notes.MDX')).toBe(true);
    expect(isMdxFile('dir/sub/notes.mdx')).toBe(true);
  });

  it('rejects unrelated extensions', () => {
    expect(isMdxFile('notes.md')).toBe(false);
    expect(isMdxFile('notes.markdown')).toBe(false);
    expect(isMdxFile('mdx.txt')).toBe(false);
    expect(isMdxFile('notes')).toBe(false);
  });
});

describe('mdx-viewer extension descriptor (Unit 2)', () => {
  it('identifies itself as "mdx-viewer"', () => {
    expect(mdxViewerDescriptor.id).toBe('mdx-viewer');
  });

  it('claims .mdx files via canHandle', () => {
    expect(mdxViewerDescriptor.canHandle(tab('notes.mdx'), null)).toBe(true);
  });

  it('does NOT claim .md files (so the TipTap editor still owns them)', () => {
    expect(mdxViewerDescriptor.canHandle(tab('notes.md'), null)).toBe(false);
  });

  it('does NOT claim .quipudb.jsonl files', () => {
    expect(mdxViewerDescriptor.canHandle(tab('tasks.quipudb.jsonl'), null)).toBe(false);
  });

  it('returns tab.content from onSave so save flow round-trips text', async () => {
    const t = tab('notes.mdx', { content: '# Hello\n\n<Card>body</Card>' });
    const out = await mdxViewerDescriptor.onSave!(t, null);
    expect(out).toBe('# Hello\n\n<Card>body</Card>');
  });

  it('onSave returns null when the tab content is not a string (binary safety)', async () => {
    const t = tab('notes.mdx', { content: { type: 'doc' } as unknown as string });
    const out = await mdxViewerDescriptor.onSave!(t, null);
    expect(out).toBeNull();
  });
});
