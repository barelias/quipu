import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { wikiLinksToHTML } from '@/components/editor/extensions/WikiLink';

const REPO_SRC = path.join(__dirname, '..');

describe('wikiLinksToHTML routing (Unit 5)', () => {
  it('routes ![[..mdx]] to the embeddedMdx node', () => {
    const html = wikiLinksToHTML('![[notes.mdx]]');
    expect(html).toContain('data-type="embedded-mdx"');
    expect(html).toContain('data-src="notes.mdx"');
  });

  it('routes ![[..quipudb.jsonl]] to the embeddedDatabase node', () => {
    const html = wikiLinksToHTML('![[tasks.quipudb.jsonl]]');
    expect(html).toContain('data-type="embedded-database"');
    expect(html).toContain('data-src="tasks.quipudb.jsonl"');
  });

  it('falls back to wiki-link for unknown extensions', () => {
    const html = wikiLinksToHTML('![[unknown.txt]]');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-link="unknown.txt"');
  });

  it('still converts plain [[..]] wiki links', () => {
    const html = wikiLinksToHTML('see [[other-note]] for details');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-link="other-note"');
  });

  it('handles ![[..]] with deeper paths', () => {
    const html = wikiLinksToHTML('![[notes/2026/spec.mdx]]');
    expect(html).toContain('data-type="embedded-mdx"');
    expect(html).toContain('data-src="notes/2026/spec.mdx"');
  });

  it('escapes quotes in the path attribute', () => {
    const html = wikiLinksToHTML('![[evil"name.mdx]]');
    expect(html).toContain('data-src="evil&quot;name.mdx"');
  });
});

describe('EmbeddedMdx node (Unit 5)', () => {
  it('source dispatches quipu:pick-mdx for the change-source action', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedMdx.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/Change source MDX/);
    expect(source).toMatch(/quipu:pick-mdx/);
    expect(source).toMatch(/setNodeMarkup/);
  });

  it('source dispatches quipu:open-embedded-mdx for the open-standalone action', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedMdx.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/quipu:open-embedded-mdx/);
    expect(source).toMatch(/Open standalone/);
  });

  it('serializes to ![[src]] markdown', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedMdx.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/state\.write\(`!\[\[\$\{src\}\]\]/);
  });

  it('renders preview through the shared compileMdxSource helper', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedMdx.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/compileMdxSource/);
    expect(source).toMatch(/MdxErrorBoundary/);
    expect(source).toMatch(/MdxErrorPre/);
  });
});

describe('Slash commands (Unit 5)', () => {
  it('exposes Link MDX and Create MDX entries that dispatch the right events', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'SlashCommand.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/title:\s*'Link MDX'/);
    expect(source).toMatch(/title:\s*'Create MDX'/);
    expect(source).toMatch(/'quipu:pick-mdx'/);
    expect(source).toMatch(/'quipu:create-mdx'/);
  });
});
