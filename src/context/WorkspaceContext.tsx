import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import jsYaml from 'js-yaml';
import fs from '../services/fileSystem';
import fileWatcher from '../services/fileWatcher';
import frameService from '../services/frameService';
import claudeInstaller from '../services/claudeInstaller';
import storage from '../services/storageService';
import { useToast } from '../components/Toast';
import { isCodeFile, isMermaidFile, isNotebookFile } from '../utils/fileTypes';
import type { Tab, ActiveFile, Frontmatter } from '../types/tab';
import type { FileTreeEntry, RecentWorkspace } from '../types/workspace';
import type { TerminalTab } from '../types/editor';
import type { JSONContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface ExtractedFrontmatter {
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  body: string;
}

interface SessionSnapshot {
  openFilePaths: Array<{ path: string; scrollPosition: number }>;
  activeFilePath: string | null;
  expandedFolders: string[];
}

/**
 * Event shape used by both the Electron directory watcher and the browser file watcher.
 * At runtime the event may carry `filename` (from the raw OS watcher callback)
 * or `path` (from the typed service interface). We handle both.
 */
interface FileChangeEvent {
  filename?: string;
  type?: string;
  path?: string;
  [key: string]: unknown;
}

export interface WorkspaceContextValue {
  // Workspace state
  workspacePath: string | null;
  fileTree: FileTreeEntry[];
  activeFile: ActiveFile | null;
  isDirty: boolean;
  expandedFolders: Set<string>;
  showFolderPicker: boolean;
  recentWorkspaces: RecentWorkspace[];

  // Workspace actions
  openFolder: () => Promise<void>;
  selectFolder: (folderPath: string) => Promise<void>;
  cancelFolderPicker: () => void;
  clearRecentWorkspaces: () => Promise<void>;

  // File operations
  openFile: (filePath: string, fileName: string) => Promise<void>;
  saveFile: (editorInstance: Editor | null) => Promise<void>;
  setIsDirty: (dirty: boolean) => void;
  updateTabContent: (tabId: string, content: string | JSONContent) => void;

  // Folder operations
  toggleFolder: (folderPath: string) => void;
  revealFolder: (folderPath: string) => void;
  loadSubDirectory: (dirPath: string) => Promise<FileTreeEntry[]>;
  createNewFile: (parentPath: string, name: string) => Promise<void>;
  createNewFolder: (parentPath: string, name: string) => Promise<void>;
  deleteEntry: (targetPath: string) => Promise<void>;
  renameEntry: (oldPath: string, newPath: string) => Promise<void>;
  refreshDirectory: (dirPath: string) => Promise<void>;
  directoryVersion: number;

  // Tab state and operations
  openTabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  setTabDirty: (tabId: string, dirty: boolean) => void;
  snapshotTab: (tabId: string, tiptapJSON: JSONContent | null, scrollPosition: number) => void;
  reloadTabFromDisk: (tabId: string) => Promise<void>;

  // Terminal tabs
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  createTerminalTab: () => TerminalTab | null;
  closeTerminalTab: (tabId: string) => void;
  switchTerminalTab: (tabId: string) => void;
  setTerminalClaudeRunning: (tabId: string, isRunning: boolean) => void;
  clearAllTerminals: () => void;

  // Conflict resolution
  resolveConflictReload: (tabId: string) => Promise<void>;
  resolveConflictKeep: (tabId: string) => void;
  resolveConflictDismiss: (tabId: string) => void;

  // Git status
  gitChangeCount: number;
  updateGitChangeCount: (count: number) => void;

  // Frontmatter operations
  updateFrontmatter: (tabId: string, key: string, value: unknown) => void;
  addFrontmatterProperty: (tabId: string) => void;
  removeFrontmatterProperty: (tabId: string, key: string) => void;
  renameFrontmatterKey: (tabId: string, oldKey: string, newKey: string) => void;
  toggleFrontmatterCollapsed: (tabId: string) => void;
  addFrontmatterTag: (tabId: string, key: string, tagValue: string) => void;
  removeFrontmatterTag: (tabId: string, key: string, index: number) => void;
  updateFrontmatterTag: (tabId: string, key: string, index: number, newValue: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const MAX_TABS = 12;
const MAX_TERMINALS = 5;

interface WorkspaceProviderProps {
  children: React.ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const { showToast } = useToast();
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState<boolean>(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [gitChangeCount, setGitChangeCount] = useState<number>(0);
  const [directoryVersion, setDirectoryVersion] = useState<number>(0);

  const updateGitChangeCount = useCallback((count: number) => {
    setGitChangeCount(count);
  }, []);

  // Terminal tab state
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const terminalCounterRef = useRef<number>(0);

  const createTerminalTab = useCallback((): TerminalTab | null => {
    if (terminalTabs.length >= MAX_TERMINALS) {
      showToast('Maximum of 5 terminals reached', 'warning');
      return null;
    }
    terminalCounterRef.current += 1;
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      label: `Terminal ${terminalCounterRef.current}`,
      isClaudeRunning: false,
    };
    setTerminalTabs(prev => [...prev, tab]);
    setActiveTerminalId(tab.id);
    return tab;
  }, [terminalTabs.length, showToast]);

  const closeTerminalTab = useCallback((tabId: string) => {
    setTerminalTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // If closing the active terminal, switch to an adjacent one
      if (activeTerminalId === tabId && filtered.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newIdx = Math.min(idx, filtered.length - 1);
        setActiveTerminalId(filtered[newIdx].id);
      } else if (filtered.length === 0) {
        setActiveTerminalId(null);
      }
      return filtered;
    });
  }, [activeTerminalId]);

  const switchTerminalTab = useCallback((tabId: string) => {
    setActiveTerminalId(tabId);
  }, []);

  const setTerminalClaudeRunning = useCallback((tabId: string, isRunning: boolean) => {
    setTerminalTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isClaudeRunning: isRunning } : t
    ));
  }, []);

  const clearAllTerminals = useCallback(() => {
    setTerminalTabs([]);
    setActiveTerminalId(null);
  }, []);

  // Ref to access current openTabs inside intervals/event listeners without stale closures
  const openTabsRef = useRef<Tab[]>(openTabs);
  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // Track recently saved paths to suppress file watcher false conflicts
  const recentSavesRef = useRef<Map<string, number>>(new Map());

  // Derived values (computed, not useState)
  const activeTab: Tab | null = openTabs.find(t => t.id === activeTabId) || null;
  const activeFile: ActiveFile | null = activeTab ? {
    path: activeTab.path,
    name: activeTab.name,
    content: activeTab.content,
    isQuipu: activeTab.isQuipu,
  } : null;
  const isDirty: boolean = activeTab?.isDirty ?? false;

  // Load workspace history on mount; auto-open last workspace in Electron
  useEffect(() => {
    (async () => {
      const recent = (await storage.get('recentWorkspaces') as RecentWorkspace[] | null) || [];
      setRecentWorkspaces(recent);

      if (recent.length > 0) {
        const last = recent[0];
        try {
          const entries = await fs.readDirectory(last.path);
          setWorkspacePath(last.path);
          setFileTree(entries as FileTreeEntry[]);
          claudeInstaller.installFrameSkills(last.path).catch(() => {});
          restoreSession(last.path).catch(() => {});
        } catch {
          showToast(`Last workspace not found: ${last.name || last.path}`, 'warning');
        }
      }

      // Asynchronously validate all recent workspace paths and prune stale entries
      validateAndPruneWorkspaces(recent).catch(() => {});
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRecentWorkspaces = useCallback(async (folderPath: string) => {
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
    const entry: RecentWorkspace = { path: folderPath, name, lastOpened: new Date().toISOString() };
    const recent = (await storage.get('recentWorkspaces') as RecentWorkspace[] | null) || [];
    const deduped = recent.filter(r => r.path !== folderPath);
    const updated = [entry, ...deduped].slice(0, 10);
    await storage.set('recentWorkspaces', updated);
    setRecentWorkspaces(updated);
  }, []);

  const clearRecentWorkspaces = useCallback(async () => {
    await storage.set('recentWorkspaces', []);
    setRecentWorkspaces([]);
  }, []);

  // Validate workspace paths and prune stale entries that no longer exist on disk
  const validateAndPruneWorkspaces = useCallback(async (workspaces: RecentWorkspace[]): Promise<RecentWorkspace[]> => {
    if (!workspaces || workspaces.length === 0) return workspaces;

    const validated: RecentWorkspace[] = [];
    for (const ws of workspaces) {
      try {
        await fs.readDirectory(ws.path);
        validated.push(ws);
      } catch {
        // Path no longer exists or is inaccessible — skip it
      }
    }

    // If any entries were pruned, persist the cleaned list
    if (validated.length < workspaces.length) {
      await storage.set('recentWorkspaces', validated);
      setRecentWorkspaces(validated);
    }

    return validated;
  }, []);

  const openFolder = useCallback(async () => {
    // Try native dialog first (Electron)
    const folderPath = await fs.openFolderDialog();
    if (folderPath) {
      selectFolder(folderPath);
    } else {
      // Native dialog failed or unavailable — show in-app picker
      setShowFolderPicker(true);
    }
  }, []);

  const removeFromRecentWorkspaces = useCallback(async (folderPath: string) => {
    const recent = (await storage.get('recentWorkspaces') as RecentWorkspace[] | null) || [];
    const filtered = recent.filter(r => r.path !== folderPath);
    if (filtered.length < recent.length) {
      await storage.set('recentWorkspaces', filtered);
      setRecentWorkspaces(filtered);
    }
  }, []);

  const selectFolder = useCallback(async (folderPath: string) => {
    setShowFolderPicker(false);

    // Validate directory exists before resetting state
    let entries: FileTreeEntry[];
    try {
      entries = await fs.readDirectory(folderPath) as FileTreeEntry[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to read directory:', err);
      showToast('Failed to open workspace: ' + message, 'error');
      // Prune the stale path from recent workspaces (fire-and-forget)
      removeFromRecentWorkspaces(folderPath).catch(() => {});
      return;
    }

    // Directory read succeeded — now reset state and apply
    setWorkspacePath(folderPath);
    setOpenTabs([]);
    setActiveTabId(null);
    setExpandedFolders(new Set());
    clearAllTerminals();
    try {
      const entries = await fs.readDirectory(folderPath) as FileTreeEntry[];
      setFileTree(entries);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to read directory:', err);
      showToast('Failed to read directory: ' + message, 'error');
    }

    // Save to workspace history (fire-and-forget)
    updateRecentWorkspaces(folderPath).catch(() => {});

    // Restore last session for this workspace (fire-and-forget)
    restoreSession(folderPath).catch(() => {});

    // Auto-install FRAME skills for Claude Code (fire-and-forget)
    claudeInstaller.installFrameSkills(folderPath).catch((err: unknown) => {
      console.warn('Claude skills install failed:', err);
    });
  }, [showToast, updateRecentWorkspaces, removeFromRecentWorkspaces, clearAllTerminals]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelFolderPicker = useCallback(() => {
    setShowFolderPicker(false);
  }, []);

  const refreshDirectory = useCallback(async (dirPath: string) => {
    if (!dirPath) return;
    try {
      const entries = await fs.readDirectory(dirPath) as FileTreeEntry[];
      setFileTree(entries);
      setDirectoryVersion(v => v + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to refresh directory:', err);
      showToast('Failed to refresh directory: ' + message, 'error');
    }
  }, [showToast]);

  const loadSubDirectory = useCallback(async (dirPath: string): Promise<FileTreeEntry[]> => {
    try {
      return await fs.readDirectory(dirPath) as FileTreeEntry[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to load subdirectory:', err);
      showToast('Failed to load subdirectory: ' + message, 'error');
      return [];
    }
  }, [showToast]);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  // Expand all ancestor folders of a path, then toggle the target
  const revealFolder = useCallback((folderPath: string) => {
    if (!workspacePath || !folderPath.startsWith(workspacePath)) return;
    setExpandedFolders(prev => {
      const next = new Set(prev);
      // Expand every ancestor from workspace root to the target
      const relative = folderPath.substring(workspacePath.length + 1);
      const segments = relative.split('/');
      let current = workspacePath;
      for (const seg of segments) {
        current += '/' + seg;
        if (current === folderPath) {
          // Toggle the target itself
          if (next.has(current)) next.delete(current);
          else next.add(current);
        } else {
          // Always expand ancestors
          next.add(current);
        }
      }
      return next;
    });
  }, [workspacePath]);

  const setTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isDirty: dirty } : t
    ));
  }, []);

  const updateTabContent = useCallback((tabId: string, content: string | JSONContent) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, content } : t
    ));
  }, []);

  // Function to snapshot editor state for current tab before switching
  const snapshotTab = useCallback((tabId: string, tiptapJSON: JSONContent | null, scrollPosition: number) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, tiptapJSON, scrollPosition } : t
    ));
  }, []);

  const extractFrontmatter = useCallback((rawContent: string): ExtractedFrontmatter => {
    const match = rawContent.match(FRONTMATTER_REGEX);
    if (!match) return { frontmatter: null, frontmatterRaw: null, body: rawContent };

    try {
      const parsed = jsYaml.load(match[1]);
      return {
        frontmatter: typeof parsed === 'object' && parsed !== null ? (parsed as Frontmatter) : null,
        frontmatterRaw: match[1],
        body: rawContent.slice(match[0].length),
      };
    } catch {
      showToast('Malformed YAML frontmatter', 'warning');
      return { frontmatter: null, frontmatterRaw: match[1], body: rawContent.slice(match[0].length) };
    }
  }, [showToast]);

  const restoreSession = useCallback(async (folderPath: string) => {
    const session = await storage.get(`session:${folderPath}`) as SessionSnapshot | null;
    if (!session?.openFilePaths?.length) return;

    const savedPaths = session.openFilePaths.slice(0, MAX_TABS);
    const tabsMap = new Map<string, Tab>();

    await Promise.all(savedPaths.map(async ({ path: filePath, scrollPosition }) => {
      const fileName = filePath.split(/[\\/]/).pop() || '';
      const isPdf = /\.pdf$/i.test(fileName);
      const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);

      if (isPdf || isMedia) {
        tabsMap.set(filePath, {
          id: crypto.randomUUID(),
          path: filePath,
          name: fileName,
          content: null,
          tiptapJSON: null,
          isDirty: false,
          isQuipu: false,
          isMarkdown: false,
          isMedia,
          isPdf,
          isNotebook: false,
          scrollPosition: scrollPosition ?? 0,
          frontmatter: null,
          frontmatterRaw: null,
          diskContent: null,
          frontmatterCollapsed: true,
        });
        return;
      }

      try {
        const content = await fs.readFile(filePath);
        const isQuipu = fileName.endsWith('.quipu');
        const isMarkdown = fileName.endsWith('.md') || fileName.endsWith('.markdown');

        let parsedContent: JSONContent | null = null;
        if (isQuipu) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.type === 'quipu' && parsed.content) parsedContent = parsed.content;
          } catch { /* treat as text */ }
        }

        let frontmatter: Frontmatter | null = null;
        let frontmatterRaw: string | null = null;
        let bodyContent: string | JSONContent = content;
        if (isMarkdown && typeof content === 'string') {
          const fm = extractFrontmatter(content);
          frontmatter = fm.frontmatter;
          frontmatterRaw = fm.frontmatterRaw;
          bodyContent = fm.body;
        }

        tabsMap.set(filePath, {
          id: crypto.randomUUID(),
          path: filePath,
          name: fileName,
          content: isQuipu && parsedContent ? parsedContent : bodyContent,
          tiptapJSON: null,
          isDirty: false,
          isQuipu: isQuipu && !!parsedContent,
          isMarkdown,
          isNotebook: isNotebookFile(fileName),
          scrollPosition: scrollPosition ?? 0,
          frontmatter,
          frontmatterRaw,
          diskContent: content,
          frontmatterCollapsed: true,
        });
      } catch {
        // File no longer exists — skip silently
      }
    }));

    const tabs = savedPaths.map(({ path }) => tabsMap.get(path)).filter((t): t is Tab => t != null);
    if (tabs.length === 0) return;

    setOpenTabs(tabs);
    const active = tabs.find(t => t.path === session.activeFilePath) ?? tabs[tabs.length - 1];
    setActiveTabId(active.id);

    if (session.expandedFolders?.length) {
      setExpandedFolders(new Set(session.expandedFolders));
    }
  }, [extractFrontmatter]);

  const reloadTabFromDisk = useCallback(async (tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const content = await fs.readFile(tab.path);
      const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');

      let bodyContent: string = content;
      let frontmatter: Frontmatter | null = tab.frontmatter;
      let frontmatterRaw: string | null = tab.frontmatterRaw;

      if (isMarkdown && typeof content === 'string') {
        const fm = extractFrontmatter(content);
        frontmatter = fm.frontmatter;
        frontmatterRaw = fm.frontmatterRaw;
        bodyContent = fm.body;
      }

      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? {
          ...t,
          content: bodyContent,
          tiptapJSON: null,
          isDirty: false,
          diskContent: content,
          frontmatter,
          frontmatterRaw,
          hasConflict: false,
          conflictDiskContent: null,
          reloadKey: (t.reloadKey || 0) + 1,
        } : t
      ));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Failed to reload file: ' + message, 'error');
    }
  }, [openTabs, extractFrontmatter, showToast]);

  // Frontmatter operations
  const updateFrontmatter = useCallback((tabId: string, key: string, value: unknown) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...(t.frontmatter || {}), [key]: value };
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const addFrontmatterProperty = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = t.frontmatter || {};
      // Find a unique key name
      let keyName = 'key';
      let counter = 1;
      while (existing[keyName] !== undefined) {
        keyName = `key${counter++}`;
      }
      return { ...t, frontmatter: { ...existing, [keyName]: '' }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterProperty = useCallback((tabId: string, key: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...t.frontmatter };
      delete updated[key];
      // If no properties left, keep frontmatter as empty object (not null)
      // so the properties section still shows
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const renameFrontmatterKey = useCallback((tabId: string, oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const entries = Object.entries(t.frontmatter || {});
      const updated: Frontmatter = {};
      for (const [k, v] of entries) {
        updated[k === oldKey ? newKey : k] = v;
      }
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const toggleFrontmatterCollapsed = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, frontmatterCollapsed: !t.frontmatterCollapsed } : t
    ));
  }, []);

  const addFrontmatterTag = useCallback((tabId: string, key: string, tagValue: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? (t.frontmatter![key] as string[]) : [];
      return { ...t, frontmatter: { ...t.frontmatter, [key]: [...existing, tagValue] }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterTag = useCallback((tabId: string, key: string, index: number) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...(t.frontmatter![key] as string[])] : [];
      existing.splice(index, 1);
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  const updateFrontmatterTag = useCallback((tabId: string, key: string, index: number, newValue: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...(t.frontmatter![key] as string[])] : [];
      existing[index] = newValue;
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  const openFile = useCallback(async (filePath: string, fileName: string) => {
    // Check if already open
    const existing = openTabs.find(t => t.path === filePath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    // Check tab cap
    if (openTabs.length >= MAX_TABS) {
      showToast('Close a tab to open more files', 'warning');
      return;
    }

    const isPdf = /\.pdf$/i.test(fileName);
    const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);
    if (isMedia || isPdf) {
      const newTab: Tab = {
        id: crypto.randomUUID(),
        path: filePath,
        name: fileName,
        content: null,
        tiptapJSON: null,
        isDirty: false,
        isQuipu: false,
        isMarkdown: false,
        isMedia: isMedia,
        isPdf: isPdf,
        scrollPosition: 0,
        frontmatter: null,
        frontmatterRaw: null,
        diskContent: null,
        frontmatterCollapsed: true,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return;
    }

    try {
      const content = await fs.readFile(filePath);
      const isQuipu = fileName.endsWith('.quipu');
      const isMarkdown = fileName.endsWith('.md') || fileName.endsWith('.markdown');

      let parsedContent: JSONContent | null = null;
      if (isQuipu) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'quipu' && parsed.content) {
            parsedContent = parsed.content;
          }
        } catch { /* treat as text */ }
      }

      // Parse frontmatter for markdown files
      let frontmatter: Frontmatter | null = null;
      let frontmatterRaw: string | null = null;
      let bodyContent: string | JSONContent = content;
      if (isMarkdown && typeof content === 'string') {
        const fm = extractFrontmatter(content);
        frontmatter = fm.frontmatter;
        frontmatterRaw = fm.frontmatterRaw;
        bodyContent = fm.body;
      }

      const newTab: Tab = {
        id: crypto.randomUUID(),
        path: filePath,
        name: fileName,
        content: isQuipu && parsedContent ? parsedContent : bodyContent,
        tiptapJSON: null,
        isDirty: false,
        isQuipu: isQuipu && !!parsedContent,
        isMarkdown,
        isNotebook: isNotebookFile(fileName),
        scrollPosition: 0,
        frontmatter,
        frontmatterRaw,
        diskContent: content, // Raw content as read from disk, for change detection
        frontmatterCollapsed: true,
      };

      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to open file:', err);
      showToast('Failed to open file: ' + message, 'error');
    }
  }, [openTabs, showToast, extractFrontmatter]);

  const closeTab = useCallback((tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      const result = window.confirm(`Save changes to "${tab.name}" before closing?`);
      if (result) {
        // For now, just close. Full save-before-close would need editor instance.
        // The save flow is complex because we need the editor - we'll handle this by just warning.
      }
    }

    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // If closing the active tab, switch to adjacent
      if (activeTabId === tabId && filtered.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newIdx = Math.min(idx, filtered.length - 1);
        setActiveTabId(filtered[newIdx].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  }, [openTabs, activeTabId]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const closeOtherTabs = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.filter(t => t.id === tabId || t.isDirty));
    setActiveTabId(tabId);
  }, []);

  const setIsDirty = useCallback((dirty: boolean) => {
    if (activeTabId) {
      setTabDirty(activeTabId, dirty);
    }
  }, [activeTabId, setTabDirty]);

  const saveFile = useCallback(async (editorInstance: Editor | null) => {
    if (!activeTab) return;

    // NEVER write to binary files — they would be corrupted
    if (activeTab.isPdf || activeTab.isMedia || /\.pdf$/i.test(activeTab.name)) return;

    // For non-TipTap files (e.g., excalidraw), save tab content directly
    const isNonTipTapFile = activeTab.name.endsWith('.excalidraw') || activeTab.isMedia || isCodeFile(activeTab.name) || isMermaidFile(activeTab.name);
    if ((isNonTipTapFile || !editorInstance) && activeTab.content) {
      try {
        recentSavesRef.current.set(activeTab.path, Date.now());
        await fs.writeFile(activeTab.path, activeTab.content as string);
        setOpenTabs(prev => prev.map(t =>
          t.id === activeTab.id ? { ...t, isDirty: false, diskContent: activeTab.content as string, hasConflict: false, conflictDiskContent: null } : t
        ));
        showToast('File saved', 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to save file:', err);
        showToast('Failed to save file: ' + message, 'error');
      }
      return;
    }

    if (!editorInstance) return;

    let content: string;
    if (activeTab.isQuipu || activeTab.name.endsWith('.quipu')) {
      content = JSON.stringify({
        type: 'quipu',
        version: 1,
        content: editorInstance.getJSON(),
        metadata: {
          savedAt: new Date().toISOString(),
        },
      }, null, 2);
    } else if (activeTab.name.endsWith('.md') || activeTab.name.endsWith('.markdown')) {
      const markdown = (editorInstance.storage as Record<string, any>).markdown.getMarkdown();
      if (activeTab.frontmatter || activeTab.frontmatterRaw) {
        const yaml = activeTab.frontmatter
          ? jsYaml.dump(activeTab.frontmatter, { sortKeys: false, lineWidth: -1 })
          : activeTab.frontmatterRaw + '\n';
        content = `---\n${yaml}---\n\n${markdown}`;
      } else {
        content = markdown;
      }
    } else {
      content = editorInstance.getText();
    }

    try {
      recentSavesRef.current.set(activeTab.path, Date.now());
      await fs.writeFile(activeTab.path, content);
      // Update diskContent so file watcher doesn't trigger on our own save
      // Also clear any conflict state since saving resolves it
      setOpenTabs(prev => prev.map(t =>
        t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content, hasConflict: false, conflictDiskContent: null } : t
      ));
      showToast('File saved', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to save file:', err);
      showToast('Failed to save file: ' + message, 'error');
    }
  }, [activeTab, showToast]);

  const createNewFile = useCallback(async (parentPath: string, name: string) => {
    const filePath = parentPath + '/' + name;
    try {
      await fs.createFile(filePath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to create file:', err);
      showToast('Failed to create file: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const createNewFolder = useCallback(async (parentPath: string, name: string) => {
    const folderPath = parentPath + '/' + name;
    try {
      await fs.createFolder(folderPath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to create folder:', err);
      showToast('Failed to create folder: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const deleteEntry = useCallback(async (targetPath: string) => {
    try {
      await fs.deletePath(targetPath);
      // Close tab if file was open
      const tab = openTabs.find(t => t.path === targetPath);
      if (tab) {
        closeTab(tab.id);
      }
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to delete:', err);
      showToast('Failed to delete: ' + message, 'error');
    }
  }, [workspacePath, openTabs, closeTab, refreshDirectory, showToast]);

  const renameEntry = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renamePath(oldPath, newPath);
      // Update tab if file was open
      setOpenTabs(prev => prev.map(t =>
        t.path === oldPath ? { ...t, path: newPath, name: newPath.split('/').pop() || '' } : t
      ));
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to rename:', err);
      showToast('Failed to rename: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  // Helper: apply a fresh file content to a tab (parse frontmatter, reset dirty)
  const applyFreshContent = useCallback((tab: Tab, fresh: string): Partial<Tab> => {
    const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');
    let frontmatter: Frontmatter | null = null;
    let frontmatterRaw: string | null = null;
    let bodyContent: string = fresh;
    if (isMarkdown && typeof fresh === 'string') {
      const fm = extractFrontmatter(fresh);
      frontmatter = fm.frontmatter;
      frontmatterRaw = fm.frontmatterRaw;
      bodyContent = fm.body;
    }
    return { content: bodyContent, tiptapJSON: null, isDirty: false, diskContent: fresh, frontmatter, frontmatterRaw };
  }, [extractFrontmatter]);

  // Conflict resolution: reload from disk (discard local changes)
  const resolveConflictReload = useCallback(async (tabId: string) => {
    const tab = openTabsRef.current.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const fresh = (tab.conflictDiskContent as string) || await fs.readFile(tab.path);
      const updates = applyFreshContent(tab, fresh);
      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, ...updates, hasConflict: false, conflictDiskContent: null, reloadKey: (t.reloadKey || 0) + 1 } : t
      ));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Failed to reload file: ' + message, 'error');
    }
  }, [applyFreshContent, showToast]);

  // Conflict resolution: keep local changes (acknowledge the disk change)
  const resolveConflictKeep = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, hasConflict: false, conflictDiskContent: null } : t
    ));
  }, []);

  // Conflict resolution: dismiss (same as keep)
  const resolveConflictDismiss = useCallback((tabId: string) => {
    resolveConflictKeep(tabId);
  }, [resolveConflictKeep]);

  // Electron: use native directory watcher
  useEffect(() => {
    if (!window.electronAPI || !workspacePath) return;

    fs.watchDirectory(workspacePath);

    const cleanup = fs.onDirectoryChanged(async (rawEvent) => {
      const event = rawEvent as FileChangeEvent;
      const filename = event.filename ?? event.path;
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      // Skip if this file was saved by us recently (within 3s) — don't delete entry,
      // OS may fire multiple events for a single write
      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        if (tab.isDirty) {
          // Show conflict bar instead of just a toast
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
          ));
        } else {
          const updates = applyFreshContent(tab, fresh);
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
          ));
        }
      } catch { /* file may be temporarily inaccessible */ }
    });

    return cleanup;
  }, [workspacePath, applyFreshContent]);

  // Browser: use fileWatcher WebSocket for push-based file change notifications
  useEffect(() => {
    if (window.electronAPI || !workspacePath) return;

    fileWatcher.watch(workspacePath).catch(() => {});

    const cleanup = fileWatcher.onChanged(async (rawEvent) => {
      const event = rawEvent as FileChangeEvent;
      const filename = event.filename ?? event.path;
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      // Skip if this file was saved by us recently (within 3s) — don't delete entry,
      // OS may fire multiple events for a single write
      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        if (tab.isDirty) {
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
          ));
        } else {
          const updates = applyFreshContent(tab, fresh);
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
          ));
        }
      } catch { /* file may be temporarily inaccessible */ }
    });

    return () => {
      cleanup();
      fileWatcher.unwatch().catch(() => {});
    };
  }, [workspacePath, applyFreshContent]);

  // FRAME file watching: detect external changes to .frame.json files
  // and increment frameReloadKey on affected tabs so Editor re-loads annotations
  const frameCleanupRef = useRef<ReturnType<typeof frameService.watchFrames> | null>(null);

  useEffect(() => {
    if (!workspacePath) return;

    const cleanup = frameService.watchFrames(workspacePath, (changedFilePath: string) => {
      const tab = openTabsRef.current.find(t => t.path === changedFilePath);
      if (!tab) return;

      setOpenTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, frameReloadKey: ((t as Tab & { frameReloadKey?: number }).frameReloadKey || 0) + 1 } : t
      ));
    });

    frameCleanupRef.current = cleanup;

    if (cleanup.registerPath) {
      for (const tab of openTabsRef.current) {
        if (!tab.isMedia && !tab.isQuipu) {
          cleanup.registerPath(frameService.getFramePath(workspacePath, tab.path));
        }
      }
    }

    return cleanup;
  }, [workspacePath, showToast]);

  useEffect(() => {
    const cleanup = frameCleanupRef.current;
    if (!cleanup?.registerPath || !workspacePath) return;

    for (const tab of openTabs) {
      if (!tab.isMedia && !tab.isQuipu) {
        cleanup.registerPath(frameService.getFramePath(workspacePath, tab.path));
      }
    }
  }, [openTabs, workspacePath]);

  // Persist open tabs + expanded folders per workspace (debounced 500ms)
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

  const value: WorkspaceContextValue = {
    workspacePath,
    fileTree,
    activeFile,
    isDirty,
    expandedFolders,
    showFolderPicker,
    recentWorkspaces,
    openFolder,
    selectFolder,
    cancelFolderPicker,
    clearRecentWorkspaces,
    openFile,
    saveFile,
    setIsDirty,
    updateTabContent,
    toggleFolder,
    revealFolder,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    refreshDirectory,
    directoryVersion,
    // Tab functions
    openTabs,
    activeTabId,
    activeTab,
    closeTab,
    switchTab,
    closeOtherTabs,
    setTabDirty,
    snapshotTab,
    reloadTabFromDisk,
    // Terminal tabs
    terminalTabs,
    activeTerminalId,
    createTerminalTab,
    closeTerminalTab,
    switchTerminalTab,
    setTerminalClaudeRunning,
    clearAllTerminals,
    // Conflict resolution
    resolveConflictReload,
    resolveConflictKeep,
    resolveConflictDismiss,
    // Git status
    gitChangeCount,
    updateGitChangeCount,
    // Frontmatter functions
    updateFrontmatter,
    addFrontmatterProperty,
    removeFrontmatterProperty,
    renameFrontmatterKey,
    toggleFrontmatterCollapsed,
    addFrontmatterTag,
    removeFrontmatterTag,
    updateFrontmatterTag,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
