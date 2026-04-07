import React, { useEffect } from 'react';
import storage from '../services/storageService';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import { TabProvider, useTab } from './TabContext';
import { TerminalProvider, useTerminal } from './TerminalContext';
import type { FileSystemContextValue } from './FileSystemContext';
import type { TabContextValue } from './TabContext';
import type { TerminalContextValue } from './TerminalContext';

interface SessionSnapshot {
  openFilePaths: Array<{ path: string; scrollPosition: number }>;
  activeFilePath: string | null;
  expandedFolders: string[];
}

/**
 * WorkspaceContextValue is the union of all sub-context values.
 * Tab-aware deleteEntry/renameEntry from TabContext override the FileSystem versions.
 */
export type WorkspaceContextValue =
  Omit<FileSystemContextValue, 'deleteEntry' | 'renameEntry'> &
  TabContextValue &
  TerminalContextValue;

/**
 * SessionPersistence observes openTabs, activeTabId (from TabContext),
 * expandedFolders, workspacePath (from FileSystemContext), and debounce-writes
 * the session snapshot to storageService.
 */
function SessionPersistence({ children }: { children: React.ReactNode }) {
  const { openTabs, activeTabId } = useTab();
  const { expandedFolders, workspacePath } = useFileSystem();

  useEffect(() => {
    if (!workspacePath) return;
    const timer = setTimeout(() => {
      const snapshot: SessionSnapshot = {
        openFilePaths: openTabs
          .filter(t => t.path)
          .map(t => ({ path: t.path, scrollPosition: t.scrollPosition ?? 0 })),
        activeFilePath: openTabs.find(t => t.id === activeTabId)?.path ?? null,
        expandedFolders: [...expandedFolders],
      };
      storage.set(`session:${workspacePath}`, snapshot).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [openTabs, activeTabId, expandedFolders, workspacePath]);

  return <>{children}</>;
}

interface WorkspaceProviderProps {
  children: React.ReactNode;
}

/**
 * Composes all contexts into a single provider tree.
 *
 * Provider nesting order:
 * <FileSystemProvider>
 *   <TabProvider>
 *     <TerminalProvider>
 *       <SessionPersistence>
 *         {children}
 *       </SessionPersistence>
 *     </TerminalProvider>
 *   </TabProvider>
 * </FileSystemProvider>
 */
export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  return (
    <FileSystemProvider>
      <TabProvider>
        <TerminalProvider>
          <SessionPersistence>
            {children}
          </SessionPersistence>
        </TerminalProvider>
      </TabProvider>
    </FileSystemProvider>
  );
}

/**
 * Backward-compatible hook that combines all sub-context values.
 * Tab-aware deleteEntry/renameEntry from TabContext override FileSystem versions.
 * Will be removed in Unit 8 when consumers are migrated to specific hooks.
 */
export function useWorkspace(): WorkspaceContextValue {
  const fileSystem = useFileSystem();
  const tab = useTab();
  const terminal = useTerminal();

  return {
    ...fileSystem,
    ...tab,
    ...terminal,
  };
}
