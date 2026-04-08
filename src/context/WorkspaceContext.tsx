import React, { useEffect } from 'react';
import storage from '../services/storageService';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import { TabProvider, useTab } from './TabContext';
import { TerminalProvider } from './TerminalContext';

interface SessionSnapshot {
  openFilePaths: Array<{ path: string; scrollPosition: number }>;
  activeFilePath: string | null;
  expandedFolders: string[];
}

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

/**
 * Composes all contexts into a single provider tree.
 *
 * Nesting order: FileSystemProvider > TabProvider > TerminalProvider
 * - TabContext consumes workspacePath from FileSystemContext
 * - TerminalContext is self-contained
 * - SessionPersistence observes both Tab and FileSystem state
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
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
