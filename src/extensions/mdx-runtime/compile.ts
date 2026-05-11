import type { ComponentType } from 'react';
import { MDX_COMPONENTS, validateMdxSource } from './index';

/**
 * Result of compiling an MDX source string. Either a renderable Content
 * component (success) or a structured error the caller can route to the
 * shared MdxErrorPre. Used by both the chat block and the standalone
 * MDX viewer's preview pane so the failure shape is consistent.
 */
export type CompileResult =
  | { ok: true; Content: ComponentType }
  | { ok: false; stage: 'validate' | 'compile'; error: string };

/**
 * Compile an MDX source through validation + @mdx-js/mdx evaluate(),
 * binding the curated component map. Lazy-loads @mdx-js/mdx and the
 * React jsx-runtime so callers don't pull the compiler into their
 * startup bundle.
 */
export async function compileMdxSource(source: string): Promise<CompileResult> {
  const rejection = validateMdxSource(source);
  if (rejection) {
    return { ok: false, stage: 'validate', error: rejection };
  }
  try {
    const [{ evaluate }, jsxRuntime] = await Promise.all([
      import('@mdx-js/mdx'),
      import('react/jsx-runtime'),
    ]);
    const mod = await evaluate(source, {
      ...(jsxRuntime as any),
      useMDXComponents: () => MDX_COMPONENTS,
    });
    return { ok: true, Content: mod.default as ComponentType };
  } catch (err) {
    return {
      ok: false,
      stage: 'compile',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
