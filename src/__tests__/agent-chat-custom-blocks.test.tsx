import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upgradeCustomCodeBlocks, unmountCustomCodeBlocks } from '@/extensions/agent-chat/CustomCodeBlocks';

// React-DOM's createRoot is awkward inside jsdom without a real frame; we
// mock it so the tests focus on dispatch behaviour (which blocks are
// claimed) rather than React rendering.
const unmountSpy = vi.fn();
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: vi.fn(), unmount: unmountSpy }),
}));

// Stub the placeholders so the dispatcher's dynamic-import edges don't
// pull in real components during the test.
vi.mock('@/extensions/agent-chat/ChatMdxBlock', () => ({ default: () => null }));
vi.mock('@/extensions/agent-chat/ChatDatabaseBlock', () => ({ default: () => null }));

function makeHtml(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

beforeEach(() => {
  unmountSpy.mockClear();
});

describe('upgradeCustomCodeBlocks (Unit 8)', () => {
  it('upgrades mdx fenced blocks', () => {
    const root = makeHtml('<pre><code class="language-mdx">## hi</code></pre>');
    const n = upgradeCustomCodeBlocks(root);
    expect(n).toBe(1);
    expect(root.querySelector('pre')).toBeNull();
    expect(root.querySelector('.agent-custom-block')).toBeTruthy();
  });

  it('upgrades quipudb fenced blocks', () => {
    const root = makeHtml('<pre><code class="language-quipudb">{}\n{}</code></pre>');
    expect(upgradeCustomCodeBlocks(root)).toBe(1);
    expect(root.querySelector('.agent-custom-block')).toBeTruthy();
  });

  it('upgrades quipudb.jsonl variant', () => {
    const root = makeHtml('<pre><code class="language-quipudb.jsonl">{}\n{}</code></pre>');
    expect(upgradeCustomCodeBlocks(root)).toBe(1);
  });

  it('leaves other languages alone for hljs', () => {
    const root = makeHtml('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(upgradeCustomCodeBlocks(root)).toBe(0);
    expect(root.querySelector('pre code.language-js')).toBeTruthy();
  });

  it('handles mixed blocks in one tree', () => {
    const root = makeHtml(`
      <pre><code class="language-mdx">## hi</code></pre>
      <pre><code class="language-js">x</code></pre>
      <pre><code class="language-quipudb">{}</code></pre>
    `);
    expect(upgradeCustomCodeBlocks(root)).toBe(2);
    expect(root.querySelectorAll('.agent-custom-block').length).toBe(2);
    expect(root.querySelectorAll('pre code.language-js').length).toBe(1);
  });

  it('does not double-mount when called twice on the same root', () => {
    const root = makeHtml('<pre><code class="language-mdx">a</code></pre>');
    upgradeCustomCodeBlocks(root);
    const upgradedAgain = upgradeCustomCodeBlocks(root);
    expect(upgradedAgain).toBe(0);
  });
});

describe('unmountCustomCodeBlocks (Unit 8)', () => {
  it('unmounts every tracked root in the subtree', () => {
    const root = makeHtml(`
      <pre><code class="language-mdx">a</code></pre>
      <pre><code class="language-quipudb">b</code></pre>
    `);
    upgradeCustomCodeBlocks(root);
    unmountCustomCodeBlocks(root);
    expect(unmountSpy).toHaveBeenCalledTimes(2);
  });

  it('is safe when no custom blocks are present', () => {
    const root = makeHtml('<p>hello</p>');
    expect(() => unmountCustomCodeBlocks(root)).not.toThrow();
    expect(unmountSpy).not.toHaveBeenCalled();
  });
});
