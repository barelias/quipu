import React, { useState, useCallback, useEffect } from 'react';
import { Popover } from 'radix-ui';
import { LinkSimpleIcon, PlusIcon, FilePlusIcon } from '@phosphor-icons/react';
import fsService from '@/services/fileSystem';
import { siblingFolderPath, ensureSiblingFolder } from '@/services/databaseFolderSync';
import { showToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useTab } from '@/context/TabContext';
import type { LinkColumnDef } from '../../types';

interface LinkCellProps {
  value: string | null;
  column: LinkColumnDef;
  databaseFilePath: string | null;
  workspacePath: string | null;
  onUpdate: (value: string | null) => void;
  /**
   * When true, hide the "+ Pick / create" affordance for empty cells.
   * Existing links still open on click — read-only doesn't mean inert.
   */
  readOnly?: boolean;
}

/**
 * Strip the trailing extension from a basename, handling both simple
 * extensions (`spec.md` -> `spec`) and the database's compound suffix
 * for sibling folder display purposes.
 */
function basenameWithoutExtension(p: string): string {
  const slash = p.lastIndexOf('/');
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// `siblingFolderPath` is defined in services/databaseFolderSync.ts and
// imported above so the path math stays in one place.

/**
 * Apply a column's default extension to a user-typed name. Empty
 * extension means "no extension" — the name is kept verbatim. Names that
 * already end in the extension pass through unchanged.
 */
export function applyDefaultExtension(name: string, defaultExtension: string | undefined): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const ext = (defaultExtension ?? '.md').trim();
  if (!ext) return trimmed;
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  return trimmed.toLowerCase().endsWith(normalized.toLowerCase()) ? trimmed : `${trimmed}${normalized}`;
}

/**
 * Resolve a link cell value to a full filesystem path.
 *
 * - Global links: workspace-relative; resolved against `workspacePath`.
 * - Relative links: stored as a basename inside the database's sibling
 *   folder; resolved against `siblingFolderPath(databaseFilePath)`.
 */
export function resolveLinkPath(
  value: string,
  column: LinkColumnDef,
  databaseFilePath: string | null,
  workspacePath: string | null,
): string | null {
  if (!value) return null;
  if (value.startsWith('/')) return value;
  if (column.mode === 'relative') {
    if (!databaseFilePath) return null;
    return `${siblingFolderPath(databaseFilePath)}/${value}`;
  }
  if (!workspacePath) return value;
  return `${workspacePath}/${value}`;
}

