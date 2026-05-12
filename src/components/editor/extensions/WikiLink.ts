import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      onOpen: null as ((path: string) => void) | null,
    };
  },

  addAttributes() {
    return {
      path: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-wiki-link'),
      },
      label: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) => element.textContent || null,
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
        serialize(state: any, node: any) {
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
          handleClick(view: EditorView, pos: number, event: MouseEvent) {
            const target = event.target as HTMLElement;
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
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
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

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

/**
 * Convert [[path|label]] and ![[path]] in markdown text to HTML for
 * TipTap parsing.
 *
 *   [[file.quipudb.jsonl]]  -> embeddedDatabase node
 *   [[file.mdx]]            -> embeddedMdx node
 *   ![[file.quipudb.jsonl]] -> embeddedDatabase node (same; bang is just
 *                              the explicit "embed me" syntax)
 *   ![[file.mdx]]           -> embeddedMdx node
 *   [[file|label]]          -> wikiLink with label (for non-embeddable
 *                              file types only)
 *   [[file]]                -> wikiLink with file as path + label
 *
 * Both `![[..]]` and `[[..]]` route to embed nodes when the target ends
 * in `.quipudb.jsonl` or `.mdx`. A plain text reference to a database
 * was strictly less useful than the embed (you can always click the
 * embed header to open the file standalone), so we treat all wikilinks
 * to those file types as embeds — the bang prefix is preserved purely
 * for back-compat with serialized markdown.
 */
export function wikiLinksToHTML(text: string): string {
  return text.replace(/!?\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    // The |label form is only meaningful for non-embed wikilinks. For
    // embeds we ignore it because the embed renders the file's own
    // content as the visible surface.
    const pipeIdx = inner.indexOf('|');
    const rawPath = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
    const label = pipeIdx >= 0 ? inner.substring(pipeIdx + 1) : inner;
    const path = rawPath.trim();
    const safe = escapeAttr(path);

    if (/\.quipudb\.jsonl$/i.test(path)) {
      return `<div data-type="embedded-database" data-src="${safe}"></div>`;
    }
    if (/\.mdx$/i.test(path)) {
      return `<div data-type="embedded-mdx" data-src="${safe}"></div>`;
    }
    return `<span data-wiki-link="${safe}" class="wiki-link">${label}</span>`;
  });
}
