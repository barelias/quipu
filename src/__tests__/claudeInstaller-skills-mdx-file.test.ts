import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_SRC = path.join(__dirname, '..');

describe('mdx skill template — .mdx file type section (Unit 6)', () => {
  it('MDX_SKILL documents that .mdx is a workspace file type', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    const match = source.match(/const MDX_SKILL = `([\s\S]*?)`;\n/);
    expect(match).toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/Working with \.mdx files in the workspace/);
    expect(body).toMatch(/split-pane viewer/);
    expect(body).toMatch(/!\[\[notes\/q2-status\.mdx\]\]/);
    expect(body).toMatch(/auto-refresh/);
  });

  it('MDX_SKILL preserves the existing chat-rendering documentation', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    const match = source.match(/const MDX_SKILL = `([\s\S]*?)`;\n/);
    expect(match).toBeTruthy();
    const body = match![1];
    for (const component of ['Card', 'Callout', 'Badge', 'Stat', 'Row', 'Col', 'LineChart', 'BarChart']) {
      expect(body).toMatch(new RegExp(`\\b${component}\\b`));
    }
  });
});

describe('system prompt — .mdx file type sentence (Unit 6)', () => {
  it('mentions .mdx as a workspace file type with chart auto-refresh and inline embed', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'context', 'AgentContext.tsx'), 'utf-8');
    // The body sits inside a template literal so the backticks around
    // `.mdx` are escaped (`\``). Match the escaped form.
    expect(source).toMatch(/\\`\.mdx\\`\s+is also a workspace file type/);
    expect(source).toMatch(/auto-refresh/);
    expect(source).toMatch(/!\[\[notes\.mdx\]\]/);
  });
});
