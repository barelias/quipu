/**
 * Domain service for agents — load all, save one, delete one, plus folder
 * operations. Built on the file-store primitives in `quipuFileStore` and
 * the slug helpers in `slug`.
 *
 * Layout assumption: `<workspacePath>/.quipu/agents/<folder>/<slug>.json`.
 * - Multi-level folders are real on-disk directories.
 * - An entity's id is its folder-relative slug-path (`research/foo`),
 *   derived at load time from the file's location. The id is NOT
 *   serialized — `folder` and `slug` are, for self-description.
 * - Empty folders persist via a `.folder.json` marker file.
 */

import fs from './fileSystem';
import {
  readJsonFile,
  writeJsonFile,
  deleteFile,
  ensureDir,
  listJsonFilesRecursive,
} from './quipuFileStore';
import {
  joinId,
  splitId,
  disambiguateSlug,
} from './slug';
import type { Agent } from '@/types/agent';

/**
 * One declared folder. Empty folders persist via a `.folder.json`
 * marker file; folders that contain at least one agent are implicit
 * (a real directory exists on disk).
 */
export interface FolderNode {
  /** Forward-slash separated path relative to .quipu/agents/. Empty for the root (rare). */
  path: string;
  /** Optional human-readable display name from .folder.json (capitalization etc.). */
  displayName?: string;
}

/** Path-segment join that always uses forward slashes between segments. */
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

/** Compute the on-disk root for agents under a workspace. */
function agentsRoot(workspacePath: string): string {
  return joinAbs(workspacePath, '.quipu', 'agents');
}

/** Given a folder-relative id (`research/foo`), build the absolute file path. */
function agentFilePath(workspacePath: string, id: string): string {
  return `${joinAbs(agentsRoot(workspacePath), id)}.json`;
}

/** Given a folder path (possibly empty), build the absolute directory path. */
function folderAbsPath(workspacePath: string, folderPath: string): string {
  const root = agentsRoot(workspacePath);
  if (folderPath === '') return root;
  return joinAbs(root, folderPath);
}

/**
 * Strip the trailing `.json` from a relative path so it can be used as
 * an entity id. `research/web-scraping/foo.json` -> `research/web-scraping/foo`.
 */
function relPathToId(relativePath: string): string {
  if (relativePath.endsWith('.json')) {
    return relativePath.slice(0, -'.json'.length);
  }
  return relativePath;
}

/**
 * Given a record loaded from disk, normalize it into an Agent:
 * - Fill `id` from the on-disk path (the canonical source of truth).
 * - Fill `folder` and `slug` from the same path so they always match.
 * - Pass through everything else.
 *
 * Throws if the record fails the most basic shape check (missing `name`,
 * for example) — callers translate those throws into "skip + warn".
 */
function normalizeLoaded(raw: unknown, relativePath: string): Agent {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Agent file is not an object');
  }
  const record = raw as Partial<Agent> & { id?: unknown; slug?: unknown; folder?: unknown };
  const id = relPathToId(relativePath);
  const { folder, slug } = splitId(id);
  if (typeof record.name !== 'string') {
    throw new Error('Agent file is missing required "name" field');
  }
  return {
    ...record,
    id,
    slug,
    folder,
    name: record.name,
    kind: record.kind ?? 'agent',
    systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
    model: typeof record.model === 'string' ? record.model : '',
    bindings: Array.isArray(record.bindings) ? record.bindings : [],
    permissionMode: record.permissionMode ?? 'default',
    allowedTools: Array.isArray(record.allowedTools) ? record.allowedTools : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  } as Agent;
}

/** Strip derived fields before serializing an agent to disk. */
function toDiskRecord(agent: Agent, slug: string, folder: string): Record<string, unknown> {
  // Spread, drop derived fields, then enforce the canonical shape.
  // `id` is derived from the file location and must not be persisted.
  const record: Record<string, unknown> = { ...agent };
  delete record.id;
  record.schemaVersion = 1;
  record.slug = slug;
  record.folder = folder;
  return record;
}

/**
 * Load every agent file under `<workspacePath>/.quipu/agents/`.
 *
 * Each file's id is derived from its on-disk location; the persisted
 * record is not expected to contain an `id` field. Records that fail
 * to parse are logged via `console.warn` and skipped — one bad file
 * never prevents the rest from loading.
 *
 * Returns agents sorted by id for deterministic ordering.
 */
