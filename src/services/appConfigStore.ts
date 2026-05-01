/**
 * App-config store.
 *
 * Persists per-machine app state — recent workspaces and last-opened
 * workspace per window — under `~/.quipu/`. Replaces the legacy
 * `recentWorkspaces` and `lastOpenedWorkspace` keys that lived inside
 * `quipu-state.json`.
 *
 * Layout:
 *
 *   ~/.quipu/
 *     recent-workspaces.json   # { schemaVersion: 1, list: RecentWorkspaceEntry[] }
 *     window-state.json        # { schemaVersion: 1, lastOpenedWorkspace: string | null }
 *
 * Schema-versioned for forward compatibility. Reads are tolerant — a
 * missing file, malformed JSON, or an older/unknown schema version all
 * resolve to safe defaults rather than throwing. Writes are atomic via
 * `quipuFileStore.writeJsonFile` (tmp + rename).
 *
 * Browser-mode fallback: when running outside Electron, `~/.quipu/`
 * doesn't make sense, so this module falls back to `localStorage` using
 * the same keys the legacy `storageService` used (`recentWorkspaces`
 * and `lastOpenedWorkspace`). Callers don't need to branch — the
 * runtime check happens internally.
 */

import fs from './fileSystem';
import {
  readJsonFile,
  writeJsonFile,
  ensureDir,
} from './quipuFileStore';

/** Per-entry shape for the recent-workspaces list. Matches `RecentWorkspace`. */
export interface RecentWorkspaceEntry {
  path: string;
  name: string;
  /** ISO 8601. */
  lastOpened: string;
}

interface RecentWorkspacesFile {
  schemaVersion: number;
  list: RecentWorkspaceEntry[];
}

interface WindowStateFile {
  schemaVersion: number;
  lastOpenedWorkspace: string | null;
}

const SCHEMA_VERSION = 1;

const RECENT_WORKSPACES_FILENAME = 'recent-workspaces.json';
const WINDOW_STATE_FILENAME = 'window-state.json';

const LOCAL_STORAGE_RECENTS_KEY = 'recentWorkspaces';
const LOCAL_STORAGE_LAST_OPENED_KEY = 'lastOpenedWorkspace';

/** Resolved `~` cached after first lookup; never changes within a process. */
let homeDirPromise: Promise<string> | null = null;

/**
 * Detect Electron runtime. Mirrors the check in `storageService.ts` —
 * presence of the `electronAPI` bridge with a working `storageGet` is
 * the canonical signal. When false, we're either in the Vite browser
 * dev server or a browser-only deploy, and `~/.quipu/` is not available.
 */
function isElectron(): boolean {
  return !!(typeof window !== 'undefined' && window.electronAPI && window.electronAPI.storageGet);
}

/** Resolve `~` once per process via the existing fileSystem adapter. */
function getHomeDir(): Promise<string> {
  if (homeDirPromise === null) {
    homeDirPromise = fs.getHomeDir();
  }
  return homeDirPromise;
}

/** Forward-slash path join; tolerates trailing slashes on `base`. */
function joinAbs(base: string, ...rest: string[]): string {
  let result = base;
  for (const r of rest) {
    if (r === '') continue;
    if (result.endsWith('/') || result.endsWith('\\')) {
      result = `${result}${r}`;
    } else {
      result = `${result}/${r}`;
    }
  }
  return result;
}

/** Absolute path to `~/.quipu/`. */
async function configDir(): Promise<string> {
  const home = await getHomeDir();
  return joinAbs(home, '.quipu');
}

async function recentWorkspacesPath(): Promise<string> {
  return joinAbs(await configDir(), RECENT_WORKSPACES_FILENAME);
}

async function windowStatePath(): Promise<string> {
  return joinAbs(await configDir(), WINDOW_STATE_FILENAME);
}

