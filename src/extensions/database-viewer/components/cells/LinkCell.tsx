import React, { useState, useCallback, useEffect } from 'react';
import { Popover } from 'radix-ui';
import { LinkSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import fsService from '@/services/fileSystem';
import { siblingFolderPath } from '@/services/databaseFolderSync';
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

const LinkCell: React.FC<LinkCellProps> = ({ value, column, databaseFilePath, workspacePath, onUpdate }) => {
  const { openFile } = useTab();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [siblingFiles, setSiblingFiles] = useState<string[]>([]);

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

  // --- Display: empty cell with picker affordance ---

  return (
    <Popover.Root open={isPickerOpen} onOpenChange={setIsPickerOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="w-full text-left min-h-[20px] flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary"
        >
          <PlusIcon size={11} />
          <span>{column.mode === 'relative' ? 'Pick / create' : 'Pick file'}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[220px] max-h-[280px] overflow-auto z-[9999]"
          align="start"
          sideOffset={4}
        >
          {column.mode === 'global' && (
            <button
              type="button"
              onClick={handlePickGlobal}
              className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface"
            >
              Pick existing file…
            </button>
          )}
          {column.mode === 'relative' && (
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default LinkCell;
