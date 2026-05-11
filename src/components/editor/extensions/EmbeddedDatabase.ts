import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import React from 'react';
import fs from '../../../services/fileSystem';

/**
 * TipTap node for inline-embedded databases. Renders a live interactive
 * DatabaseViewer inside the document. Serializes to markdown as
 * `![[path/to/file.quipudb.jsonl]]`.
 *
 * Layout is CSS-only — see `.embedded-database-wrapper` in prosemirror.css.
 * The embed lives inside the document column; horizontal overflow scrolls
 * inside the database container instead of the document.
 *
 * The header bar shows the database's display name and a "..." menu for
 * Change source / Open standalone. Changing the source mutates the node's
 * `src` attribute; TipTap re-creates the node view, which remounts the
 * React root with the new file.
 */
export const EmbeddedDatabase = Node.create({
  name: 'embeddedDatabase',
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
    return [{ tag: 'div[data-type="embedded-database"]' }];
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
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'embedded-database-wrapper';
      wrapper.setAttribute('data-type', 'embedded-database');
      wrapper.contentEditable = 'false';

      const src = node.attrs.src as string;
      const fileName = src?.split('/').pop() || 'database';
      const displayName = fileName.replace('.quipudb.jsonl', '');

      // Header
      const header = document.createElement('div');
      header.className = 'embedded-database-header';

      const icon = document.createElement('span');
      icon.style.opacity = '0.5';
      icon.style.flexShrink = '0';
      icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M224,48H32A8,8,0,0,0,24,56V200a8,8,0,0,0,8,8H224a8,8,0,0,0,8-8V56A8,8,0,0,0,224,48Zm-8,16V96H40V64ZM40,112H88v32H40Zm0,48H88v32H40Zm176,32H104V112H216Zm0-80H104V80H216Z"/>
        </svg>`;
      header.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'embedded-database-header-name';
      name.textContent = displayName;
      name.title = src ? `Click to open ${src}` : 'Click to open database';
      name.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('quipu:open-embedded-database', { detail: { src } }));
      });
      header.appendChild(name);

      // Dropdown menu
      const menuContainer = document.createElement('div');
      menuContainer.className = 'embedded-database-header-menu';

      const menuButton = document.createElement('button');
      menuButton.className = 'embedded-database-header-button';
      menuButton.setAttribute('aria-label', 'Database options');
      menuButton.title = 'Database options';
      menuButton.textContent = '⋯'; // horizontal ellipsis (⋯)
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
        popup.className = 'embedded-database-menu-popup';

        const refreshItem = document.createElement('button');
        refreshItem.type = 'button';
        refreshItem.className = 'embedded-database-menu-item';
        refreshItem.textContent = 'Refresh from disk';
        refreshItem.addEventListener('click', () => {
          closeMenu();
          remountDatabaseViewer();
        });
        popup.appendChild(refreshItem);

        const changeItem = document.createElement('button');
        changeItem.type = 'button';
        changeItem.className = 'embedded-database-menu-item';
        changeItem.textContent = 'Change source database…';
        changeItem.addEventListener('click', () => {
          closeMenu();
          window.dispatchEvent(new CustomEvent('quipu:pick-database', {
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
        openItem.className = 'embedded-database-menu-item';
        openItem.textContent = 'Open standalone';
        openItem.addEventListener('click', () => {
          closeMenu();
          window.dispatchEvent(new CustomEvent('quipu:open-embedded-database', { detail: { src } }));
        });
        popup.appendChild(openItem);

        menuContainer.appendChild(popup);
        document.addEventListener('mousedown', handleOutsideClick);
      };

      menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu();
      });

      header.appendChild(menuContainer);
      wrapper.appendChild(header);

      // React container for DatabaseViewer
      const reactContainer = document.createElement('div');
      wrapper.appendChild(reactContainer);

      // Mount DatabaseViewer; refresh = unmount the current root (deferred,
      // same micro-task pattern as destroy) then remount from disk.
      let root: Root | null = null;
      const remountDatabaseViewer = () => {
        const prev = root;
        root = null;
        if (prev) queueMicrotask(() => { try { prev.unmount(); } catch { /* */ } });
        mountDatabaseViewer(src, reactContainer).then(mountedRoot => {
          root = mountedRoot;
        });
      };
      remountDatabaseViewer();

      return {
        dom: wrapper,
        contentDOM: undefined,
        destroy() {
          closeMenu();
          // Defer the unmount — TipTap fires this callback during
          // React's commit phase. A synchronous root.unmount() trips
          // React's "Attempted to synchronously unmount a root while
          // React was already rendering" warning. The host element is
          // gone by the time the microtask runs.
          const r = root;
          root = null;
          if (r) queueMicrotask(() => { try { r.unmount(); } catch { /* */ } });
        },
      };
    };
  },
});

async function mountDatabaseViewer(src: string, container: HTMLElement): Promise<Root | null> {
  const workspaceEl = document.querySelector('[data-workspace-path]') as HTMLElement | null;
  const workspacePath = workspaceEl?.dataset.workspacePath;
  const fullPath = workspacePath && !src.startsWith('/') ? `${workspacePath}/${src}` : src;

  let content: string;
  try {
    content = await fs.readFile(fullPath);
  } catch {
    container.innerHTML = `<div style="padding:16px;text-align:center;opacity:0.4;font-size:13px">Could not load database</div>`;
    return null;
  }

  const { default: DatabaseViewer } = await import('@/extensions/database-viewer/DatabaseViewer');

  const onContentChange = async (newContent: string) => {
    try {
      await fs.writeFile(fullPath, newContent);
    } catch {
      // silently fail — inline edits are best-effort
    }
  };

  const root = createRoot(container);
  root.render(
    React.createElement(DatabaseViewer, {
      content,
      onContentChange,
      mode: 'inline',
      // Pass the resolved full path so link cells can resolve sibling
      // folders for relative-mode links.
      databaseFilePath: fullPath,
    }),
  );
  return root;
}
