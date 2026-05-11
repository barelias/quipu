import { describe, it, expect } from 'vitest';
import { validateMdxSource } from '@/extensions/agent-chat/mdx-components';

describe('validateMdxSource — chat MDX sandbox (Unit 10)', () => {
  it('accepts ordinary mdx with curated components', () => {
    expect(validateMdxSource('<Card title="Hi">Body</Card>')).toBeNull();
    expect(validateMdxSource('# Heading\n\nSome **markdown**.')).toBeNull();
  });

  it('rejects import statements', () => {
    expect(validateMdxSource("import x from 'whatever'")).toMatch(/imports/);
    expect(validateMdxSource('  import x from "y"')).toMatch(/imports/);
  });

  it('rejects export statements', () => {
    expect(validateMdxSource('export const x = 1')).toMatch(/exports/);
  });

  it('rejects dangerouslySetInnerHTML and __html', () => {
    expect(validateMdxSource('<div dangerouslySetInnerHTML={{__html: "x"}} />')).toMatch(/dangerouslySetInnerHTML/);
    expect(validateMdxSource('<div { __html: "y" } />')).toMatch(/__html/);
  });

  it('rejects <script> tags', () => {
    expect(validateMdxSource('<script>alert(1)</script>')).toMatch(/script/);
    expect(validateMdxSource('< Script>x')).toMatch(/script/i);
  });

  it('allows the word "import" inside content (not as a statement)', () => {
    // Statement form requires `import ` at the start of a line (after
    // optional whitespace). Inline usage is fine.
    expect(validateMdxSource('Use the `import` keyword in JS.')).toBeNull();
  });
});