export async function loadAllAgents(workspacePath: string): Promise<Agent[]> {
  const root = agentsRoot(workspacePath);
  const entries = await listJsonFilesRecursive(root);
  const agents: Agent[] = [];
  for (const entry of entries) {
    try {
      const raw = await readJsonFile<unknown>(entry.absolutePath);
      if (raw === null) continue;
      agents.push(normalizeLoaded(raw, entry.relativePath));
    } catch (err) {
      // One bad file shouldn't take down the whole workspace.
      console.warn('[agents] failed to load', entry.relativePath, err);
    }
  }
  agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return agents;
}

/**
 * Walk a directory tree under `root` and yield every subdirectory's
 * relative path (forward-slash separated). Returns `[]` if root is missing.
 */
async function listSubdirectoriesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readDirectory(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const childRel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      out.push(childRel);
      await walk(entry.path, childRel);
    }
  }

  await walk(root, '');
  return out;
}

/**
 * Load every declared folder, both via `.folder.json` markers and via
 * implicit ancestors of any agent file.
 *
 * Returned folders are deduped by path and sorted by path. The root
 * folder (path `''`) is NOT included even if `.quipu/agents/.folder.json`
 * happens to exist — only sub-folders are useful to UI consumers.
 */
export async function loadAllFolders(workspacePath: string): Promise<FolderNode[]> {
  const root = agentsRoot(workspacePath);
  const byPath = new Map<string, FolderNode>();

  // 1. Real on-disk directories.
  const subdirs = await listSubdirectoriesRecursive(root);
  for (const path of subdirs) {
    if (path === '') continue;
    byPath.set(path, { path });
    // Try to enrich with a .folder.json marker if present.
    const markerAbs = joinAbs(root, path, '.folder.json');
    try {
      const marker = await readJsonFile<{ displayName?: string }>(markerAbs);
      if (marker && typeof marker.displayName === 'string') {
        byPath.set(path, { path, displayName: marker.displayName });
      }
    } catch {
      // Ignore malformed markers; folder is still listed without the displayName.
    }
  }

  // 2. Implicit ancestors of every agent file.
  const entries = await listJsonFilesRecursive(root);
  for (const entry of entries) {
    const id = relPathToId(entry.relativePath);
    const { folder } = splitId(id);
    if (folder === '') continue;
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const ancestor = parts.slice(0, i).join('/');
      if (!byPath.has(ancestor)) {
        byPath.set(ancestor, { path: ancestor });
      }
    }
  }

  return Array.from(byPath.values()).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/**
 * Save `agent` to disk. The agent's id is recomputed from its current
 * folder + slug. If `previousId` is provided AND differs from the new
 * computed id, the old file is deleted after the new one is written
 * (atomic rename semantics: write new, then delete old, never the reverse).
 *
 * Returns the new id.
 *
 * Caller is responsible for normalizing `agent.folder` (via
 * `normalizeFolder`) and slugifying `agent.slug` (via `slugify` +
 * `disambiguateSlug`) BEFORE calling this. This service does not
 * second-guess slug shape — that's a domain decision belonging to the
 * UI / context layer.
 */
export async function saveAgent(
  workspacePath: string,
  agent: Agent,
  previousId?: string,
): Promise<string> {
  const folder = agent.folder ?? '';
  const slug = agent.slug ?? '';
  if (slug === '') {
    throw new Error('saveAgent: agent.slug is required');
  }
  const newId = joinId(folder, slug);
  const newAbs = agentFilePath(workspacePath, newId);
  const record = toDiskRecord(agent, slug, folder);
  await ensureDir(folderAbsPath(workspacePath, folder));
  await writeJsonFile(newAbs, record);
  // Atomic rename semantics: write new first, then delete old.
  if (previousId !== undefined && previousId !== newId) {
    const oldAbs = agentFilePath(workspacePath, previousId);
    await deleteFile(oldAbs);
  }
  return newId;
}

/**
 * Delete the agent's JSON file. Idempotent — missing files are not an
 * error. Caller decides whether to also clear session cache.
 */
export async function deleteAgent(workspacePath: string, id: string): Promise<void> {
  const abs = agentFilePath(workspacePath, id);
  await deleteFile(abs);
}

/**
 * Recursive directory rename. Children's folder paths update implicitly
 * because they're derived from the on-disk path.
 *
 * Throws if `newPath` already exists (the underlying renamePath errors
 * on a destination collision; we don't try to merge directories).
 *
 * Caller is responsible for normalizing both paths via `normalizeFolder`.
 */
