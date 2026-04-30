/**
 * File-store primitives for the file-based knowledge store.
 *
 * Thin wrappers over the dual-runtime `fileSystem` adapter that provide
 * JSON read/write/list/delete and a recursive-directory watcher. Used by
 * the higher-level domain stores (`agentFileStore`, `repoFileStore`,
 * `sessionCache`, `appConfigStore`) — this module has no dependencies on
 * those.
 *
 * Forward-slash paths are returned for relative paths in
 * `listJsonFilesRecursive` for portability across OSes; absolute paths
 * remain as the underlying filesystem provides them.
 */

import fs from './fileSystem';
import type { DirectoryEntry } from '../types/electron-api';

/** Joined directory + name in a forward-slash relative form. */
export interface JsonFileEntry {
  /** Path relative to the watched root, forward-slash separated. */
  relativePath: string;
  /** Full absolute path, useful when the caller wants to reload one. */
  absolutePath: string;
}

/** Coarse type emitted by the recursive watcher. */
export type WatchEventType = 'change' | 'rename';

/** Debounce window for coalescing rapid filesystem events. */
const WATCH_DEBOUNCE_MS = 200;

/**
 * Heuristic check for "file does not exist" across runtime variants.
 * Electron rejects with `Error: ENOENT...`; the Go REST adapter rejects
 * with `Failed to read file: ...` (HTTP 404 surfaced as a status text).
 */
function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOENT/i.test(message)) return true;
  if (/no such file/i.test(message)) return true;
  // Browser/REST 404 path.
  if (/404/.test(message)) return true;
  if (/not found/i.test(message)) return true;
  return false;
}

/**
 * Read a JSON file and return the parsed value.
 *
 * Returns `null` if the file does not exist (any flavour of ENOENT/404).
 * Throws if the file exists but contains invalid JSON, or if any other
 * I/O error occurs.
 */
export async function readJsonFile<T>(absPath: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
  // Empty file - treat as null so callers don't have to special-case.
  if (raw === '') return null;
  return JSON.parse(raw) as T;
}

/**
 * Atomically write a JSON file.
 *
 * Serializes `data` with `JSON.stringify(data, null, 2)`, writes to
 * `<absPath>.tmp`, then renames the temp file to `absPath`. The rename
 * is atomic on a single filesystem, so a crash between the write and
 * the rename leaves the destination untouched (only the `.tmp` file
 * needs cleanup).
 *
 * On any error before or during the rename, the function attempts to
 * delete the `.tmp` file (best-effort, errors are swallowed) and then
 * re-throws the original error.
 *
 * The underlying `writeFile` already creates parent directories on both
 * Electron and Go-server runtimes, so callers don't need to call
 * `ensureDir` first.
 */
