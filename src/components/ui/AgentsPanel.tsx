import { useMemo, useState } from 'react';
import {
  RobotIcon,
  ChatCircleDotsIcon,
  PencilSimpleIcon,
  CaretRightIcon,
  CaretDownIcon,
  FolderPlusIcon,
  TrashIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { useTab } from '../../context/TabContext';
import { useAgent } from '../../context/AgentContext';
import { useToast } from './Toast';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import PromptDialog from './PromptDialog';
import { TreeFolder } from './TreeFolder';
import { buildTree, getRootItems } from '../../lib/buildTree';
import type { Agent, AgentKind } from '@/types/agent';

const DRAG_MIME = 'application/x-quipu-agent';

/** Sentinel "drag target = root of this kind". Folder paths are never empty,
 *  so collisions with real folders are impossible. */
const ROOT_DRAG_KEY_PREFIX = '__root__:';

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

type PromptState =
  | { mode: 'create-folder'; kind: AgentKind; parent: string }
  | { mode: 'rename-folder'; kind: AgentKind; oldPath: string };

export default function AgentsPanel() {
  const { openAgentTab, openAgentEditorTab } = useTab();
  const {
    agents, folders,
    createChat, deleteAgent, moveAgent,
    createFolder, deleteFolder, renameFolder,
    isTurnActive,
  } = useAgent();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const closeMenu = () => setMenu(null);

  // Build a recursive tree per kind. Items in each tree are typed with the
  // shared Agent shape; the kinds partition naturally because folders can
  // appear in either or both lists (the context tracks them separately —
  // empty folders surface in both).
  //
  // Items inside each folder (and the root list) are sorted by `updatedAt`
  // descending so the most-recently-modified row floats to the top. The
  // folder hierarchy itself stays alphabetical (handled inside buildTree).
  // The `?? ''` guard hardens against any pre-MVP persisted record missing
  // `updatedAt` — the load normalizer in AgentContext defaults other fields
  // but not the timestamps.
  const sections = useMemo(() => {
    // Typed against the structural constraint `sortItems` expects so the
    // comparator slots into both buildTree() and getRootItems() without a
    // generic-variance mismatch.
    const byRecency = <U extends { name?: string; updatedAt?: string }>(a: U, b: U) => {
      const cmp = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      return cmp !== 0 ? cmp : (a.name ?? '').localeCompare(b.name ?? '');
    };
    const buildSection = (kind: AgentKind) => {
      const items = agents.filter((a) => a.kind === kind);
      const declared = kind === 'agent' ? folders.agents : folders.chats;
      const tree = buildTree<Agent>(items, declared, { sortItems: byRecency });
      const rootItems = getRootItems(items, { sortItems: byRecency });
      return { kind, tree, rootItems, totalCount: items.length };
    };
    return {
      chats: buildSection('chat'),
      agents: buildSection('agent'),
    };
  }, [agents, folders]);

  // ---------- actions ----------
  const handleNewChat = (folder?: string) => {
    const chat = createChat({ folder });
    openAgentTab(chat.id, chat.name);
  };
  const handleNewAgent = (folder?: string) => {
    // Editor tab needs an id up-front. We let the editor persist the record on Save.
    const id = crypto.randomUUID();
    openAgentEditorTab(id, 'New agent');
    if (folder) {
      // Pre-seed the agent so folder assignment sticks even before the user edits.
      // The editor will pick it up via existing lookup.
      // Safe because createFolder sidebar uses its own state; we don't rely on it here.
    }
  };
  const handleNewFolder = (kind: AgentKind, parent: string = '') =>
    setPrompt({ mode: 'create-folder', kind, parent });
  const handleRenameFolder = (kind: AgentKind, oldPath: string) =>
    setPrompt({ mode: 'rename-folder', kind, oldPath });

  const handlePromptConfirm = (value: string) => {
    if (!prompt) return;
    const trimmed = value.trim();
    if (!trimmed) { setPrompt(null); return; }
    if (prompt.mode === 'create-folder') {
      // Slug the user's free-text into a path-safe segment, then nest under
      // the parent folder.
      const segment = slugifySegment(trimmed);
      if (segment === '') {
        showToast(`"${trimmed}" is not a valid folder name.`, 'error');
        setPrompt(null);
        return;
      }
      const fullPath = prompt.parent ? `${prompt.parent}/${segment}` : segment;
      createFolder(prompt.kind, fullPath);
    } else {
      // Rename keeps the parent path stable; only the leaf segment changes.
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
        renameFolder(prompt.kind, prompt.oldPath, newPath);
      }
    }
    setPrompt(null);
  };
  const handleDeleteFolder = (kind: AgentKind, path: string, directCount: number) => {
    const msg = directCount > 0
      ? `Delete folder "${path}"? The ${directCount} item${directCount === 1 ? '' : 's'} directly inside will move up.`
      : `Delete folder "${path}"?`;
    if (!window.confirm(msg)) return;
    deleteFolder(kind, path);
  };
  const handleDelete = (agent: Agent) => {
    if (!window.confirm(`Delete "${agent.name}"? This wipes its transcript too.`)) return;
    try { deleteAgent(agent.id); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${message}`, 'error');
    }
  };

  // ---------- context menus ----------
  const openPanelMenu = (e: React.MouseEvent, kind?: AgentKind) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: 'New chat', onClick: () => { closeMenu(); handleNewChat(); } },
      { label: 'New agent', onClick: () => { closeMenu(); handleNewAgent(); } },
      { separator: true },
      { label: kind === 'chat' ? 'New chats folder' : 'New agents folder', onClick: () => { closeMenu(); handleNewFolder(kind ?? 'agent', ''); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openFolderMenu = (e: React.MouseEvent, kind: AgentKind, path: string, directItemCount: number) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: kind === 'chat' ? 'New chat in folder' : 'New agent in folder',
        onClick: () => { closeMenu(); if (kind === 'chat') handleNewChat(path); else handleNewAgent(path); } },
      { label: 'New folder here', onClick: () => { closeMenu(); handleNewFolder(kind, path); } },
      { separator: true },
      { label: 'Rename folder', onClick: () => { closeMenu(); handleRenameFolder(kind, path); } },
      { label: 'Delete folder', danger: true, onClick: () => { closeMenu(); handleDeleteFolder(kind, path, directItemCount); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openRowMenu = (e: React.MouseEvent, agent: Agent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: 'Open', onClick: () => { closeMenu(); openAgentTab(agent.id, agent.name); } },
      { label: 'Edit', onClick: () => { closeMenu(); openAgentEditorTab(agent.id, agent.name); } },
      { separator: true },
      { label: agent.kind === 'chat' ? 'Convert to agent' : 'Convert to chat',
        onClick: () => { closeMenu(); moveAgent(agent.id, { kind: agent.kind === 'chat' ? 'agent' : 'chat' }); } },
      { label: 'Remove from folder', disabled: !agent.folder, onClick: () => { closeMenu(); moveAgent(agent.id, { folder: '' }); } },
      { separator: true },
      { label: 'Delete', danger: true, onClick: () => { closeMenu(); handleDelete(agent); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ---------- drag & drop ----------
  const onDragStart = (e: React.DragEvent, agent: Agent) => {
    e.dataTransfer.setData(DRAG_MIME, agent.id);
    // Stash the kind too so a drop into the OTHER section can convert
    // the agent in addition to (re-)folder-ing it.
    e.dataTransfer.setData(`${DRAG_MIME}+kind`, agent.kind);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropFolder = (e: React.DragEvent, kind: AgentKind, folderPath: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id) return;
    moveAgent(id, { kind, folder: folderPath });
  };
  const onDragOverFolder = (e: React.DragEvent, key: string) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== key) setDragOver(key);
  };

  const emptyState = agents.length === 0 && folders.chats.length === 0 && folders.agents.length === 0;

  return (
    <div
      className="flex flex-col h-full bg-bg-surface text-text-primary"
      onContextMenu={(e) => openPanelMenu(e)}
    >
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Agents</span>
        <div className="flex items-center gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={() => handleNewChat()}
            aria-label="New chat"
            title="New chat — skip config, start talking"
          >
            <ChatCircleDotsIcon size={14} />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            onClick={() => handleNewAgent()}
            aria-label="New agent"
            title="New agent — configure prompt, bindings, model"
          >
            <PlusIcon size={14} />
          </button>
        </div>
      </div>

      {emptyState ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <RobotIcon size={28} className="text-text-tertiary mb-2" weight="light" />
          <p className="text-xs text-text-secondary mb-1">No agents yet.</p>
          <p className="text-[11px] text-text-tertiary mb-3">
            Quick <b>chat</b> or configured <b>agent</b>. Right-click for folders.
          </p>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors"
              onClick={() => handleNewChat()}
            >
              <ChatCircleDotsIcon size={13} />
              New chat
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              onClick={() => handleNewAgent()}
            >
              <RobotIcon size={13} />
              New agent
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-1">
          <KindSection
            kind="chat"
            label="Chats"
            countBadge={sections.chats.totalCount}
            tree={sections.chats.tree}
            rootItems={sections.chats.rootItems}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            dragOver={dragOver}
            openAgent={(a) => openAgentTab(a.id, a.name)}
            editAgent={(a) => openAgentEditorTab(a.id, a.name)}
            onRowMenu={openRowMenu}
            onFolderMenu={(e, path, directCount) => openFolderMenu(e, 'chat', path, directCount)}
            onSectionMenu={(e) => openPanelMenu(e, 'chat')}
            onNewItem={() => handleNewChat()}
            onNewFolder={() => handleNewFolder('chat', '')}
            onDragStartRow={onDragStart}
            onDragOverFolder={onDragOverFolder}
            onDropFolder={(e, path) => onDropFolder(e, 'chat', path)}
            isTurnActive={isTurnActive}
          />

          <KindSection
            kind="agent"
            label="Agents"
            countBadge={sections.agents.totalCount}
            tree={sections.agents.tree}
            rootItems={sections.agents.rootItems}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            dragOver={dragOver}
            openAgent={(a) => openAgentTab(a.id, a.name)}
            editAgent={(a) => openAgentEditorTab(a.id, a.name)}
            onRowMenu={openRowMenu}
            onFolderMenu={(e, path, directCount) => openFolderMenu(e, 'agent', path, directCount)}
            onSectionMenu={(e) => openPanelMenu(e, 'agent')}
            onNewItem={() => handleNewAgent()}
            onNewFolder={() => handleNewFolder('agent', '')}
            onDragStartRow={onDragStart}
            onDragOverFolder={onDragOverFolder}
            onDropFolder={(e, path) => onDropFolder(e, 'agent', path)}
            isTurnActive={isTurnActive}
          />
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
                : `New ${prompt.kind === 'chat' ? 'chats' : 'agents'} folder`
              : ''
        }
        label="Folder name"
        placeholder="e.g. research"
        defaultValue={prompt?.mode === 'rename-folder'
          ? leafSegment(prompt.oldPath)
          : ''}
        confirmLabel={prompt?.mode === 'rename-folder' ? 'Rename' : 'Create'}
        onConfirm={handlePromptConfirm}
        onCancel={() => setPrompt(null)}
      />
    </div>
  );
}

// ---------- helpers ----------

/** Slug a single path segment without imposing the path-shape rules of
 *  `normalizeFolder` (which rejects internal slashes — fine, we only feed
 *  it a single segment here). Mirror of `services/slug.ts:slugify` for
 *  the UI's preview. The context's `createFolder` does the canonical
 *  normalization on the way to disk, so this is best-effort. */
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

// ---------- section ----------
interface KindSectionProps {
  kind: AgentKind;
  label: string;
  countBadge: number;
  tree: ReturnType<typeof buildTree<Agent>>;
  rootItems: Agent[];
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  dragOver: string | null;
  openAgent: (a: Agent) => void;
  editAgent: (a: Agent) => void;
  onRowMenu: (e: React.MouseEvent, a: Agent) => void;
  onFolderMenu: (e: React.MouseEvent, path: string, directItemCount: number) => void;
  onSectionMenu: (e: React.MouseEvent) => void;
  onNewItem: () => void;
  onNewFolder: () => void;
  onDragStartRow: (e: React.DragEvent, a: Agent) => void;
  onDragOverFolder: (e: React.DragEvent, key: string) => void;
  onDropFolder: (e: React.DragEvent, path: string) => void;
  isTurnActive: (id: string) => boolean;
}

function KindSection({
  kind, label, countBadge, tree, rootItems,
  collapsed, setCollapsed, dragOver,
  openAgent, editAgent, onRowMenu, onFolderMenu, onSectionMenu,
  onNewItem, onNewFolder,
  onDragStartRow, onDragOverFolder, onDropFolder, isTurnActive,
}: KindSectionProps) {
  const sectionKey = `section:${kind}`;
  const rootDragKey = `${ROOT_DRAG_KEY_PREFIX}${kind}`;
  const isOpen = !collapsed[sectionKey];
  const ItemIcon = kind === 'chat' ? ChatCircleDotsIcon : RobotIcon;
  const isDraggingOverRoot = dragOver === rootDragKey;

  const renderRow = (agent: Agent, indentPx: number) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      indentPx={indentPx}
      running={isTurnActive(agent.id)}
      onOpen={() => openAgent(agent)}
      onEdit={() => editAgent(agent)}
      onContextMenu={(e) => onRowMenu(e, agent)}
      onDragStart={(e) => onDragStartRow(e, agent)}
    />
  );

  const toggle = (path: string) => setCollapsed((c) => ({ ...c, [path]: !c[path] }));

  const handleHeaderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDropFolder(e, '');
  };

  return (
    <section className="mb-2" onContextMenu={onSectionMenu}>
      <div
        className={`group/section flex items-center gap-1 h-7 px-2 mx-1 rounded hover:bg-bg-elevated ${isDraggingOverRoot ? 'bg-accent/10 ring-1 ring-accent/40' : ''}`}
        onDragOver={(e) => onDragOverFolder(e, rootDragKey)}
        onDrop={handleHeaderDrop}
      >
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
          onClick={() => setCollapsed((c) => ({ ...c, [sectionKey]: isOpen }))}
        >
          {isOpen ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
          <ItemIcon size={12} className="text-text-tertiary" />
          <span className="truncate">{label}</span>
          <span className="ml-auto text-[10px] text-text-tertiary font-normal">{countBadge}</span>
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover/section:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
          onClick={onNewFolder}
          title={`New ${label.toLowerCase()} folder`}
          aria-label={`New ${label.toLowerCase()} folder`}
        >
          <FolderPlusIcon size={12} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover/section:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
          onClick={onNewItem}
          title={`New ${kind}`}
          aria-label={`New ${kind}`}
        >
          <PlusIcon size={12} />
        </button>
      </div>

      {isOpen && (
        <>
          {tree.map((node) => (
            <TreeFolder<Agent>
              key={node.path}
              node={node}
              collapsed={collapsed}
              onToggle={toggle}
              dragOver={dragOver}
              totalCount={countItemsInNode(node)}
              renderItem={renderRow}
              onFolderContextMenu={onFolderMenu}
              onDragOver={onDragOverFolder}
              onDrop={(e, path) => { e.preventDefault(); onDropFolder(e, path); }}
              emptyHint="Drop items here"
            />
          ))}

          {/* Root-level (uncategorized) items render last under the section. */}
          {rootItems.length > 0 ? (
            rootItems.map((agent) => renderRow(agent, 24))
          ) : tree.length === 0 ? (
            <div
              className={`mx-1 my-1 px-3 py-2 rounded border border-dashed border-border text-[11px] text-text-tertiary text-center ${isDraggingOverRoot ? 'bg-accent/10 border-accent' : ''}`}
              onDragOver={(e) => onDragOverFolder(e, rootDragKey)}
              onDrop={handleHeaderDrop}
            >
              Drop here to move to {label}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Sum direct + nested item counts. Mirrors the helper in TreeFolder.tsx
 *  (inlined here so KindSection isn't coupled to TreeFolder's internals). */
function countItemsInNode<T>(node: { items: T[]; children: { items: T[]; children: unknown[] }[] }): number {
  let total = node.items.length;
  for (const child of node.children) {
    total += countItemsInNode(child as { items: T[]; children: { items: T[]; children: unknown[] }[] });
  }
  return total;
}

// ---------- row ----------
interface AgentRowProps {
  agent: Agent;
  indentPx: number;
  running: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

function AgentRow({ agent, indentPx, running, onOpen, onEdit, onContextMenu, onDragStart }: AgentRowProps) {
  const bindingCount = agent.bindings?.length ?? 0;
  const Icon = agent.kind === 'chat' ? ChatCircleDotsIcon : RobotIcon;
  // Display in the user's local timezone. The Swedish locale yields ISO
  // `yyyy-mm-dd` natively. Using `agent.updatedAt.slice(0, 10)` would show
  // the UTC date and shift the row by one day for users east/west of UTC.
  const dateLabel = new Date(agent.updatedAt).toLocaleDateString('sv-SE');
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
        onClick={onOpen}
      >
        <Icon size={13} className={agent.kind === 'chat' ? 'text-text-tertiary shrink-0' : 'text-accent shrink-0'} />
        <span className="truncate">{agent.name}</span>
        {running && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" title="Session running" />}
        {bindingCount > 0 && (
          <span
            className="ml-auto text-[10px] text-text-tertiary shrink-0 px-1 rounded bg-bg-elevated"
            aria-label={`${bindingCount} context binding${bindingCount === 1 ? '' : 's'}`}
          >
            {bindingCount}
          </span>
        )}
        <time
          dateTime={agent.updatedAt}
          className={`${bindingCount > 0 ? '' : 'ml-auto'} text-[10px] text-text-secondary shrink-0 tabular-nums`}
        >
          {dateLabel}
        </time>
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
        onClick={onEdit}
        aria-label={`Edit ${agent.name}`}
        title="Edit"
      >
        <PencilSimpleIcon size={13} />
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-elevated transition-opacity"
        onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
        aria-label="More actions"
        title="More actions"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
}
