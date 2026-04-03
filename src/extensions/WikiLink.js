import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      onOpen: null,
    };
  },

  addAttributes() {
    return {
      path: {
        default: null,
        parseHTML: element => element.getAttribute('data-wiki-link'),
      },
      label: {
        default: null,
        parseHTML: element => element.textContent || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.label || node.attrs.path;
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wiki-link': node.attrs.path,
      'class': 'wiki-link',
      'title': node.attrs.path,
    }), label];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const { path, label } = node.attrs;
          if (label && label !== path) {
            state.write(`[[${path}|${label}]]`);
          } else {
            state.write(`[[${path}]]`);
          }
        },
        parse: {},
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;
    const wikiLinkType = this.type;

    return [
      // Click handler for wiki links
      new Plugin({
        key: new PluginKey('wikiLinkClick'),
        props: {
          handleClick(view, pos, event) {
            const target = event.target;
            if (target.classList?.contains('wiki-link')) {
              const path = target.getAttribute('data-wiki-link');
              if (path && extensionThis.options.onOpen) {
                event.preventDefault();
                extensionThis.options.onOpen(path);
                return true;
              }
            }
            return false;
          },
        },
      }),
      // Text input handler: when user types `]`, check if we have `[[...]]` pattern
      new Plugin({
        key: new PluginKey('wikiLinkInput'),
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ']') return false;

            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              0, $from.parentOffset, undefined, '\ufffc'
            ) + ']'; // include the `]` being typed

            // Match [[...]] or \[\[...\]\] at the end
            const unescaped = textBefore.match(/\[\[([^\]]+)\]\]$/);
            const escaped = textBefore.match(/\\\[\\\[([^\]\\]+)\\\]\\\]$/);
            const match = unescaped || escaped;
            if (!match) return false;

            const inner = match[1];
            const pipeIdx = inner.indexOf('|');
            const path = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
            const label = pipeIdx >= 0 ? inner.substring(pipeIdx + 1) : null;

            // Calculate the start position of the matched pattern in the document
            const matchLen = match[0].length;
            const blockStart = $from.start();
            const matchStart = blockStart + $from.parentOffset - (matchLen - 1); // -1 because `]` not yet inserted

            const tr = state.tr;
            tr.replaceWith(
              matchStart,
              from, // end is where the cursor is (before the typed `]`)
              wikiLinkType.create({ path, label })
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Convert [[path|label]] in markdown text to HTML spans for TipTap parsing.
 */
export function wikiLinksToHTML(text) {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const pipeIdx = inner.indexOf('|');
    const path = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
    const label = pipeIdx >= 0 ? inner.substring(pipeIdx + 1) : inner;
    return `<span data-wiki-link="${path.replace(/"/g, '&quot;')}" class="wiki-link">${label}</span>`;
  });
}
