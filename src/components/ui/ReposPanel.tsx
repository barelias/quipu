import { useMemo, useState } from 'react';
import {
  PlusIcon,
  GitForkIcon,
  PencilSimpleIcon,
  FolderPlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTab } from '../../context/TabContext';
import { useRepo } from '../../context/RepoContext';
import { useToast } from './Toast';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import PromptDialog from './PromptDialog';
import { TreeFolder } from './TreeFolder';
import { buildTree, getRootItems } from '../../lib/buildTree';
import type { Repo } from '@/types/agent';

const DRAG_MIME = 'application/x-quipu-repo';
const ROOT_DRAG_KEY = '__root__';

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

type PromptState =
  | { mode: 'create-folder'; parent: string }
  | { mode: 'rename-folder'; oldPath: string };

export default function ReposPanel() {
  const { openRepoEditorTab } = useTab();
  const {
    repos, folders, upsertRepo, deleteRepo,
    createFolder, deleteFolder, renameFolder,
  } = useRepo();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const closeMenu = () => setMenu(null);

  const { tree, rootItems } = useMemo(() => {
    const tree = buildTree<Repo>(repos, folders);
    const rootItems = getRootItems(repos);
    return { tree, rootItems };
  }, [repos, folders]);

  const handleNew = () => {
    openRepoEditorTab(crypto.randomUUID(), 'New repo');
  };

  const handleNewFolder = (parent: string = '') => setPrompt({ mode: 'create-folder', parent });
  const handleRenameFolder = (oldPath: string) => setPrompt({ mode: 'rename-folder', oldPath });

  const handlePromptConfirm = async (value: string) => {
    if (!prompt) return;
    const trimmed = value.trim();
    if (!trimmed) { setPrompt(null); return; }
    if (prompt.mode === 'create-folder') {
      const segment = slugifySegment(trimmed);
      if (segment === '') {
        showToast(`"${trimmed}" is not a valid folder name.`, 'error');
        setPrompt(null);
        return;
      }
      const fullPath = prompt.parent ? `${prompt.parent}/${segment}` : segment;
      await createFolder(fullPath);
    } else {
      const segment = slugifySegment(trimmed);
      if (segment === '') {
        showToast(`"${trimmed}" is not a valid folder name.`, 'error');
        setPrompt(null);
        return;
      }
      const slashIdx = prompt.oldPath.lastIndexOf('/');
      const parent = slashIdx === -1 ? '' : prompt.oldPath.slice(0, slashIdx);
      const newPath = parent ? `${parent}/${segment}` : segment;
      if (newPath !== prompt.oldPath) {
        await renameFolder(prompt.oldPath, newPath);
      }
    }
    setPrompt(null);
  };

  const handleDeleteRepo = async (repo: Repo) => {
    if (!window.confirm(`Delete "${repo.name}"?`)) return;
    try {
      await deleteRepo(repo.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  const handleDeleteFolder = async (path: string, directCount: number) => {
    const msg = directCount > 0
      ? `Delete folder "${path}" and the ${directCount} repo${directCount === 1 ? '' : 's'} directly inside?`
      : `Delete folder "${path}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteFolder(path, { removeClones: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  // ---------- context menus ----------
  const openPanelMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New repo', onClick: () => { closeMenu(); handleNew(); } },
        { separator: true },
        { label: 'New folder', onClick: () => { closeMenu(); handleNewFolder(''); } },
      ],
    });
  };
  const openFolderMenu = (e: React.MouseEvent, path: string, directCount: number) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New folder here', onClick: () => { closeMenu(); handleNewFolder(path); } },
        { separator: true },
        { label: 'Rename folder', onClick: () => { closeMenu(); handleRenameFolder(path); } },
        { label: 'Delete folder', danger: true, onClick: () => { closeMenu(); handleDeleteFolder(path, directCount); } },
      ],
    });
  };
  const openRowMenu = (e: React.MouseEvent, repo: Repo) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Edit', onClick: () => { closeMenu(); openRepoEditorTab(repo.id, repo.name); } },
        { label: 'Remove from folder', disabled: !repo.folder, onClick: () => { closeMenu(); upsertRepo({ ...repo, folder: undefined, updatedAt: new Date().toISOString() }); } },
        { separator: true },
        { label: 'Delete', danger: true, onClick: () => { closeMenu(); void handleDeleteRepo(repo); } },
      ],
    });
  };

  // ---------- drag & drop ----------
  const onDragStart = (e: React.DragEvent, repo: Repo) => {
    e.dataTransfer.setData(DRAG_MIME, repo.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOverZone = (e: React.DragEvent, key: string) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== key) setDragOver(key);
  };
  const onDropZone = (e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id) return;
    const repo = repos.find((r) => r.id === id);
    if (!repo) return;
    if ((repo.folder ?? '') === folderPath) return;
    upsertRepo({
      ...repo,
      folder: folderPath || undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  const emptyState = repos.length === 0 && folders.length === 0;
  const isDraggingOverRoot = dragOver === ROOT_DRAG_KEY;

  return (
    <div
      className="flex flex-col h-full bg-bg-surface text-text-primary"
      onContextMenu={openPanelMenu}
    >
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Repos</span>
        <div className="flex items-center gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={() => handleNewFolder('')}
            aria-label="New repos folder"
            title="New repos folder"
          >
            <FolderPlusIcon size={14} />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={handleNew}
            aria-label="Add repo"
            title="Add repo"
          >
            <PlusIcon size={14} />
          </button>
        </div>
      </div>

      {emptyState ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <GitForkIcon size={28} className="text-text-tertiary mb-2" weight="light" />
          <p className="text-xs text-text-secondary mb-1">No repos yet.</p>
          <p className="text-[11px] text-text-tertiary mb-3">
            Add git repositories to bind as agent context. Each agent clones them into its own
            scratch dir at <code className="text-accent">tmp/&lt;agent-id&gt;/repos/</code>.
          </p>
          <button
            className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors"
            onClick={handleNew}
          >
            Add repo
          </button>
        </div>
      ) : (
        <div
          className={`flex-1 overflow-auto py-1 ${isDraggingOverRoot ? 'bg-accent/5' : ''}`}
          onDragOver={(e) => onDragOverZone(e, ROOT_DRAG_KEY)}
          onDrop={(e) => onDropZone(e, '')}
        >
          {tree.map((node) => (
            <TreeFolder<Repo>
              key={node.path}
              node={node}
              collapsed={collapsed}
              onToggle={(path) => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}
              dragOver={dragOver}
              totalCount={countItemsInNode(node)}
              renderItem={(repo, indentPx) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  indentPx={indentPx}
                  onEdit={() => openRepoEditorTab(repo.id, repo.name)}
                  onContextMenu={(e) => openRowMenu(e, repo)}
                  onDragStart={(e) => onDragStart(e, repo)}
                  onDelete={() => void handleDeleteRepo(repo)}
                />
              )}
              onFolderContextMenu={openFolderMenu}
              onDragOver={onDragOverZone}
              onDrop={(e, path) => { e.preventDefault(); onDropZone(e, path); }}
              emptyHint="Drop repos here"
            />
          ))}

          {rootItems.length > 0 ? (
            rootItems.map((repo) => (
              <RepoRow
                key={repo.id}
                repo={repo}
                indentPx={20}
                onEdit={() => openRepoEditorTab(repo.id, repo.name)}
                onContextMenu={(e) => openRowMenu(e, repo)}
                onDragStart={(e) => onDragStart(e, repo)}
                onDelete={() => void handleDeleteRepo(repo)}
              />
            ))
          ) : tree.length === 0 ? (
            <div
              className={`mx-1 my-1 px-3 py-2 rounded border border-dashed border-border text-[11px] text-text-tertiary text-center ${isDraggingOverRoot ? 'bg-accent/10 border-accent' : ''}`}
              onDragOver={(e) => onDragOverZone(e, ROOT_DRAG_KEY)}
              onDrop={(e) => onDropZone(e, '')}
            >
              Drop here to move to root
            </div>
          ) : null}
        </div>
      )}

      {menu && (
        <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={closeMenu} />
      )}

      <PromptDialog
        open={!!prompt}
        title={
          prompt?.mode === 'rename-folder'
            ? `Rename folder "${prompt.oldPath}"`
            : prompt?.mode === 'create-folder'
              ? prompt.parent
                ? `New folder under "${prompt.parent}"`
                : 'New repos folder'
              : ''
        }
        label="Folder name"
        placeholder="e.g. external"
        defaultValue={prompt?.mode === 'rename-folder' ? leafSegment(prompt.oldPath) : ''}
        confirmLabel={prompt?.mode === 'rename-folder' ? 'Rename' : 'Create'}
        onConfirm={(value) => { void handlePromptConfirm(value); }}
        onCancel={() => setPrompt(null)}
      />
    </div>
  );
}

// ---------- helpers ----------

function slugifySegment(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function leafSegment(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Sum direct + nested item counts. */
function countItemsInNode<T>(node: { items: T[]; children: { items: T[]; children: unknown[] }[] }): number {
  let total = node.items.length;
  for (const child of node.children) {
    total += countItemsInNode(child as { items: T[]; children: { items: T[]; children: unknown[] }[] });
  }
  return total;
}

// ---------- row ----------
interface RepoRowProps {
  repo: Repo;
  indentPx: number;
  onEdit: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function RepoRow({ repo, indentPx, onEdit, onDelete, onContextMenu, onDragStart }: RepoRowProps) {
  return (
    <div
      className="group flex items-center gap-1 h-8 pr-2 mx-1 rounded hover:bg-bg-elevated"
      style={{ paddingLeft: `${indentPx}px` }}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      <button
        className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm"
        onClick={onEdit}
        title={repo.url || repo.name}
      >
        <GitForkIcon size={13} className="text-text-tertiary shrink-0" />
        <span className="truncate">{repo.name}</span>
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
        onClick={onEdit}
        aria-label={`Edit ${repo.name}`}
        title="Edit"
      >
        <PencilSimpleIcon size={13} />
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error hover:bg-bg-elevated transition-opacity"
        onClick={onDelete}
        aria-label={`Delete ${repo.name}`}
        title="Delete"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}
