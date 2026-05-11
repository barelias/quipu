import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_SRC = path.join(__dirname, '..');

// Unit 11 — installFrameSkills installs `frame`, `mdx`, and `quipudb` skill
// templates. The installer body is a single async function with inline
// template strings; we verify it by scanning the source so the test stays
// independent of the dual-runtime fs adapter.

describe('claudeInstaller — skill templates (Unit 11)', () => {
  it('defines MDX and QUIPUDB skill templates', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    expect(source).toMatch(/const\s+MDX_SKILL\s*=/);
    expect(source).toMatch(/const\s+QUIPUDB_SKILL\s*=/);
  });

  it('writes all three skill files in installFrameSkills', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    expect(source).toMatch(/skillsDir \+ '\/frame\.md',\s*content:\s*FRAME_SKILL/);
    expect(source).toMatch(/skillsDir \+ '\/mdx\.md',\s*content:\s*MDX_SKILL/);
    expect(source).toMatch(/skillsDir \+ '\/quipudb\.md',\s*content:\s*QUIPUDB_SKILL/);
  });

  it('MDX skill documents the curated component palette', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    // Pull just the MDX_SKILL template string and check it lists every
    // component that index.ts exposes.
    const match = source.match(/const MDX_SKILL = `([\s\S]*?)`;\n/);
    expect(match, 'MDX_SKILL template should be present').toBeTruthy();
    const body = match![1];
    for (const name of ['Card', 'Callout', 'Badge', 'Stat', 'Row', 'Col']) {
      expect(body, `MDX skill should mention <${name}>`).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('QUIPUDB skill documents schema-line format and link column', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'services', 'claudeInstaller.ts'), 'utf-8');
    const match = source.match(/const QUIPUDB_SKILL = `([\s\S]*?)`;\n/);
    expect(match, 'QUIPUDB_SKILL template should be present').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/_schema/);
    expect(body).toMatch(/_id/);
    expect(body).toMatch(/\blink\b/);
  });
});

describe('Quipu system prompt — Rich rendering (Unit 11)', () => {
  it('appends a Rich rendering section to buildQuipuContextPrompt', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'context', 'AgentContext.tsx'), 'utf-8');
    expect(source).toMatch(/## Rich rendering/);
    expect(source).toMatch(/```mdx/);
    expect(source).toMatch(/```quipudb\.jsonl/);
    expect(source).toMatch(/Card.*Callout.*Badge.*Stat.*Row.*Col/);
  });

  it('explicitly tells the agent to prefer quipudb.jsonl for tabular data', () => {
    const source = fs.readFileSync(path.join(REPO_SRC, 'context', 'AgentContext.tsx'), 'utf-8');
    expect(source).toMatch(/Prefer .* quipudb\.jsonl over markdown tables/);
  });
});
