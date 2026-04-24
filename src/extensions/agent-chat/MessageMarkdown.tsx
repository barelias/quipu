import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MessageMarkdownProps {
  body: string;
}

export default function MessageMarkdown({ body }: MessageMarkdownProps) {
  const html = useMemo(() => {
    const raw = marked.parse(body ?? '', { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      // Allow katex-rendered class markers to survive if the agent itself emits HTML.
      ADD_ATTR: ['data-math', 'data-math-display'],
    });
  }, [body]);

  const ref = (el: HTMLDivElement | null) => {
    if (!el) return;

    // Syntax-highlight fenced code blocks.
    const blocks = el.querySelectorAll<HTMLElement>('pre code');
    blocks.forEach((block) => {
      if (block.dataset.highlighted === 'true') return;
      try {
        hljs.highlightElement(block);
        block.dataset.highlighted = 'true';
      } catch {
        /* swallow — leave block unstyled */
      }
    });

    // Render LaTeX math. Walk the text nodes to find $$...$$ and $...$
    // sequences (skipping code blocks so math-looking shell args aren't eaten).
    renderMathInNode(el);
  };

  return <div ref={ref} className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

const MATH_MARKER = 'data-math-rendered';

function renderMathInNode(root: HTMLElement) {
  // Skip if we already processed this element (prevents double-render on streaming updates).
  if (root.getAttribute(MATH_MARKER) === 'true') {
    // still need to handle newly appended chunks — clear flag when body changes
    root.removeAttribute(MATH_MARKER);
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip text inside code blocks, pre, or already-rendered katex.
        let parent = node.parentElement;
        while (parent && parent !== root) {
          const tag = parent.tagName;
          if (tag === 'CODE' || tag === 'PRE' || parent.classList.contains('katex')) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }
        return /\$/.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    },
  );

  const textNodes: Text[] = [];
  let current = walker.nextNode() as Text | null;
  while (current) {
    textNodes.push(current);
    current = walker.nextNode() as Text | null;
  }

  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    const segments = splitMath(text);
    if (segments.length === 1 && segments[0].kind === 'text') continue;
    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (seg.kind === 'text') {
        frag.appendChild(document.createTextNode(seg.value));
      } else {
        const span = document.createElement('span');
        try {
          katex.render(seg.value, span, {
            displayMode: seg.kind === 'block',
            throwOnError: false,
            output: 'html',
          });
        } catch {
          span.textContent = (seg.kind === 'block' ? '$$' : '$') + seg.value + (seg.kind === 'block' ? '$$' : '$');
        }
        frag.appendChild(span);
      }
    }
    node.parentNode?.replaceChild(frag, node);
  }
  root.setAttribute(MATH_MARKER, 'true');
}

type Segment = { kind: 'text' | 'inline' | 'block'; value: string };

/**
 * Split a plain-text run into alternating text / inline-math / block-math
 * segments. Block math ($$...$$) has priority; inline math ($...$) doesn't
 * cross line breaks and must have a non-space char after the opening $.
 */
function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    // Block $$ ... $$
    if (text[i] === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        out.push({ kind: 'block', value: inner });
        i = end + 2;
        continue;
      }
    }
    // Inline $...$ — require the opening $ to be followed by a non-space,
    // non-digit char (to avoid "it costs $5 and $7" being parsed as math).
    if (text[i] === '$' && i + 1 < text.length && !/[\s\d$]/.test(text[i + 1])) {
      const end = text.indexOf('$', i + 1);
      if (end !== -1 && end - i - 1 <= 200 && !text.slice(i + 1, end).includes('\n')) {
        const inner = text.slice(i + 1, end);
        out.push({ kind: 'inline', value: inner });
        i = end + 1;
        continue;
      }
    }
    // Accumulate plain text until the next $.
    const next = text.indexOf('$', i + 1);
    const chunkEnd = next === -1 ? text.length : next;
    out.push({ kind: 'text', value: text.slice(i, chunkEnd) });
    i = chunkEnd;
  }
  // Coalesce adjacent text segments.
  const merged: Segment[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (s.kind === 'text' && last && last.kind === 'text') last.value += s.value;
    else merged.push(s);
  }
  return merged;
}
