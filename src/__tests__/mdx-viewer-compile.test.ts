import { describe, it, expect } from 'vitest';
import { compileMdxSource } from '@/extensions/mdx-runtime/compile';

describe('compileMdxSource (Unit 3)', () => {
  it('returns ok=true with a renderable Content component for valid MDX', async () => {
    const result = await compileMdxSource('# Hello\n\nplain markdown');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.Content).toBe('function');
    }
  });

  it('returns stage=validate when source contains an import statement', async () => {
    const result = await compileMdxSource("import x from 'y'\n\n# Heading");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('validate');
      expect(result.error).toMatch(/imports/);
    }
  });

  it('returns stage=validate when source contains <script>', async () => {
    const result = await compileMdxSource('<script>alert(1)</script>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('validate');
    }
  });

  it('returns stage=compile when source is malformed JSX', async () => {
    const result = await compileMdxSource('<Card><Card>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('compile');
      expect(result.error).toBeTruthy();
    }
  });

  it('accepts an empty source (default empty MDX is valid)', async () => {
    const result = await compileMdxSource('');
    expect(result.ok).toBe(true);
  });
});
