import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import fs from '../../../services/fileSystem';

/**
 * TipTap node for inline-embedded MDX. Renders a live compiled MDX
 * preview inside the host document. Serializes to markdown as
 * `![[path/to/notes.mdx]]`.
 *
 * The companion extension `EmbeddedDatabase` handles `.quipudb.jsonl`
 * the same way. Both nodes share `.embedded-*-wrapper` chrome via
 * prosemirror.css.
 *
 * Slash commands ("Link MDX" / "Create MDX") and the wikilink-to-HTML
 * conversion (markdown load path) both route to this node based on the
 * `.mdx` extension.
 */
export const EmbeddedMdx = Node.create({
  name: 'embeddedMdx',
  group: 'block',
  atom: true,

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
    return [{ tag: 'div[data-type="embedded-mdx"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Atom node — must NOT include a content hole (`0`). The hole made
    // ProseMirror's DOMSerializer throw the moment the user dragged or
    // copied the node.
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'embedded-mdx',
      'class': 'embedded-mdx-node',
    })];
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
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'embedded-mdx-wrapper';
      wrapper.setAttribute('data-type', 'embedded-mdx');
      wrapper.contentEditable = 'false';

      // Swallow mousedown so ProseMirror doesn't surface its comment
      // popup or selection toolbar when the user clicks inside the
      // embed. Inner React click handlers still fire — stopPropagation
      // only halts further bubbling above this wrapper.
      wrapper.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

      const src = node.attrs.src as string;
      const fileName = src?.split('/').pop() || 'document.mdx';
      const displayName = fileName.replace(/\.mdx$/i, '');

      // Header
      const header = document.createElement('div');
      header.className = 'embedded-mdx-header';

      const icon = document.createElement('span');
      icon.style.opacity = '0.5';
      icon.style.flexShrink = '0';
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48Z"/>
        </svg>`;
      header.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'embedded-mdx-header-name';
      name.textContent = displayName;
      name.title = src ? `Click to open ${src}` : 'Click to open mdx';
      name.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('quipu:open-embedded-mdx', { detail: { src } }));
      });
      header.appendChild(name);

      // Dropdown menu — mirrors EmbeddedDatabase's "..." menu
      const menuContainer = document.createElement('div');
      menuContainer.className = 'embedded-mdx-header-menu';

      const menuButton = document.createElement('button');
      menuButton.className = 'embedded-mdx-header-button';
      menuButton.setAttribute('aria-label', 'MDX options');
      menuButton.title = 'MDX options';
      menuButton.textContent = '⋯';
      menuContainer.appendChild(menuButton);

      let popup: HTMLDivElement | null = null;
      const closeMenu = () => {
        if (popup) {
          popup.remove();
          popup = null;
          document.removeEventListener('mousedown', handleOutsideClick);
        }
      };
      const handleOutsideClick = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (!popup || !target) return;
        if (!popup.contains(target) && !menuButton.contains(target)) {
          closeMenu();
        }
      };

      const openMenu = () => {
        if (popup) {
          closeMenu();
          return;
        }
        popup = document.createElement('div');
        popup.className = 'embedded-mdx-menu-popup';

        const refreshItem = document.createElement('button');
        refreshItem.type = 'button';
        refreshItem.className = 'embedded-mdx-menu-item';
        refreshItem.textContent = 'Refresh from disk';
        refreshItem.addEventListener('click', () => {
          closeMenu();
          remountEmbeddedMdx();
        });
        popup.appendChild(refreshItem);

        const changeItem = document.createElement('button');
        changeItem.type = 'button';
        changeItem.className = 'embedded-mdx-menu-item';
        changeItem.textContent = 'Change source MDX…';
        changeItem.addEventListener('click', () => {
          closeMenu();
          window.dispatchEvent(new CustomEvent('quipu:pick-mdx', {
            detail: {
              callback: (newSrc: string) => {
                if (!newSrc || newSrc === src) return;
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (pos == null || !editor) return;
                editor
                  .chain()
                  .focus()
                  .command(({ tr }) => {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc });
                    return true;
                  })
                  .run();
              },
            },
          }));
        });
        popup.appendChild(changeItem);

        const openItem = document.createElement('button');
        openItem.type = 'button';
        openItem.className = 'embedded-mdx-menu-item';
        openItem.textContent = 'Open standalone';
        openItem.addEventListener('click', () => {
          closeMenu();
          window.dispatchEvent(new CustomEvent('quipu:open-embedded-mdx', { detail: { src } }));
        });
        popup.appendChild(openItem);

        // Append to body so the wrapper's overflow:hidden doesn't clip
        // the popup. Position from the button's screen rect.
        document.body.appendChild(popup);
        const rect = menuButton.getBoundingClientRect();
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.left = `${Math.max(8, rect.right - popup.offsetWidth)}px`;
        document.addEventListener('mousedown', handleOutsideClick);
      };

      menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu();
      });

      header.appendChild(menuContainer);
      wrapper.appendChild(header);

      // React container for the compiled MDX preview
      const reactContainer = document.createElement('div');
      wrapper.appendChild(reactContainer);

      // Mount the preview; refresh = unmount the current root (deferred,
      // matching the destroy() pattern) then remount with a fresh read.
      let root: Root | null = null;
      const remountEmbeddedMdx = () => {
        const prev = root;
        root = null;
        if (prev) queueMicrotask(() => { try { prev.unmount(); } catch { /* */ } });
        mountEmbeddedMdx(src, reactContainer).then(mountedRoot => {
          root = mountedRoot;
        });
      };
      remountEmbeddedMdx();

      return {
        dom: wrapper,
        contentDOM: undefined,
        destroy() {
          closeMenu();
          // Defer the unmount — TipTap fires this callback during
          // React's commit phase (parent unmounting), and a synchronous
          // root.unmount() then trips:
          //   "Attempted to synchronously unmount a root while React was
          //    already rendering."
          // The host element is removed by the time the microtask runs,
          // so the root is already orphaned when we finally unmount.
          const r = root;
          root = null;
          if (r) queueMicrotask(() => { try { r.unmount(); } catch { /* */ } });
        },
      };
    };
  },
});

async function mountEmbeddedMdx(src: string, container: HTMLElement): Promise<Root | null> {
  const workspaceEl = document.querySelector('[data-workspace-path]') as HTMLElement | null;
  const workspacePath = workspaceEl?.dataset.workspacePath;
  const fullPath = workspacePath && !src.startsWith('/') ? `${workspacePath}/${src}` : src;

  let content: string;
  try {
    content = await fs.readFile(fullPath);
  } catch {
    container.innerHTML = `<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Could not load ${src}</div>`;
    return null;
  }

  const [{ compileMdxSource }, { MdxErrorBoundary, MdxErrorPre }, ReactDOMPkg] = await Promise.all([
    import('@/extensions/mdx-runtime/compile'),
    import('@/extensions/mdx-runtime/MdxErrorBoundary'),
    import('react-dom/client'),
  ]);

  const result = await compileMdxSource(content);
  void ReactDOMPkg;
  const root = createRoot(container);

  if (!result.ok) {
    root.render(
      React.createElement(MdxErrorPre, { stage: result.stage, message: result.error, source: content }),
    );
    return root;
  }

  const Content = result.Content;
  root.render(
    React.createElement(
      MdxErrorBoundary,
      { source: content },
      React.createElement(
        'div',
        { className: 'embedded-mdx-body', style: { padding: '0.75rem' } },
        React.createElement(Content),
      ),
    ),
  );
  return root;
}
