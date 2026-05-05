/**
 * Session-cache service.
 *
 * Persists chat transcripts (`AgentSession`) under
 * `~/.quipu/sessions-cache/<workspace-hash>/<agent-id>.json` so they are
 * available across app restarts without polluting the workspace's own
 * `.quipu/` knowledge tree. Sessions are runtime cache, NOT workspace
 * content — they live in the user's home directory, keyed by a stable
 * hash of the workspace's absolute path.
 *
 * Layout:
 *
 *   ~/.quipu/sessions-cache/
 *     <hash>/                  # SHA-1[:12] of the absolute workspace path
 *       manifest.json          # { "<hash>": "/abs/workspace/path" } — informational
 *       research/web-scraping/foo.json   # transcript for agent id "research/web-scraping/foo"
 *       frame-responder.json             # transcript for agent id "frame-responder"
 *
 * The manifest file is written/refreshed on every save and exists purely
 * for human inspection (e.g. when debugging which workspace a hash maps
 * to). The code never reads it back.
 */

import fs from './fileSystem';
import {
  readJsonFile,
  writeJsonFile,
  deleteFile,
  ensureDir,
} from './quipuFileStore';
import type { AgentSession } from '@/types/agent';

/** In-process cache of workspace path -> 12-char hash. */
const hashCache = new Map<string, string>();

/** Resolved `~` cached after first lookup; never changes within a process. */
let homeDirPromise: Promise<string> | null = null;

/** Hex SHA-1 of `input` via Web Crypto. */
async function sha1Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Stable 12-char hex hash of the absolute workspace path, derived via
 * SHA-1. Cached in-process so repeated lookups for the same workspace
 * are free.
 *
 * Returned as a Promise<string> — the spec listed `string`, but Web
 * Crypto's `digest()` is async and there's no synchronous fallback that
 * works in both the Electron renderer and a browser, so the API is
 * uniformly async. All consumers in this module already await it.
 */
export async function workspaceHash(workspacePath: string): Promise<string> {
  const cached = hashCache.get(workspacePath);
  if (cached !== undefined) return cached;
  const full = await sha1Hex(workspacePath);
  const short = full.slice(0, 12);
  hashCache.set(workspacePath, short);
  return short;
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

/** Absolute path to `~/.quipu/sessions-cache/<hash>/`. */
async function workspaceCacheDir(workspacePath: string): Promise<string> {
  const home = await getHomeDir();
  const hash = await workspaceHash(workspacePath);
  return joinAbs(home, '.quipu', 'sessions-cache', hash);
}

/** Absolute path to the JSON file for a given (workspace, agentId). */
async function sessionFilePath(workspacePath: string, agentId: string): Promise<string> {
  const dir = await workspaceCacheDir(workspacePath);
  return `${joinAbs(dir, agentId)}.json`;
}

/** Absolute path to the per-workspace manifest file. */
async function manifestPath(workspacePath: string): Promise<string> {
  const dir = await workspaceCacheDir(workspacePath);
  return joinAbs(dir, 'manifest.json');
}

/**
 * Best-effort cleanup of empty parent directories under the workspace
 * cache root. Stops at the workspace cache root itself (we never delete
 * `<hash>/`). Errors are swallowed — this is a hygiene step, not a
 * correctness requirement.
 */
async function pruneEmptyParents(filePath: string, stopAt: string): Promise<void> {
  // Find the parent dir of the deleted file by trimming the last path segment.
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep <= 0) return;
  let dir = filePath.slice(0, lastSep);
  // Normalize stopAt for comparison (strip trailing slash if present).
  const stopAtNormalized = stopAt.replace(/[/\\]+$/, '');

  while (dir.length > stopAtNormalized.length && dir.startsWith(stopAtNormalized)) {
    try {
      const entries = await fs.readDirectory(dir);
      if (entries.length > 0) return;
      await fs.deletePath(dir);
    } catch {
      return;
    }
    const nextSep = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'));
    if (nextSep <= 0) return;
    dir = dir.slice(0, nextSep);
  }
}

/**
 * Load the persisted session for `agentId` under `workspacePath`. Returns
 * `null` if no cache file exists.
 */
export async function loadSession(
  workspacePath: string,
  agentId: string,
): Promise<AgentSession | null> {
  const abs = await sessionFilePath(workspacePath, agentId);
  return readJsonFile<AgentSession>(abs);
}

/**
 * Atomically write `session` to the cache file for `(workspacePath, agentId)`.
 * Also refreshes the manifest at `<hash>/manifest.json` so the directory
 * is human-inspectable.
 */
export async function saveSession(
  workspacePath: string,
  agentId: string,
  session: AgentSession,
): Promise<void> {
  const abs = await sessionFilePath(workspacePath, agentId);
  // Ensure the directory exists. writeJsonFile's underlying writeFile
  // already creates parent dirs, but doing it explicitly here is cheap
  // and makes the manifest write safe in the same step.
  const dir = await workspaceCacheDir(workspacePath);
  await ensureDir(dir);
  await writeJsonFile(abs, session);

  // Refresh the manifest. Single-key object — overwriting on every save
  // is idempotent and inexpensive.
  const hash = await workspaceHash(workspacePath);
  const manifestAbs = await manifestPath(workspacePath);
  await writeJsonFile(manifestAbs, { [hash]: workspacePath });
}

/**
 * Delete the cache file for `(workspacePath, agentId)`. Idempotent — a
 * missing file is not an error. Best-effort cleanup of newly-empty
 * parent directories under the workspace cache root.
 */
export async function deleteSession(workspacePath: string, agentId: string): Promise<void> {
  const abs = await sessionFilePath(workspacePath, agentId);
  await deleteFile(abs);
  const cacheDir = await workspaceCacheDir(workspacePath);
  await pruneEmptyParents(abs, cacheDir);
}

/**
 * Move a session cache file from `oldAgentId` to `newAgentId` within the
 * same workspace. Implemented as load + save + delete (rather than
 * rename) because old and new can live in different subdirectories
 * after a slug or folder change. On failure mid-way, both files may
 * exist; the caller can retry.
 *
 * If no session exists for `oldAgentId`, this is a no-op.
 */
export async function renameSession(
  workspacePath: string,
  oldAgentId: string,
  newAgentId: string,
): Promise<void> {
  if (oldAgentId === newAgentId) return;
  const existing = await loadSession(workspacePath, oldAgentId);
  if (existing === null) return;
  await saveSession(workspacePath, newAgentId, existing);
  await deleteSession(workspacePath, oldAgentId);
}
