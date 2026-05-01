import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import fs from '../services/fileSystem';
import { useFileSystem } from './FileSystemContext';
import { useToast } from '../components/ui/Toast';
import * as repoFileStore from '../services/repoFileStore';
import { watchDirRecursive } from '../services/quipuFileStore';
import { slugify, normalizeFolder, disambiguateSlug, joinId } from '../services/slug';
import type { Repo } from '@/types/agent';

const GITIGNORE_LINE = 'tmp/';

/** How long a path written by THIS window suppresses a watcher reload.
 *  Mirrors AgentContext: longer than ~300ms and we're outside the OS
 *  buffer for coalesced inotify events. */
const ECHO_TTL_MS = 300;

export type CloneStatus =
  | { state: 'idle' }
  | { state: 'cloning' }
  | { state: 'error'; message: string };

interface RepoContextValue {
  repos: Repo[];
  /**
   * Declared folder paths (forward-slash separated). Includes both
   * explicitly-declared folders (`.folder.json` markers) and folders
   * implied by repos living inside them. Used by the panel to render
   * empty folders that have no repos yet.
   */
  folders: string[];
  isLoaded: boolean;
  getRepo: (id: string) => Repo | undefined;
  upsertRepo: (repo: Repo) => void;
  deleteRepo: (id: string, options?: { removeClone?: boolean }) => Promise<void>;
  deleteFolder: (folder: string, options?: { removeClones?: boolean }) => Promise<void>;
  /** Declare a folder so it persists even without any repos in it. */
  createFolder: (name: string) => Promise<void>;
  /** Rename a folder — updates both the directory and every repo that lived in it. */
  renameFolder: (oldName: string, newName: string) => Promise<void>;
  /**
   * Clone a repo into the given agent's scratch directory at
   * `<workspace>/tmp/<agentId>/repos/<repo-name>`. Each agent gets its own
   * isolated copy, worktree-style.
   */
  cloneRepoForAgent: (repoId: string, agentId: string) => Promise<string>;
  getCloneStatus: (id: string) => CloneStatus;
}

const RepoContext = createContext<RepoContextValue | null>(null);

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'repo';
}