const LinkCell: React.FC<LinkCellProps> = ({ value, column, databaseFilePath, workspacePath, onUpdate, readOnly = false }) => {
  const { openFile } = useTab();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [siblingFiles, setSiblingFiles] = useState<string[]>([]);
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState('');

  const refreshSiblingFiles = useCallback(async () => {
    if (column.mode !== 'relative' || !databaseFilePath) {
      setSiblingFiles([]);
      return;
    }
    try {
      const folder = siblingFolderPath(databaseFilePath);
      const entries = await fsService.readDirectory(folder);
      setSiblingFiles(entries.filter(e => !e.isDirectory).map(e => e.name));
    } catch {
      // Folder doesn't exist yet — empty list. Not an error; the folder is
      // created lazily when the user creates or picks a relative link.
      setSiblingFiles([]);
    }
  }, [column.mode, databaseFilePath]);

  useEffect(() => {
    if (isPickerOpen) refreshSiblingFiles();
  }, [isPickerOpen, refreshSiblingFiles]);

  const handleOpen = useCallback(() => {
    if (!value) return;
    const fullPath = resolveLinkPath(value, column, databaseFilePath, workspacePath);
    if (!fullPath) {
      showToast('Cannot resolve link path — workspace or database missing', 'warning');
      return;
    }
    const slash = fullPath.lastIndexOf('/');
    const fileName = slash >= 0 ? fullPath.slice(slash + 1) : fullPath;
    openFile(fullPath, fileName);
  }, [value, column, databaseFilePath, workspacePath, openFile]);

  const handlePickGlobal = useCallback(async () => {
    setIsPickerOpen(false);
    const hasNativeDialog = !!window.electronAPI?.openFileDialog;
    if (!hasNativeDialog) {
      // Browser mode — there is no native picker; the user types a path.
      // We rely on the caller to surface a fallback if needed; for now
      // we just no-op and toast.
      showToast('File picker is only available in the desktop app', 'info');
      return;
    }
    let filePath: string | null = null;
    try {
      filePath = await fsService.openFileDialog({
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });
    } catch {
      return;
    }
    if (!filePath) return;
    let stored = filePath;
    if (workspacePath && filePath.startsWith(workspacePath)) {
      stored = filePath.slice(workspacePath.length + 1);
    } else if (workspacePath) {
      showToast('Linked file is outside the workspace', 'warning');
    }
    onUpdate(stored);
  }, [workspacePath, onUpdate]);

  const handlePickRelative = useCallback((fileName: string) => {
    setIsPickerOpen(false);
    onUpdate(fileName);
  }, [onUpdate]);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    setCreateMode(false);
    setNewName('');
  }, []);

  const handleCreate = useCallback(async () => {
    const stamped = applyDefaultExtension(newName, column.defaultExtension);
    if (!stamped) return;

    if (column.mode === 'relative') {
      if (!databaseFilePath) {
        showToast('Cannot create file: database path unknown', 'error');
        return;
      }
      const ensure = await ensureSiblingFolder(databaseFilePath);
      if (!ensure.ok) {
        showToast(`Sibling folder unavailable: ${ensure.error ?? 'unknown error'}`, 'error');
        return;
      }
      const fullPath = `${siblingFolderPath(databaseFilePath)}/${stamped}`;
      try {
        await fsService.createFile(fullPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create file: ${message}`, 'error');
        return;
      }
      onUpdate(stamped);
      openFile(fullPath, stamped);
      closePicker();
      return;
    }

    // Global mode: file lives at workspace root (or a typed subfolder).
    if (!workspacePath) {
      showToast('Cannot create file: no workspace open', 'error');
      return;
    }
    const fullPath = `${workspacePath}/${stamped}`;
    try {
      await fsService.createFile(fullPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to create file: ${message}`, 'error');
      return;
    }
    onUpdate(stamped);
    openFile(fullPath, stamped.split('/').pop() ?? stamped);
    closePicker();
  }, [newName, column, databaseFilePath, workspacePath, onUpdate, openFile, closePicker]);

  // --- Display: linked file ---

  if (value) {
    const display = basenameWithoutExtension(value);
    return (
      <button
        type="button"
        onClick={handleOpen}
        title={`Open ${value}`}
        className={cn(
          'w-full text-left min-h-[20px] flex items-center gap-1.5 text-sm',
          'text-accent hover:underline truncate',
        )}
      >
        <LinkSimpleIcon size={12} weight="bold" className="shrink-0" />
        <span className="truncate">{display}</span>
      </button>
    );
  }

  // --- Read-only empty cell: just an em-dash placeholder, no picker.
  if (readOnly) {
    return <span className="text-text-tertiary text-xs">—</span>;
  }

  // --- Display: empty cell with picker affordance ---

  return (
    <Popover.Root open={isPickerOpen} onOpenChange={open => (open ? setIsPickerOpen(true) : closePicker())}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="w-full text-left min-h-[20px] flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary"
        >
          <PlusIcon size={11} />
          <span>Pick / create</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[240px] max-h-[300px] overflow-auto z-[9999]"
          align="start"
          sideOffset={4}
        >
          {!createMode && column.mode === 'global' && (
            <button
              type="button"
              onClick={handlePickGlobal}
              className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface"
            >
              Pick existing file…
            </button>
          )}

          {!createMode && column.mode === 'relative' && (
            <>
              <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                Files in {databaseFilePath ? basenameWithoutExtension(databaseFilePath).replace(/\.quipudb$/, '') : 'sibling folder'}
              </div>
              {siblingFiles.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-tertiary">No files yet</div>
              ) : (
                siblingFiles.map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handlePickRelative(name)}
                    className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface flex items-center gap-2"
                  >
                    <LinkSimpleIcon size={12} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{name}</span>
                  </button>
                ))
              )}
            </>
          )}

          {!createMode && (
            <>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                onClick={() => setCreateMode(true)}
                className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface flex items-center gap-2"
              >
                <FilePlusIcon size={12} className="shrink-0 text-text-tertiary" />
                <span>Create new…</span>
              </button>
            </>
          )}

          {createMode && (
            <div className="px-3 py-2 flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-wide text-text-tertiary">
                New file name
              </label>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  } else if (e.key === 'Escape') {
                    setCreateMode(false);
                  }
                }}
                placeholder={`name${column.defaultExtension ?? '.md'}`}
                className="px-2 py-1 text-sm bg-bg-surface border border-border rounded outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateMode(false)}
                  className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className={cn(
                    'px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent-hover',
                    !newName.trim() && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default LinkCell;