/**
 * Load the recent-workspaces list from `~/.quipu/recent-workspaces.json`.
 *
 * Returns `[]` if the file doesn't exist or is malformed (invalid JSON,
 * wrong shape, missing `list` field, etc.). In browser mode, falls back
 * to `localStorage['recentWorkspaces']`.
 */
export async function loadRecentWorkspaces(): Promise<RecentWorkspaceEntry[]> {
  if (isElectron()) {
    try {
      const abs = await recentWorkspacesPath();
      const data = await readJsonFile<RecentWorkspacesFile>(abs);
      if (data && Array.isArray(data.list)) {
        return data.list;
      }
      return [];
    } catch {
      // Malformed JSON, unreadable file, or any other I/O hiccup —
      // degrade to empty rather than crashing the renderer.
      return [];
    }
  }
  // Browser fallback: localStorage with the legacy key shape.
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(LOCAL_STORAGE_RECENTS_KEY)
      : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Atomically write the recent-workspaces list. Creates `~/.quipu/` if
 * missing. In browser mode, persists to `localStorage['recentWorkspaces']`.
 */
export async function saveRecentWorkspaces(list: RecentWorkspaceEntry[]): Promise<void> {
  if (isElectron()) {
    const dir = await configDir();
    await ensureDir(dir);
    const abs = await recentWorkspacesPath();
    const payload: RecentWorkspacesFile = { schemaVersion: SCHEMA_VERSION, list };
    await writeJsonFile(abs, payload);
    return;
  }
  // Browser fallback.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_RECENTS_KEY, JSON.stringify(list));
    }
  } catch {
    // Quota exceeded or other localStorage failure — degrade silently
    // to match the legacy storageService behaviour.
  }
}

/**
 * Load the most recently opened workspace path from
 * `~/.quipu/window-state.json`. Returns `null` if the file doesn't
 * exist, is malformed, or the field is empty. In browser mode, falls
 * back to `localStorage['lastOpenedWorkspace']`.
 */
export async function loadLastOpenedWorkspace(): Promise<string | null> {
  if (isElectron()) {
    try {
      const abs = await windowStatePath();
      const data = await readJsonFile<WindowStateFile>(abs);
      if (data && typeof data.lastOpenedWorkspace === 'string' && data.lastOpenedWorkspace.length > 0) {
        return data.lastOpenedWorkspace;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(LOCAL_STORAGE_LAST_OPENED_KEY)
      : null;
    if (!raw) return null;
    // Stored as a JSON string for parity with the storageService shape.
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && parsed.length > 0) return parsed;
      return null;
    } catch {
      // Fallback: treat the raw value as a path if it isn't valid JSON.
      return raw;
    }
  } catch {
    return null;
  }
}

/**
 * Atomically write the last-opened workspace path. Creates `~/.quipu/`
 * if missing. Pass `null` to clear it. In browser mode, persists to
 * `localStorage['lastOpenedWorkspace']`.
 */
export async function saveLastOpenedWorkspace(path: string | null): Promise<void> {
  if (isElectron()) {
    const dir = await configDir();
    await ensureDir(dir);
    const abs = await windowStatePath();
    const payload: WindowStateFile = {
      schemaVersion: SCHEMA_VERSION,
      lastOpenedWorkspace: path,
    };
    await writeJsonFile(abs, payload);
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (path === null) {
        localStorage.removeItem(LOCAL_STORAGE_LAST_OPENED_KEY);
      } else {
        localStorage.setItem(LOCAL_STORAGE_LAST_OPENED_KEY, JSON.stringify(path));
      }
    }
  } catch {
    /* swallow */
  }
}

/**
 * Test-only escape hatch: reset the cached home dir promise so tests
 * using `vi.resetModules` + a per-test tmp home can re-resolve. Calling
 * it in production has no observable effect besides one extra
 * `fs.getHomeDir()` call on the next access.
 */
export function __resetHomeDirCacheForTests(): void {
  homeDirPromise = null;
}