async function ensureTmpGitignored(workspacePath: string): Promise<void> {
  const gitignorePath = `${workspacePath.replace(/\/+$/, '')}/.gitignore`;
  let current = '';
  try {
    const raw = await fs.readFile(gitignorePath);
    current = typeof raw === 'string' ? raw : '';
  } catch {
    current = '';
  }
  const lines = current.split('\n').map(l => l.trim());
  if (lines.includes(GITIGNORE_LINE) || lines.includes('tmp') || lines.includes('/tmp') || lines.includes('/tmp/')) {
    return;
  }
  const trailingNewline = current.length === 0 || current.endsWith('\n');
  const next = current + (trailingNewline ? '' : '\n') + `# Quipu: agent-cloned repos and scratch space\n${GITIGNORE_LINE}\n`;
  try {
    await fs.writeFile(gitignorePath, next);
  } catch {
    /* best-effort — the user might have a custom .gitignore flow */
  }
}

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const { workspacePath } = useFileSystem();
  const { showToast } = useToast();

  // === State (per CLAUDE.md hook ordering: state first, callbacks, effects last) ===

  const [repos, setRepos] = useState<Repo[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [cloneStates, setCloneStates] = useState<Record<string, CloneStatus>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  const reposRef = useRef<Repo[]>(repos);
  useEffect(() => { reposRef.current = repos; }, [repos]);

  // Tracks which workspacePath the in-memory state belongs to. Used by the
  // file watcher reload to bail out if we've moved on to another workspace
  // since the event arrived. Saves are imperative (synchronous against the
  // call site's workspacePath capture), so they don't need this barrier.
  const loadedWorkspaceRef = useRef<string | null>(null);

  // Echo-suppression: when this window writes to a path, the watcher
  // immediately fires for that path. Tracking expiry timestamps lets us
  // ignore those self-induced events without blocking real cross-window
  // writes for more than a few hundred milliseconds. Mirrors AgentContext.
  const recentWriteTimesRef = useRef<Map<string, number>>(new Map());

  /** Mark the given absolute path as "just written by us" for ECHO_TTL_MS.
   *  Garbage-collects any expired entries on the way in. */
  const markRecentWrite = useCallback((absPath: string): void => {
    const now = Date.now();
    const map = recentWriteTimesRef.current;
    for (const [k, expiry] of map) {
      if (expiry <= now) map.delete(k);
    }
    map.set(absPath, now + ECHO_TTL_MS);
  }, []);

  /** True if `absPath` is one we wrote within ECHO_TTL_MS. Consumes the entry
   *  on hit so a single write only suppresses one watcher event. */
  const isRecentEcho = useCallback((absPath: string): boolean => {
    const expiry = recentWriteTimesRef.current.get(absPath);
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      recentWriteTimesRef.current.delete(absPath);
      return false;
    }
    recentWriteTimesRef.current.delete(absPath);
    return true;
  }, []);

  // === Leaf callbacks ===

  const getRepo = useCallback((id: string) => repos.find(r => r.id === id), [repos]);
  const getCloneStatus = useCallback((id: string) => cloneStates[id] ?? { state: 'idle' as const }, [cloneStates]);

  /**
   * Compute a slug for `repo` that won't collide with any sibling under the
   * same folder. Used by `upsertRepo` whenever a slug isn't supplied or
   * supplied-but-colliding (e.g. on a rename into an existing folder).
   *
   * `selfId` is the id we should ignore when checking for collisions —
   * critical when re-saving a repo in place (its own previous slug
   * shouldn't be considered a collision against itself).
   */
  const resolveSlugForFolder = useCallback((
    repoList: Repo[],
    folder: string,
    desiredSlug: string,
    fallbackName: string,
    selfId: string | null,
  ): string => {
    const cleaned = desiredSlug.trim() || slugify(fallbackName, 'repo');
    const used = new Set<string>();
    for (const other of repoList) {
      if (other.id === selfId) continue;
      const otherFolder = other.folder ?? '';
      if (otherFolder !== folder) continue;
      const otherSlug = other.slug ?? '';
      if (otherSlug !== '') used.add(otherSlug);
    }
    return disambiguateSlug(cleaned, used);
  }, []);

  /** Reload repos and declared folders from disk. Used both at workspace
   *  open and after the file watcher reports a change. The `cancelled`
   *  flag protects against a workspace switch firing mid-reload — caller
   *  passes its own cancellation token. */
  const reloadRepos = useCallback(async (
    workspace: string,
    isCancelled: () => boolean,
  ): Promise<{ repos: Repo[]; folders: string[] } | null> => {
    try {
      const [loaded, loadedFolders] = await Promise.all([
        repoFileStore.loadAllRepos(workspace),
        repoFileStore.loadAllFolders(workspace),
      ]);
      if (isCancelled()) return null;
      return { repos: loaded, folders: loadedFolders.map((f) => f.path) };
    } catch (err) {
      console.warn('[repos] reload failed', err);
      return null;
    }
  }, []);

  // === Imperative file-store ops with state sync ===

  /**
   * Write `repo` to disk and update React state. Slug+folder are
   * normalized + disambiguated against the live repo list before the
   * save, so callers don't have to think about collisions. The repo's
   * previous id (when it exists) is passed to the file store so an old
   * file gets cleaned up after a slug/folder rename.
   */
  const persistRepo = useCallback(async (
    workspace: string,
    incoming: Repo,
    previousId: string | null,
  ): Promise<Repo | null> => {
    const folder = normalizeFolder(incoming.folder ?? '');
    const desiredSlug = (incoming.slug ?? '').trim() || slugify(incoming.name, 'repo');
    const slug = resolveSlugForFolder(
      reposRef.current,
      folder,
      desiredSlug,
      incoming.name,
      previousId,
    );
    const newId = joinId(folder, slug);
    const persisted: Repo = {
      ...incoming,
      id: newId,
      slug,
      folder: folder === '' ? undefined : folder,
    };

    try {
      // Mark BOTH the new file (we're about to write it) and the old
      // file (we may delete it) as recent echoes — the watcher fires
      // for both create and unlink events.
      const newAbs = `${workspace}/.quipu/repos/${newId}.json`;
      markRecentWrite(newAbs);
      if (previousId !== null && previousId !== newId) {
        const oldAbs = `${workspace}/.quipu/repos/${previousId}.json`;
        markRecentWrite(oldAbs);
      }
      await repoFileStore.saveRepo(workspace, persisted, previousId ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to save repo: ${message}`, 'error');
      return null;
    }

    // State update — replace if any repo shares previousId or newId,
    // otherwise append.
    setRepos(prev => {
      let replaced = false;
      const next: Repo[] = [];
      for (const r of prev) {
        if (r.id === previousId || r.id === newId) {
          if (!replaced) {
            next.push(persisted);
            replaced = true;
          }
          continue;
        }
        next.push(r);
      }
      if (!replaced) next.push(persisted);
      return next;
    });

    return persisted;
  }, [markRecentWrite, resolveSlugForFolder, showToast]);

  const upsertRepo = useCallback((repo: Repo): void => {
    if (!workspacePath) return;
    const previous = reposRef.current.find(r => r.id === repo.id);
    void persistRepo(workspacePath, repo, previous ? previous.id : null);
  }, [persistRepo, workspacePath]);

  const deleteRepo = useCallback(async (id: string, options?: { removeClone?: boolean }): Promise<void> => {
    if (!workspacePath) return;
    const repo = reposRef.current.find(r => r.id === id);
    if (!repo) return;

    // Mark for echo suppression before initiating the delete.
    const abs = `${workspacePath}/.quipu/repos/${id}.json`;
    markRecentWrite(abs);

    try {
      await repoFileStore.deleteRepo(workspacePath, id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to delete repo: ${message}`, 'error');
      return;
    }

    if (options?.removeClone && repo.localClonePath) {
      try {
        await fs.deletePath(repo.localClonePath);
      } catch (err) {
        console.warn('[repos] failed to delete clone dir', repo.localClonePath, err);
      }
    }

    setRepos(prev => prev.filter(r => r.id !== id));
    setCloneStates(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [markRecentWrite, showToast, workspacePath]);

  const deleteFolder = useCallback(async (folder: string, options?: { removeClones?: boolean }): Promise<void> => {
    if (!workspacePath) return;
    let folderPath: string;
    try {
      folderPath = normalizeFolder(folder);
    } catch {
      showToast(`"${folder}" is not a valid folder name.`, 'error');
      return;
    }
    if (folderPath === '') return;

    // Snapshot which repos lived in this folder (and its descendants) BEFORE
    // we delete on disk — we need their localClonePath to optionally remove
    // disk clones. Mirrors the legacy semantics where deleteFolder removed
    // every repo whose folder matched.
    const matches = reposRef.current.filter(r => {
      const rf = (r.folder ?? '').trim();
      return rf === folderPath || rf.startsWith(`${folderPath}/`);
    });

    try {
      await repoFileStore.deleteFolder(workspacePath, folderPath, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to delete folder: ${message}`, 'error');
      return;
    }

    if (options?.removeClones) {
      await Promise.all(matches.map(async (repo) => {
        if (!repo.localClonePath) return;
        try {
          await fs.deletePath(repo.localClonePath);
        } catch (err) {
          console.warn('[repos] failed to delete clone dir', repo.localClonePath, err);
        }
      }));
    }

    // Reload from disk so the in-memory state matches reality. The folder
    // delete ran recursively; reading back is the simplest way to converge.
    const result = await reloadRepos(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
    if (result) {
      setRepos(result.repos);
      setFolders(result.folders);
    }

    // Clear any in-memory clone-state entries for the removed repos.
    const ids = new Set(matches.map(r => r.id));
    setCloneStates(prev => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (id in next) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [reloadRepos, showToast, workspacePath]);

  const createFolder = useCallback(async (name: string): Promise<void> => {
    if (!workspacePath) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    let folderPath: string;
    try {
      folderPath = normalizeFolder(trimmed);
    } catch {
      showToast(`"${trimmed}" is not a valid folder name.`, 'error');
      return;
    }
    if (folderPath === '') return;
    try {
      const markerAbs = `${workspacePath}/.quipu/repos/${folderPath}/.folder.json`;
      markRecentWrite(markerAbs);
      await repoFileStore.createFolder(workspacePath, folderPath, trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to create folder: ${message}`, 'error');
      return;
    }
    const result = await reloadRepos(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
    if (!result) return;
    setRepos(result.repos);
    setFolders(result.folders);
  }, [markRecentWrite, reloadRepos, showToast, workspacePath]);

  const renameFolder = useCallback(async (oldName: string, newName: string): Promise<void> => {
    if (!workspacePath) return;
    let oldPath: string;
    let newPath: string;
    try {
      oldPath = normalizeFolder(oldName);
      newPath = normalizeFolder(newName);
    } catch {
      showToast('Invalid folder name.', 'error');
      return;
    }
    if (oldPath === '' || newPath === '' || oldPath === newPath) return;
    try {
      await repoFileStore.renameFolder(workspacePath, oldPath, newPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Failed to rename folder: ${message}`, 'error');
      return;
    }
    const result = await reloadRepos(workspacePath, () => loadedWorkspaceRef.current !== workspacePath);
    if (!result) return;
    setRepos(result.repos);
    setFolders(result.folders);
  }, [reloadRepos, showToast, workspacePath]);

  const cloneRepoForAgent = useCallback(async (repoId: string, agentId: string): Promise<string> => {
    const repo = reposRef.current.find(r => r.id === repoId);
    if (!repo) throw new Error('Unknown repo');
    if (!repo.url) throw new Error('Repo has no URL to clone');
    if (!workspacePath) throw new Error('Open a workspace before cloning repos');
    if (!window.electronAPI?.gitClone) throw new Error('Cloning is only available in Electron');

    const base = workspacePath.replace(/\/+$/, '');
    const name = sanitizeRepoName(repo.name);
    const target = `${base}/tmp/${agentId}/repos/${name}`;

    // If it already exists, treat as a cache hit.
    if (window.electronAPI?.pathExists) {
      try {
        if (await window.electronAPI.pathExists(target)) return target;
      } catch { /* fall through to clone */ }
    } else {
      try {
        await fs.readDirectory(target);
        return target;
      } catch { /* not cloned yet */ }
    }

    setCloneStates(prev => ({ ...prev, [repoId]: { state: 'cloning' } }));
    try {
      await ensureTmpGitignored(base);
      await window.electronAPI.gitClone(repo.url, target);
      setCloneStates(prev => {
        const next = { ...prev };
        delete next[repoId];
        return next;
      });
      return target;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCloneStates(prev => ({ ...prev, [repoId]: { state: 'error', message } }));
      throw err;
    }
  }, [workspacePath]);

  // === Effects (last) ===

  // Load (and reload on workspace switch). Each branch operates on its own
  // captured `workspace` so a stale resolution that lands after we've
  // moved on to another workspace can be detected and discarded via the
  // `cancelled` flag + the loadedWorkspaceRef comparison.
  useEffect(() => {
    let cancelled = false;
    loadedWorkspaceRef.current = null;

    // Reset on every workspace change. `cloneStates` is in-memory only — a
    // clone-in-progress that belongs to the previous workspace must not
    // bleed into the new one.
    setIsLoaded(false);
    setRepos([]);
    setFolders([]);
    setCloneStates({});
    // Echo-suppression entries are workspace-scoped paths; abandon them.
    recentWriteTimesRef.current.clear();

    if (!workspacePath) {
      return () => { cancelled = true; };
    }

    const workspace = workspacePath;
    let unwatch: (() => void) | null = null;

    (async () => {
      const loaded = await reloadRepos(workspace, () => cancelled);
      if (cancelled) return;
      if (loaded === null) {
        // Even on failure, mark loaded so the UI flips out of its
        // skeleton state. Empty + isLoaded=true is the right "fresh
        // workspace, nothing here yet" presentation.
        loadedWorkspaceRef.current = workspace;
        setIsLoaded(true);
        return;
      }

      setRepos(loaded.repos);
      setFolders(loaded.folders);
      loadedWorkspaceRef.current = workspace;
      setIsLoaded(true);
    })();

    // Subscribe to file changes under .quipu/. AgentContext also watches
    // the same root — the file watcher in electron/main.cjs supports a
    // single active root, so both contexts share it and filter by
    // subtree. Echo-suppression filters out our own writes.
    unwatch = watchDirRecursive(`${workspace}/.quipu`, (event) => {
      if (loadedWorkspaceRef.current !== workspace) return;
      // Filter to repos/ subtree — agent file changes don't concern us.
      if (event.path && !event.path.includes('/.quipu/repos/')) return;
      if (event.path && isRecentEcho(event.path)) return;
      void (async () => {
        const result = await reloadRepos(workspace, () => loadedWorkspaceRef.current !== workspace);
        if (!result) return;
        if (loadedWorkspaceRef.current !== workspace) return;
        setRepos(result.repos);
        setFolders(result.folders);
      })();
    });

    return () => {
      cancelled = true;
      if (unwatch) unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const value: RepoContextValue = {
    repos,
    folders,
    isLoaded,
    getRepo,
    upsertRepo,
    deleteRepo,
    deleteFolder,
    createFolder,
    renameFolder,
    cloneRepoForAgent,
    getCloneStatus,
  };

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useRepo must be used within a RepoProvider');
  }
  return ctx;
}
