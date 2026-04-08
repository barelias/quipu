import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * TipTap node extension for inline-embedded databases.
 * Renders as a block in the editor, serializes to markdown as:
 *   ![[path/to/file.quipudb.jsonl]]
 */
export const EmbeddedDatabase = Node.create({
  name: 'embeddedDatabase',
  group: 'block',
  atom: true, // Not editable inline — treated as a single unit

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-src'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-src': attributes.src,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-database"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'embedded-database',
      'class': 'embedded-database-node',
    }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: ProseMirrorNode) {
          const src = node.attrs.src || '';
          state.write(`![[${src}]]\n\n`);
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'embedded-database-wrapper my-4 rounded-lg border border-border/30 overflow-hidden';
      wrapper.setAttribute('data-type', 'embedded-database');
      wrapper.contentEditable = 'false';

      const src = node.attrs.src as string;
      const fileName = src?.split('/').pop() || 'database';
      const displayName = fileName.replace('.quipudb.jsonl', '');

      // Header bar
      const header = document.createElement('div');
      header.className = 'flex items-center gap-2 px-4 py-2 bg-page-text/[0.03] border-b border-border/20 text-sm';
      header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" class="text-page-text/40 shrink-0">
          <path d="M224,48H32A8,8,0,0,0,24,56V200a8,8,0,0,0,8,8H224a8,8,0,0,0,8-8V56A8,8,0,0,0,224,48Zm-8,16V96H40V64ZM40,112H88v32H40Zm0,48H88v32H40Zm176,32H104V112H216Zm0-80H104V80H216Z"/>
        </svg>
        <span class="text-page-text/70 font-medium">${displayName}</span>
        <span class="text-page-text/30 text-xs ml-auto">${src}</span>
      `;
      wrapper.appendChild(header);

      // Placeholder for the database content
      const content = document.createElement('div');
      content.className = 'embedded-database-content p-4 text-sm text-page-text/50 text-center';
      content.textContent = 'Database view loads when you open this file separately';

      // Make it clickable to open the database file
      content.style.cursor = 'pointer';
      content.addEventListener('click', () => {
        // Dispatch custom event that Editor.tsx can listen to
        const event = new CustomEvent('quipu:open-embedded-database', {
          detail: { src },
        });
        window.dispatchEvent(event);
      });

      wrapper.appendChild(content);

      return {
        dom: wrapper,
        contentDOM: undefined,
      };
    };
  },
});