export async function writeJsonFile(absPath: string, data: unknown): Promise<void> {
  const tmpPath = `${absPath}.tmp`;
  const serialized = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(tmpPath, serialized);
    await fs.renamePath(tmpPath, absPath);
  } catch (err) {
    // Best-effort cleanup of the temp file. Swallow cleanup errors so
    // the caller sees the original failure cause.
    try {
      await fs.deletePath(tmpPath);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

/**
 * Delete a file. Idempotent — silently swallows ENOENT/404 errors.
 *
 * Other I/O errors (permission denied, etc.) are re-thrown.
 */
export async function deleteFile(absPath: string): Promise<void> {
  try {
    await fs.deletePath(absPath);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

/**
 * Ensure a directory exists (mkdir -p semantics). Idempotent.
 *
 * Both the Electron `create-folder` IPC and the Go `/folder` endpoint
 * already use mkdir -p, so this is a thin pass-through that exists to
 * give callers a clearer name than `fs.createFolder`.
 */
export async function ensureDir(absPath: string): Promise<void> {
  await fs.createFolder(absPath);
}

/**
 * Recursively list JSON files under `absDir`.
 *
 * Excludes:
 * - any file whose name starts with `.` (so `.folder.json` markers and
 *   any other dotfile are filtered out)
 * - any file whose name does not end with `.json`
 *
 * Directories whose names start with `.` are still recursed into — the
 * dotfile filter applies to file names only, not the directory tree.
 * If you need to skip dot-directories, do it at the caller level.
 *
 * Relative paths are returned forward-slash separated and sorted
 * alphabetically for deterministic load order. Absolute paths are
 * whatever the underlying `readDirectory` adapter produced.
 *
 * If `absDir` does not exist (or is not readable as a directory) this
 * returns `[]` rather than throwing — first-load on a fresh workspace
 * is the dominant case and shouldn't crash.
 */
export async function listJsonFilesRecursive(absDir: string): Promise<JsonFileEntry[]> {
  const results: JsonFileEntry[] = [];

  async function walk(dirAbs: string, relPrefix: string): Promise<void> {
    let entries: DirectoryEntry[];
    try {
      entries = await fs.readDirectory(dirAbs);
    } catch {
      // Missing or unreadable directory — treat as empty.
      return;
    }
    for (const entry of entries) {
      const childRel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(entry.path, childRel);
        continue;
      }
      // Filter dotfiles (covers `.folder.json`, `.gitkeep`, etc.) and
      // require a `.json` extension.
      if (entry.name.startsWith('.')) continue;
      if (!entry.name.endsWith('.json')) continue;
      results.push({ relativePath: childRel, absolutePath: entry.path });
    }
  }

  await walk(absDir, '');
  results.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return results;
}

/**
 * Watch `absDir` recursively and invoke `onChange` on each event.
 *
 * Behaviour:
 * - Calls `fs.watchDirectory(absDir)` to set the active root, then
 *   subscribes via `fs.onDirectoryChanged`. Events are debounced by
 *   200ms so a burst of filesystem operations fires a single callback.
 * - The event has a coarse type (`'change' | 'rename'`) and the
 *   relative path reported by the underlying watcher (when available).
 *   Most callers should respond by re-listing the affected subtree
 *   rather than reasoning about specific paths.
 * - In browser mode the underlying adapter's `onDirectoryChanged`
 *   subscription is a no-op, so `onChange` will never fire and the
 *   returned unsubscribe function is also a no-op.
 *
 * IMPORTANT — single-active-root caveat:
 * The Electron file watcher in `electron/main.cjs` keeps ONE global
 * watcher; calling `watchDirRecursive` for a different `absDir` while
 * a previous subscription is alive will cancel the previous root.
 * The subscription model is multi-listener, so multiple callers can
 * share one root — but two callers wanting two roots simultaneously
 * is not supported. Higher-level callers (e.g. AgentContext +
 * RepoContext) should agree on a shared root such as the workspace's
 * `.quipu/` directory and filter events themselves.
 *
 * Returns an unsubscribe function. Calling it removes the listener but
 * does NOT clear the underlying watcher (other listeners may still
 * depend on it). The renderer's lifetime is short enough that this is
 * acceptable.
 */
export function watchDirRecursive(
  absDir: string,
  onChange: (event: { type: WatchEventType; path?: string }) => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  let lastEvent: { type: WatchEventType; path?: string } | null = null;
  let unsubscribed = false;

  const flush = (): void => {
    pending = null;
    if (unsubscribed || !lastEvent) return;
    const event = lastEvent;
    lastEvent = null;
    onChange(event);
  };

  // Subscribe BEFORE asking the adapter to watch — protects against the
  // theoretical race where an event fires before our listener is wired.
  // In browser mode this is a no-op subscription that returns a no-op
  // unsubscribe, and `watchDirectory` resolves to `null`.
  const unsubscribeListener = fs.onDirectoryChanged((rawEvent) => {
    if (unsubscribed) return;
    const type: WatchEventType = rawEvent.type === 'rename' ? 'rename' : 'change';
    lastEvent = { type, path: rawEvent.path };
    if (pending !== null) return;
    pending = setTimeout(flush, WATCH_DEBOUNCE_MS);
  });

  // Fire-and-forget — failure to wire up the watcher shouldn't crash
  // the renderer, just mean events won't arrive.
  void fs.watchDirectory(absDir).catch(() => {
    /* swallow */
  });

  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    unsubscribeListener();
  };
}
