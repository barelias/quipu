import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export interface LatexBlockAttrs {
  latex: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    latexBlock: {
      insertLatexBlock: (latex?: string) => ReturnType;
    };
  }
}

/**
 * A block-level LaTeX node. Rendered as a KaTeX-typeset display-mode block.
 * Double-click (or the toolbar button) toggles an inline editor so the user
 * can modify the source; blur or Escape returns to the rendered view.
 */
export const LatexBlock = Node.create({
  name: 'latexBlock',
  group: 'block',
  atom: true,
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex?: string }) => ({ 'data-latex': attrs.latex ?? '' }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-latex-block]' },
      { tag: 'pre.latex-block' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, { 'data-latex-block': 'true' });
    return ['div', attrs, (HTMLAttributes as { 'data-latex'?: string })['data-latex'] ?? ''];
  },

  addCommands() {
    return {
      insertLatexBlock:
        (latex?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex: latex ?? '' },
          }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'latex-block';
      dom.contentEditable = 'false';
      dom.setAttribute('data-latex-block', 'true');

      const preview = document.createElement('div');
      preview.className = 'latex-block-preview';

      const editor_ = document.createElement('textarea');
      editor_.className = 'latex-block-editor';
      editor_.placeholder = 'Enter LaTeX (e.g. \\int_0^1 x^2 \\,dx)';
      editor_.spellcheck = false;
      editor_.value = (node.attrs as LatexBlockAttrs).latex ?? '';
      editor_.style.display = 'none';

      const hint = document.createElement('div');
      hint.className = 'latex-block-hint';
      hint.textContent = 'Click to edit · Esc or click outside to save';

      dom.appendChild(preview);
      dom.appendChild(editor_);
      dom.appendChild(hint);

      const render = (src: string) => {
        const trimmed = src.trim();
        if (!trimmed) {
          preview.innerHTML = '<span class="latex-block-empty">Empty LaTeX block — click to edit</span>';
          return;
        }
        try {
          katex.render(trimmed, preview, {
            displayMode: true,
            throwOnError: false,
            output: 'html',
            errorColor: 'var(--color-error)',
          });
        } catch (err) {
          preview.textContent = `[LaTeX error: ${err instanceof Error ? err.message : 'unknown'}]`;
          preview.classList.add('latex-block-error');
        }
      };

      render(editor_.value);

      const enterEdit = (e?: Event) => {
        e?.stopPropagation();
        preview.style.display = 'none';
        editor_.style.display = 'block';
        editor_.focus();
        if (!editor_.value) editor_.setSelectionRange(0, 0);
      };

      const commit = () => {
        editor_.style.display = 'none';
        preview.style.display = '';
        const value = editor_.value;
        render(value);
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { latex: value }));
          }
        }
      };

      preview.addEventListener('click', enterEdit);
      editor_.addEventListener('blur', commit);
      editor_.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); editor_.blur(); }
        // Allow Enter inside the textarea; Cmd/Ctrl+Enter commits.
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); editor_.blur(); }
      });

      // If the user inserts an empty block, open the editor immediately.
      if (!editor_.value) {
        setTimeout(enterEdit, 0);
      }

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'latexBlock') return false;
          const next = (updatedNode.attrs as LatexBlockAttrs).latex ?? '';
          if (next !== editor_.value) {
            editor_.value = next;
            render(next);
          }
          return true;
        },
        stopEvent: (event) => {
          // Keep mouse/keyboard events from bubbling up to ProseMirror while
          // the user is editing the LaTeX source inline.
          const target = event.target;
          if (target === editor_) return true;
          return target instanceof HTMLElement && dom.contains(target);
        },
      };
    };
  },
});
