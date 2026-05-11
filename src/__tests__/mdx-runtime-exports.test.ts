import { describe, it, expect } from 'vitest';
import { MDX_COMPONENTS, validateMdxSource } from '@/extensions/mdx-runtime';
import { MdxErrorBoundary, MdxErrorPre } from '@/extensions/mdx-runtime/MdxErrorBoundary';
import { compileMdxSource } from '@/extensions/mdx-runtime/compile';
import * as shim from '@/extensions/agent-chat/mdx-components';

// Unit 1 — the curated MDX surface moved out of the chat extension into
// a neutral runtime module. Both the chat block and the new file viewer
// import from `@/extensions/mdx-runtime`. The old path is preserved as a
// thin re-export shim for one or two release cycles.

describe('mdx-runtime exports (Unit 1)', () => {
  it('exposes the full curated component map', () => {
    for (const name of ['Card', 'Callout', 'Badge', 'Stat', 'Row', 'Col']) {
      expect(MDX_COMPONENTS).toHaveProperty(name);
    }
    for (const name of ['LineChart', 'BarChart', 'AreaChart', 'PieChart']) {
      expect(MDX_COMPONENTS).toHaveProperty(name);
    }
    for (const name of ['a', 'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote']) {
      expect(MDX_COMPONENTS).toHaveProperty(name);
    }
  });

  it('exposes validateMdxSource with chat-block behaviour preserved', () => {
    expect(validateMdxSource('<Card>ok</Card>')).toBeNull();
    expect(validateMdxSource('import x from "y"')).toMatch(/imports/);
  });

  it('exposes MdxErrorBoundary and MdxErrorPre', () => {
    expect(MdxErrorBoundary).toBeDefined();
    expect(MdxErrorPre).toBeDefined();
  });

  it('exposes compileMdxSource', () => {
    expect(typeof compileMdxSource).toBe('function');
  });
});

describe('agent-chat/mdx-components shim (Unit 1)', () => {
  it('re-exports MDX_COMPONENTS from the new runtime location', () => {
    expect(shim.MDX_COMPONENTS).toBe(MDX_COMPONENTS);
  });

  it('re-exports validateMdxSource', () => {
    expect(shim.validateMdxSource).toBe(validateMdxSource);
  });
});
