import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_SRC = path.join(__dirname, '..');

describe('EmbeddedDatabase layout (Unit 2)', () => {
  it('the JS-driven full-bleed hack is gone — CSS owns sizing now', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedDatabase.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).not.toMatch(/ResizeObserver/);
    expect(source).not.toMatch(/updateFullBleed/);
    expect(source).not.toMatch(/style\.marginLeft/);
  });

  it('exposes a change-source menu that reuses the existing pick-database event', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedDatabase.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/Change source database/);
    expect(source).toMatch(/quipu:pick-database/);
    // setNodeMarkup is how we mutate the TipTap node attribute when the user
    // picks a different database file.
    expect(source).toMatch(/setNodeMarkup/);
  });

  it('keeps the open-standalone affordance', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedDatabase.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/quipu:open-embedded-database/);
  });

  it('still serializes to ![[src]] markdown', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'EmbeddedDatabase.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/state\.write\(`!\[\[\$\{src\}\]\]/);
  });

  it('prosemirror.css uses the new full-width rule, not the old negative-margin hack', () => {
    const cssPath = path.join(REPO_SRC, 'styles', 'prosemirror.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).not.toMatch(/margin-left:\s*-40px/);
    expect(css).toMatch(/\.embedded-database-wrapper\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.embedded-database-header\b/);
    expect(css).toMatch(/\.embedded-database-menu-popup\b/);
  });
});