export async function renameFolder(
  workspacePath: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === '' || newPath === '') {
    throw new Error('renameFolder: cannot rename the root folder');
  }
  if (oldPath === newPath) return;
  const oldAbs = folderAbsPath(workspacePath, oldPath);
  const newAbs = folderAbsPath(workspacePath, newPath);
  // Ensure the destination's parent directory exists, but NOT the
  // destination itself — renamePath onto an existing dir is the error
  // we want to surface.
  const slashIdx = newPath.lastIndexOf('/');
  const parent = slashIdx === -1 ? '' : newPath.slice(0, slashIdx);
  await ensureDir(folderAbsPath(workspacePath, parent));
  await fs.renamePath(oldAbs, newAbs);
}

/**
 * Delete a folder.
 *
 * - With `recursive: true`, all children (agents and subdirectories) are
 *   removed in one shot.
 * - With `recursive: false` (default), children agents are moved into
 *   the parent folder (or root) preserving slugs, with disambiguation
 *   if the destination already has a sibling using the same slug. The
 *   folder itself is then removed (it's empty by then).
 */
export async function deleteFolder(
  workspacePath: string,
  folderPath: string,
  options?: { recursive?: boolean },
): Promise<void> {
  if (folderPath === '') {
    throw new Error('deleteFolder: cannot delete the root folder');
  }
  const recursive = options?.recursive ?? false;
  const abs = folderAbsPath(workspacePath, folderPath);

  if (recursive) {
    await fs.deletePath(abs);
    return;
  }

  // Move children up. Resolve the destination folder once.
  const slashIdx = folderPath.lastIndexOf('/');
  const destFolder = slashIdx === -1 ? '' : folderPath.slice(0, slashIdx);

  // Find every agent file currently under this folder.
  const entries = await listJsonFilesRecursive(abs);
  if (entries.length > 0) {
    // Build a set of slugs already present in the destination folder so
    // we can disambiguate in a single pass.
    const allAgents = await loadAllAgents(workspacePath);
    const destSiblings = new Set(
      allAgents
        .filter((a) => (a.folder ?? '') === destFolder)
        // Skip agents that live inside the folder being collapsed —
        // they're about to move out, so they aren't really siblings.
        .filter((a) => !idIsInsideFolder(a.id, folderPath))
        .map((a) => a.slug ?? splitId(a.id).slug),
    );

    for (const entry of entries) {
      const oldId = relPathToId(entry.relativePath);
      // `entry.relativePath` here is RELATIVE TO `abs` (the deleted
      // folder's root), so the slug component is the leaf of that path.
      const oldFullId = `${folderPath}/${oldId}`;
      const oldSlug = splitId(oldId).slug;
      const newSlug = disambiguateSlug(oldSlug, destSiblings);
      destSiblings.add(newSlug);

      // Read, rewrite slug+folder, save into destination, delete original.
      const raw = await readJsonFile<unknown>(entry.absolutePath);
      if (raw === null) continue;
      let agent: Agent;
      try {
        agent = normalizeLoaded(raw, entry.relativePath);
      } catch (err) {
        console.warn('[agents] deleteFolder: failed to load child', entry.relativePath, err);
        continue;
      }
      agent.folder = destFolder;
      agent.slug = newSlug;
      await saveAgent(workspacePath, agent, oldFullId);
    }
  }

  // Whatever remains (folder markers, empty subdirs) is wiped.
  await fs.deletePath(abs);
}

/** True if `id` lives inside `folderPath` (or one of its descendants). */
function idIsInsideFolder(id: string, folderPath: string): boolean {
  if (folderPath === '') return true;
  return id === folderPath || id.startsWith(`${folderPath}/`);
}

/**
 * Create an empty folder by writing a `.folder.json` marker file.
 * Idempotent — if the marker already exists, it's overwritten with the
 * new metadata (preserving the original `createdAt` if present).
 */
export async function createFolder(
  workspacePath: string,
  folderPath: string,
  displayName?: string,
): Promise<void> {
  if (folderPath === '') {
    throw new Error('createFolder: cannot create the root folder');
  }
  const dirAbs = folderAbsPath(workspacePath, folderPath);
  await ensureDir(dirAbs);
  const markerAbs = joinAbs(dirAbs, '.folder.json');

  // Preserve createdAt across re-creates; if the marker exists already
  // we keep its original timestamp.
  let createdAt = new Date().toISOString();
  try {
    const existing = await readJsonFile<{ createdAt?: string }>(markerAbs);
    if (existing && typeof existing.createdAt === 'string') {
      createdAt = existing.createdAt;
    }
  } catch {
    // Ignore parse errors — we'll overwrite with a fresh marker.
  }

  const marker: Record<string, unknown> = {
    schemaVersion: 1,
    createdAt,
  };
  if (displayName !== undefined) marker.displayName = displayName;

  await writeJsonFile(markerAbs, marker);
}
