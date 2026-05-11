import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ChatDatabaseBlock from './ChatDatabaseBlock';
import ChatMdxBlock from './ChatMdxBlock';

/**
 * After marked + DOMPurify produce HTML and React mounts it via
 * dangerouslySetInnerHTML, the chat ref-callback walks the rendered DOM and
 * upgrades select fenced code blocks into live React renders:
 *
 *   ```mdx                  -> <ChatMdxBlock source={...} />
 *   ```quipudb              -> <ChatDatabaseBlock source={...} />
 *   ```quipudb.jsonl        -> <ChatDatabaseBlock source={...} />
 *
 * Order matters: this walk MUST run BEFORE highlight.js, otherwise hljs
 * mutates the <code> className and inserts highlighted spans, which would
 * corrupt source extraction.
 *
 * Roots are tracked in a WeakMap keyed by their container element so that
 * streaming chat updates (which re-render the whole HTML) don't double-mount
 * or leak. Callers should invoke `unmountAllRoots(root)` when the markdown
 * container element changes (body update or component unmount).
 */

type BlockKind = 'mdx' | 'quipudb';

const containerToRoot = new WeakMap<Element, Root>();
const trackedRoots = new Set<Root>();

function detectBlockKind(codeEl: HTMLElement): BlockKind | null {
  const cls = codeEl.className;
  if (/\blanguage-mdx\b/.test(cls)) return 'mdx';
  if (/\blanguage-quipudb(?:\.jsonl)?\b/.test(cls)) return 'quipudb';
  return null;
}

function mountFor(kind: BlockKind, container: HTMLElement, source: string): Root {
  const root = createRoot(container);
  if (kind === 'mdx') {
    root.render(React.createElement(ChatMdxBlock, { source }));
  } else {
    root.render(React.createElement(ChatDatabaseBlock, { source }));
  }
  return root;
}

/**
 * Walk the markdown subtree, replacing `pre code.language-{mdx,quipudb}`
 * elements with React-mounted equivalents. Returns the count of blocks
 * upgraded so callers can tell whether to skip subsequent hljs passes.
 */
export function upgradeCustomCodeBlocks(root: HTMLElement): number {
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre code');
  let upgraded = 0;
  codeBlocks.forEach((code) => {
    const kind = detectBlockKind(code);
    if (!kind) return;
    const pre = code.parentElement;
    if (!pre || !pre.parentElement) return;
    if (pre.dataset.customBlock === 'true') return;

    const source = code.textContent ?? '';
    const wrapper = document.createElement('div');
    wrapper.className = 'agent-custom-block';
    wrapper.dataset.customBlock = 'true';
    pre.parentElement.replaceChild(wrapper, pre);

    const r = mountFor(kind, wrapper, source);
    containerToRoot.set(wrapper, r);
    trackedRoots.add(r);
    upgraded += 1;
  });
  return upgraded;
}

/**
 * Tear down every React root mounted inside `root`. Called when the markdown
 * container is being recreated (streaming body change) or unmounted, to
 * prevent React tree leaks.
 */
export function unmountCustomCodeBlocks(root: HTMLElement): void {
  const wrappers = root.querySelectorAll<HTMLElement>('.agent-custom-block');
  wrappers.forEach((wrapper) => {
    const r = containerToRoot.get(wrapper);
    if (!r) return;
    try {
      r.unmount();
    } catch {
      /* swallow — element already gone */
    }
    containerToRoot.delete(wrapper);
    trackedRoots.delete(r);
  });
}
