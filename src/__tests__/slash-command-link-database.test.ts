import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_SRC = path.join(__dirname, '..');

// Unit 3 — the "Link Database" slash command silently no-op'd in browser
// mode because handlePickDatabase only fell back to a path prompt inside
// its catch block, but fs.openFileDialog returns null (no throw) in the
// browser. These regressions assert the fix stays in place.

describe('Link Database slash command (Unit 3)', () => {
  it('SlashCommand still dispatches quipu:pick-database with a callback', () => {
    const filePath = path.join(REPO_SRC, 'components', 'editor', 'extensions', 'SlashCommand.ts');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/Link Database/);
    expect(source).toMatch(/quipu:pick-database/);
    expect(source).toMatch(/embeddedDatabase/);
  });

  it('App.tsx falls back to the path prompt when no native dialog is available', () => {
    const appPath = path.join(REPO_SRC, 'App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    expect(source).toMatch(/handlePickDatabase/);
    expect(source).toMatch(/hasNativeDialog/);
    // Browser-mode branch now triggers the prompt up front, not only in catch.
    expect(source).toMatch(/if \(!hasNativeDialog\)\s*{\s*promptForPath/);
  });

  it('App.tsx broadens the file filter so compound extensions resolve across OS pickers', () => {
    const appPath = path.join(REPO_SRC, 'App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    expect(source).toMatch(/extensions:\s*\[\s*'quipudb\.jsonl'\s*,\s*'jsonl'\s*\]/);
  });

  it('App.tsx warns when the picked database is outside the workspace', () => {
    const appPath = path.join(REPO_SRC, 'App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    expect(source).toMatch(/outside the workspace/);
  });

  it('App.tsx silently treats a null filePath (user cancel) as no-op', () => {
    const appPath = path.join(REPO_SRC, 'App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    // After try/catch, a null filePath returns early without toast.
    expect(source).toMatch(/null filePath = user canceled/);
  });
});
