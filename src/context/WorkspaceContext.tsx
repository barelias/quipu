import React, { useEffect } from 'react';
import storage from '../services/storageService';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import { TabProvider, useTab } from './TabContext';
import { TerminalProvider } from './TerminalContext';
import { KamaluProvider, useKamalu } from './KamaluContext';
import { AgentProvider } from './AgentContext';
import { RepoProvider } from './RepoContext';

function KamaluWorkspaceSync() {
  const { workspacePath } = useFileSystem();
  const { notifyWorkspacePath } = useKamalu();
  useEffect(() => {
    if (workspacePath) notifyWorkspacePath(workspacePath);
  }, [workspacePath, notifyWorkspacePath]);
  return null;
}

interface SessionSnapshotEntry {
  path: string;
  scrollPosition: number;
  type?: string;
  name?: string;
}

/**
 * Pane membership persisted by path — tab ids are session-scoped (regenerated
 * on restore) so we identify pane membership by stable file paths instead.
 */
interface SessionPaneSnapshot {
  id: string;
  paths: string[];
  activePath: string | null;
}

interface SessionSnapshot {
  openFilePaths: Array<SessionSnapshotEntry>;
  activeFilePath: string | null;
  expandedFolders: string[];
  /** Pane layout (B5). Optional for back-compat with pre-pane sessions. */
  panes?: SessionPaneSnapshot[];
  activePaneId?: string;
}

/**
 * SessionPersistence observes openTabs, activeTabId (from TabContext),
 * expandedFolders, workspacePath (from FileSystemContext), and debounce-writes
 * the session snapshot to storageService.
 */
function SessionPersistence({ children }: { children: React.ReactNode }) {
  const { openTabs, activeTabId, primary, secondary, activePaneId } = useTab();
  const { expandedFolders, workspacePath } = useFileSystem();

  useEffect(() => {
    if (!workspacePath) return;
    const timer = setTimeout(() => {
      // Map tab ids to file paths for pane persistence (ids are regenerated
      // on restore; paths are stable).
      const idToPath = new Map(openTabs.map(t => [t.id, t.path]));
      const paneToSnap = (p: typeof primary): SessionPaneSnapshot => ({
        id: p.id,
        paths: p.tabIds.map(id => idToPath.get(id)).filter((p): p is string => !!p),
        activePath: (p.activeTabId && idToPath.get(p.activeTabId)) || null,
      });
      const snapshot: SessionSnapshot = {
        openFilePaths: openTabs
          .filter(t => t.path)
          .map(t => ({
            path: t.path,
            scrollPosition: t.scrollPosition ?? 0,
            ...(t.type ? { type: t.type, name: t.name } : {}),
          })),
        activeFilePath: openTabs.find(t => t.id === activeTabId)?.path ?? null,
        expandedFolders: [...expandedFolders],
        panes: secondary
          ? [paneToSnap(primary), paneToSnap(secondary)]
          : [paneToSnap(primary)],
        activePaneId,
      };
      storage.set(`session:${workspacePath}`, snapshot).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [openTabs, activeTabId, expandedFolders, workspacePath, primary, secondary, activePaneId]);

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
    <KamaluProvider>
      <FileSystemProvider>
        <TabProvider>
          <RepoProvider>
            <AgentProvider>
              <TerminalProvider>
                <SessionPersistence>
                  <KamaluWorkspaceSync />
                  {children}
                </SessionPersistence>
              </TerminalProvider>
            </AgentProvider>
          </RepoProvider>
        </TabProvider>
      </FileSystemProvider>
    </KamaluProvider>
  );
}
