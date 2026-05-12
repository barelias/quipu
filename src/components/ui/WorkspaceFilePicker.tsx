import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { cn } from '@/lib/utils';
import searchService from '@/services/searchService';
import fs from '@/services/fileSystem';

interface FileEntry {
  name: string;
  /** Absolute path on disk — used to call the native dialog fallback. */
  absPath: string;
  /** Workspace-relative path — what we actually want the embed `src` to be. */
  relPath: string;
}

interface WorkspaceFilePickerProps {
  /** Heading on the dialog. */
  title: string;
  /** Workspace root — picker only shows files inside this directory. */
  workspacePath: string | null;
  /**
   * Predicate filter. The picker walks the whole workspace and only
   * keeps paths that satisfy this — typically a file-extension check.
   */
  match: (relPath: string) => boolean;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Returns the workspace-relative path of the selected file. */
  onSelect: (relPath: string) => void;
  /**
   * Fallback for choosing a file outside the workspace. When present,
   * the dialog shows a "Browse for file outside workspace…" item that
   * invokes this callback. Typically wired to fs.openFileDialog.
   */
  onBrowseOutside?: () => void;
  onClose: () => void;
}

/**
 * Cmdk-based workspace-scoped file picker. Lists every file in the
 * workspace, filters by an extension predicate, and returns the
 * workspace-relative path on selection.
 *
 * Used by the Link Database and Link MDX slash-command flows so the
 * user doesn't have to navigate the OS native dialog to find a file
 * that lives inside the workspace.
 */
export default function WorkspaceFilePicker({
  title,
  workspacePath,
  match,
  placeholder,
  onSelect,
  onBrowseOutside,
  onClose,
}: WorkspaceFilePickerProps) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!workspacePath) return;
    let cancelled = false;
    setIsLoading(true);
    searchService
      .listFilesRecursive(workspacePath, 10000)
      .then((paths: string[]) => {
        if (cancelled) return;
        const root = workspacePath.replace(/\/+$/, '');
        const entries: FileEntry[] = paths
          .map((abs) => {
            const rel = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
            return { name: rel.split('/').pop() || rel, absPath: abs, relPath: rel };
          })
          .filter((e) => match(e.relPath));
        setFiles(entries);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, match]);

  const filtered = useMemo<FileEntry[]>(() => {
    if (!query.trim()) return files.slice(0, 200);
    const q = query.toLowerCase();
    return files
      .filter((f) => f.relPath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 200);
  }, [files, query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 bg-black/35 z-[10000] flex justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        className="w-[560px] max-w-[90vw] max-h-[420px] bg-bg-elevated rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden self-start"
        shouldFilter={false}
        onKeyDown={handleKeyDown}
        label={title}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs text-text-tertiary uppercase tracking-wide">
          {title}
        </div>
        <Command.Input
          className="w-full border-none outline-none py-2 px-4 text-[15px] font-sans text-text-primary bg-bg-elevated border-b border-border shrink-0 placeholder:text-text-tertiary"
          placeholder={placeholder ?? 'Type a file name to filter…'}
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <Command.List className="flex-1 overflow-y-auto max-h-[340px]">
          {isLoading && (
            <Command.Loading className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">
              Loading workspace files…
            </Command.Loading>
          )}
          <Command.Empty className="p-4 text-center text-[13px] text-text-primary opacity-50 italic">
            {query.trim() ? 'No matching files' : 'No matching files in workspace'}
          </Command.Empty>
          {!isLoading &&
            filtered.map((file) => (
              <Command.Item
                key={file.relPath}
                value={file.relPath}
                onSelect={() => onSelect(file.relPath)}
                className={cn(
                  'flex items-center py-1.5 px-4 cursor-pointer gap-2.5',
                  'hover:bg-bg-overlay data-[selected=true]:bg-bg-overlay',
                )}
              >
                <span className="text-sm font-medium text-text-primary shrink-0">{file.name}</span>
                <span className="text-xs text-text-tertiary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-mono">
                  {file.relPath}
                </span>
              </Command.Item>
            ))}

          {onBrowseOutside && (
            <Command.Item
              key="__browse_outside__"
              value="browse-outside"
              onSelect={onBrowseOutside}
              className={cn(
                'flex items-center py-2 px-4 cursor-pointer gap-2.5 border-t border-border/50',
                'text-text-secondary hover:bg-bg-overlay data-[selected=true]:bg-bg-overlay',
              )}
            >
              <span className="text-sm">Browse for file outside workspace…</span>
            </Command.Item>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

/**
 * Convenience predicate: matches paths ending in any of the given
 * extensions (case-insensitive). Compound extensions like
 * `.quipudb.jsonl` are supported as-is.
 */
export function matchExtensions(...exts: string[]): (rel: string) => boolean {
  const lowerExts = exts.map((e) => e.toLowerCase());
  return (rel: string) => {
    const lower = rel.toLowerCase();
    return lowerExts.some((ext) => lower.endsWith(ext));
  };
}

// Re-export fs so consumers can run the outside-workspace fallback via
// the same module if desired.
export { fs };
