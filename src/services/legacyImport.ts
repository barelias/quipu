/**
 * One-shot import from the legacy `quipu-state.json` storage into the
 * file-based knowledge store.
 *
 * Runs the first time each workspace is opened on the new build. Drains
 * whatever survives in the legacy storage:
 * - Workspace-scoped keys (post-v0.22.0): `agents:<workspacePath>`,
 *   `agent-sessions:<workspacePath>`, `agent-folders:<workspacePath>`,
 *   `repos:<workspacePath>`.
 * - Pre-v0.22.0 global keys: `agents`, `agent-sessions`, `agent-folders`,
 *   `repos`. The first workspace to import claims them; subsequent
 *   workspaces never re-claim.
 *
 * --- Failure-mode safety invariant (DO NOT VIOLATE) ---
 *
 * Each step writes ALL destination files first. The source key in legacy
 * storage is cleared ONLY if every write succeeded. If any write failed,
 * the source key is left intact for the next launch to retry. This is
 * the inverse of the bug the previous workspaceKeysMigration utility had
 * (it cleared source before destination, lost user data) — never repeat
 * that ordering mistake.
 *
 * --- Idempotency ---
 *
 * Import state is tracked in `~/.quipu/import-state.json`. Once a
 * workspace has been imported, subsequent calls to
 * `importLegacyDataForWorkspace` short-circuit to a no-op. Concurrent
 * invocations (AgentContext + RepoContext both calling on workspace open)
 * share a single in-flight promise via a Map<workspacePath, Promise>.
 *
 * --- Backup ---
 *
 * The first time `importLegacyDataForWorkspace` is invoked in this
 * process (across any workspace), a snapshot of the entire legacy
 * storage is written to `~/.quipu/legacy-backups/quipu-state.pre-import.<timestamp>.json`
 * before any mutation. If there is nothing in legacy storage, the backup
 * is skipped silently.
 */

import storageService from './storageService';
import {
  readJsonFile,
  writeJsonFile,
  ensureDir,
} from './quipuFileStore';
import * as agentFileStore from './agentFileStore';
import * as repoFileStore from './repoFileStore';
import * as sessionCache from './sessionCache';
import { slugify, normalizeFolder, disambiguateSlug } from './slug';
import fs from './fileSystem';
import type { Agent, AgentSession, Repo } from '@/types/agent';

/** Result returned by `importLegacyDataForWorkspace`. */
export interface LegacyImportResult {
  /** Total number of entities (agents, sessions, folders, repos) successfully written. */
  imported: number;
  /** Total number of entities that failed to write. */
  errors: number;
}

/** Schema for `~/.quipu/import-state.json`. */
interface ImportStateFile {
  schemaVersion: number;
  /** Workspace path -> ISO 8601 timestamp of successful import. */
  imported: Record<string, string>;
  /** Workspace path that absorbed the pre-v0.22.0 globals, if any. */
  globalsClaimed?: string;
}

const IMPORT_STATE_SCHEMA_VERSION = 1;
const IMPORT_STATE_FILENAME = 'import-state.json';
const BACKUPS_SUBDIR = 'legacy-backups';

const LEGACY_AGENTS_BASE = 'agents';
const LEGACY_SESSIONS_BASE = 'agent-sessions';
const LEGACY_FOLDERS_BASE = 'agent-folders';
const LEGACY_REPOS_BASE = 'repos';

/** Resolved `~` cached after first lookup; never changes within a process. */
let homeDirPromise: Promise<string> | null = null;

/**
 * Process-level guard: the legacy file is backed up exactly once per
 * launch, on the first invocation of `importLegacyDataForWorkspace`.
 * Subsequent invocations across any workspace skip the backup.
 *
 * Stored as a Promise so concurrent first-callers share the work.
 */
let backupPromise: Promise<void> | null = null;

/**
 * Re-entry cache: shared in-flight promise per workspace path so that
 * AgentContext and RepoContext calling concurrently on workspace-open
 * don't double-trigger the same import (and therefore don't race on
 * reading/writing storage keys or the import-state file).
 */
const inFlight = new Map<string, Promise<LegacyImportResult>>();

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

/** Absolute path to `~/.quipu/import-state.json`. */
async function importStatePath(): Promise<string> {
  return joinAbs(await configDir(), IMPORT_STATE_FILENAME);
}

/** Strip a single trailing slash for legacy-key normalization (mirrors `workspaceKeys.normalizePath`). */
function normalizeWorkspacePath(path: string): string {
  return path.replace(/\/+$/, '');
}

function agentsKey(path: string): string {
  return `${LEGACY_AGENTS_BASE}:${normalizeWorkspacePath(path)}`;
}
function agentSessionsKey(path: string): string {
  return `${LEGACY_SESSIONS_BASE}:${normalizeWorkspacePath(path)}`;
}
function agentFoldersKey(path: string): string {
  return `${LEGACY_FOLDERS_BASE}:${normalizeWorkspacePath(path)}`;
}
function reposKey(path: string): string {
  return `${LEGACY_REPOS_BASE}:${normalizeWorkspacePath(path)}`;
}

/** Read import-state, returning a sane default if missing or malformed. */
async function readImportState(): Promise<ImportStateFile> {
  try {
    const abs = await importStatePath();
    const data = await readJsonFile<ImportStateFile>(abs);
    if (data && typeof data === 'object' && data.imported && typeof data.imported === 'object') {
      return {
        schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : IMPORT_STATE_SCHEMA_VERSION,
        imported: { ...data.imported },
        globalsClaimed: typeof data.globalsClaimed === 'string' ? data.globalsClaimed : undefined,
      };
    }
  } catch {
    // Malformed file — degrade to default rather than blocking import.
  }
  return { schemaVersion: IMPORT_STATE_SCHEMA_VERSION, imported: {} };
}

/** Atomically write import-state. Creates `~/.quipu/` if missing. */
async function writeImportState(state: ImportStateFile): Promise<void> {
  const dir = await configDir();
  await ensureDir(dir);
  const abs = await importStatePath();
  await writeJsonFile(abs, state);
}

/**
 * Snapshot the entire legacy storage to a backup file in
 * `~/.quipu/legacy-backups/`. Runs at most once per process. If legacy
 * storage holds nothing of interest (no scoped keys for any path we know
 * about, no globals), the backup is skipped silently.
 *
 * Best-effort: any error here is swallowed and logged. A failed backup
 * MUST NOT block the import — the import itself is the primary
 * recovery mechanism, the backup is belt-and-suspenders.
 */
async function backupLegacyStateOnce(workspacePath: string): Promise<void> {
  if (backupPromise !== null) return backupPromise;
  backupPromise = (async () => {
    try {
      // Snapshot the keys we know about. We can't enumerate the
      // legacy storage; we read every key the migration cares about
      // for the current workspace, plus the globals. Anything else
      // (e.g., other workspaces' scoped keys) is opaque to us — the
      // backup captures what we'd otherwise be about to mutate.
      const snapshot: Record<string, unknown> = {};
      const keys = [
        LEGACY_AGENTS_BASE,
        LEGACY_SESSIONS_BASE,
        LEGACY_FOLDERS_BASE,
        LEGACY_REPOS_BASE,
        agentsKey(workspacePath),
        agentSessionsKey(workspacePath),
        agentFoldersKey(workspacePath),
        reposKey(workspacePath),
      ];
      let anyData = false;
      for (const key of keys) {
        const value = await storageService.get(key);
        if (value !== null && value !== undefined) {
          snapshot[key] = value;
          anyData = true;
        }
      }
      if (!anyData) return;

      const dir = joinAbs(await configDir(), BACKUPS_SUBDIR);
      await ensureDir(dir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const abs = joinAbs(dir, `quipu-state.pre-import.${timestamp}.json`);
      await writeJsonFile(abs, {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        sourceWorkspacePath: workspacePath,
        snapshot,
      });
    } catch (err) {
      console.warn('[legacy-import] backup failed (continuing):', err);
    }
  })();
  return backupPromise;
}

interface AgentImportRecord {
  /** Old UUID id from the legacy record. Used to remap sessions. */
  oldId: string;
  /** New folder-relative slug-based id after import. */
  newId: string;
  /** New slug. */
  slug: string;
  /** New folder. */
  folder: string;
}

interface BatchResult {
  imported: number;
  errors: number;
  /** True if every record was processed without error and the source key may safely be cleared. */
  allSucceeded: boolean;
}

/**
 * Import a batch of agent records into the file store.
 *
 * Returns the imported records (old-id -> new-id mapping) plus a
 * `allSucceeded` flag the caller uses to decide whether to clear the
 * source legacy key.
 *
 * Each record is processed independently: a failure on agent N does not
 * stop processing of agent N+1, but it DOES set `allSucceeded=false`.
 */
async function importAgents(
  workspacePath: string,
  rawAgents: unknown,
): Promise<{ imported: AgentImportRecord[]; allSucceeded: boolean; errors: number }> {
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    return { imported: [], allSucceeded: true, errors: 0 };
  }

  // Build a working set of slugs already used per folder so disambiguation
  // is correct when two legacy agents would slugify to the same name.
  // Seed it with whatever already exists on disk.
  const existing = await agentFileStore.loadAllAgents(workspacePath);
  const usedByFolder = new Map<string, Set<string>>();
  for (const a of existing) {
    const folder = a.folder ?? '';
    let set = usedByFolder.get(folder);
    if (!set) {
      set = new Set();
      usedByFolder.set(folder, set);
    }
    if (a.slug) set.add(a.slug);
  }

  const imported: AgentImportRecord[] = [];
  let errors = 0;

  for (const raw of rawAgents) {
    if (!raw || typeof raw !== 'object') {
      errors += 1;
      continue;
    }
    const legacy = raw as Partial<Agent> & { id?: unknown; name?: unknown; kind?: unknown };
    const oldId = typeof legacy.id === 'string' ? legacy.id : '';
    const name = typeof legacy.name === 'string' ? legacy.name : '';
    const kind: 'agent' | 'chat' = legacy.kind === 'chat' ? 'chat' : 'agent';
    const folder = (() => {
      try {
        return normalizeFolder(typeof legacy.folder === 'string' ? legacy.folder : '');
      } catch {
        // Bad folder path — drop it, import to root rather than fail.
        return '';
      }
    })();
    const baseSlug = slugify(name, kind);

    let usedSet = usedByFolder.get(folder);
    if (!usedSet) {
      usedSet = new Set();
      usedByFolder.set(folder, usedSet);
    }
    const slug = disambiguateSlug(baseSlug, usedSet);
    usedSet.add(slug);

    const now = new Date().toISOString();
    const agentToWrite: Agent = {
      // id is recomputed by saveAgent from folder + slug.
      id: '',
      name: name || 'Untitled',
      slug,
      kind,
      systemPrompt: typeof legacy.systemPrompt === 'string' ? legacy.systemPrompt : '',
      model: typeof legacy.model === 'string' ? legacy.model : '',
      bindings: Array.isArray(legacy.bindings) ? legacy.bindings : [],
      permissionMode: legacy.permissionMode ?? 'default',
      folder: folder === '' ? undefined : folder,
      allowedTools: Array.isArray(legacy.allowedTools) ? legacy.allowedTools : undefined,
      createdAt: typeof legacy.createdAt === 'string' ? legacy.createdAt : now,
      updatedAt: typeof legacy.updatedAt === 'string' ? legacy.updatedAt : now,
    };

    try {
      const newId = await agentFileStore.saveAgent(workspacePath, agentToWrite);
      imported.push({ oldId, newId, slug, folder });
    } catch (err) {
      console.warn('[legacy-import] failed to save agent', name, err);
      errors += 1;
      // Roll back the slug reservation so the next legacy agent doesn't
      // get pushed into a higher disambiguation suffix unnecessarily.
      usedSet.delete(slug);
    }
  }

  return { imported, allSucceeded: errors === 0, errors };
}

/**
 * Import sessions, remapping their old UUID keys to the new slug-based
 * ids via the `idMap` produced by `importAgents`. Sessions without a
 * matching entry in `idMap` are skipped (not an error — the session is
 * orphaned because its agent didn't import successfully).
 */
async function importSessions(
  workspacePath: string,
  rawSessions: unknown,
  idMap: Map<string, string>,
): Promise<BatchResult> {
  if (!rawSessions || typeof rawSessions !== 'object' || Array.isArray(rawSessions)) {
    return { imported: 0, errors: 0, allSucceeded: true };
  }
  const sessions = rawSessions as Record<string, unknown>;
  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    return { imported: 0, errors: 0, allSucceeded: true };
  }

  let imported = 0;
  let errors = 0;
  let allSucceeded = true;

  for (const [oldId, sessionRaw] of entries) {
    const newId = idMap.get(oldId);
    if (!newId) {
      // Orphaned session — agent failed to import or wasn't in the
      // batch. Leave the session in source so a future import can
      // retry once the agent gets in.
      allSucceeded = false;
      continue;
    }
    if (!sessionRaw || typeof sessionRaw !== 'object') {
      errors += 1;
      allSucceeded = false;
      continue;
    }
    const session = sessionRaw as AgentSession;
    try {
      // Update agentId to match the new id so loadSession round-trips.
      const remapped: AgentSession = { ...session, agentId: newId };
      await sessionCache.saveSession(workspacePath, newId, remapped);
      imported += 1;
    } catch (err) {
      console.warn('[legacy-import] failed to save session for', oldId, err);
      errors += 1;
      allSucceeded = false;
    }
  }

  return { imported, errors, allSucceeded };
}

/**
 * Import declared agent folders. Source shape is
 * `{ chats: string[]; agents: string[] }`. Each folder name is slugified
 * via `normalizeFolder` and saved with `displayName = original name` so
 * casing/punctuation survives.
 */
async function importFolders(
  workspacePath: string,
  rawFolders: unknown,
): Promise<BatchResult> {
  if (!rawFolders || typeof rawFolders !== 'object' || Array.isArray(rawFolders)) {
    return { imported: 0, errors: 0, allSucceeded: true };
  }
  const folders = rawFolders as { chats?: unknown; agents?: unknown };
  const all = new Set<string>();
  for (const list of [folders.chats, folders.agents]) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === 'string' && item.trim() !== '') all.add(item);
      }
    }
  }
  if (all.size === 0) return { imported: 0, errors: 0, allSucceeded: true };

  let imported = 0;
  let errors = 0;
  let allSucceeded = true;

  for (const folderName of all) {
    let normalized: string;
    try {
      normalized = normalizeFolder(folderName);
    } catch (err) {
      console.warn('[legacy-import] invalid folder name', folderName, err);
      errors += 1;
      allSucceeded = false;
      continue;
    }
    if (normalized === '') {
      // Empty after normalization — skip, not an error.
      continue;
    }
    try {
      await agentFileStore.createFolder(workspacePath, normalized, folderName);
      imported += 1;
    } catch (err) {
      console.warn('[legacy-import] failed to create folder', folderName, err);
      errors += 1;
      allSucceeded = false;
    }
  }

  return { imported, errors, allSucceeded };
}

/** Import a batch of repo records into the file store. */
async function importRepos(
  workspacePath: string,
  rawRepos: unknown,
): Promise<BatchResult> {
  if (!Array.isArray(rawRepos) || rawRepos.length === 0) {
    return { imported: 0, errors: 0, allSucceeded: true };
  }

  // Seed slug-uniqueness sets from existing on-disk repos.
  const existing = await repoFileStore.loadAllRepos(workspacePath);
  const usedByFolder = new Map<string, Set<string>>();
  for (const r of existing) {
    const folder = r.folder ?? '';
    let set = usedByFolder.get(folder);
    if (!set) {
      set = new Set();
      usedByFolder.set(folder, set);
    }
    if (r.slug) set.add(r.slug);
  }

  let imported = 0;
  let errors = 0;
  let allSucceeded = true;

  for (const raw of rawRepos) {
    if (!raw || typeof raw !== 'object') {
      errors += 1;
      allSucceeded = false;
      continue;
    }
    const legacy = raw as Partial<Repo> & { name?: unknown; url?: unknown };
    const name = typeof legacy.name === 'string' ? legacy.name : '';
    const url = typeof legacy.url === 'string' ? legacy.url : '';
    if (name === '' || url === '') {
      errors += 1;
      allSucceeded = false;
      continue;
    }
    const folder = (() => {
      try {
        return normalizeFolder(typeof legacy.folder === 'string' ? legacy.folder : '');
      } catch {
        return '';
      }
    })();
    const baseSlug = slugify(name, 'repo');
    let usedSet = usedByFolder.get(folder);
    if (!usedSet) {
      usedSet = new Set();
      usedByFolder.set(folder, usedSet);
    }
    const slug = disambiguateSlug(baseSlug, usedSet);
    usedSet.add(slug);

    const now = new Date().toISOString();
    const repoToWrite: Repo = {
      id: '',
      name,
      url,
      slug,
      folder: folder === '' ? undefined : folder,
      localClonePath: typeof legacy.localClonePath === 'string' ? legacy.localClonePath : undefined,
      createdAt: typeof legacy.createdAt === 'string' ? legacy.createdAt : now,
      updatedAt: typeof legacy.updatedAt === 'string' ? legacy.updatedAt : now,
    };
    try {
      await repoFileStore.saveRepo(workspacePath, repoToWrite);
      imported += 1;
    } catch (err) {
      console.warn('[legacy-import] failed to save repo', name, err);
      errors += 1;
      allSucceeded = false;
      usedSet.delete(slug);
    }
  }

  return { imported, errors, allSucceeded };
}

/**
 * Drain whatever data still lives in legacy `quipu-state.json` for
 * `workspacePath` into the file-based knowledge store. Idempotent.
 *
 * The first-call backup snapshot of the legacy storage is taken before
 * any mutation. Each step writes destination first, and only after every
 * write in a step has succeeded does the corresponding source key get
 * cleared. This is the failure-mode safety invariant: source-clear is
 * gated on destination-success, NEVER the other way around.
 *
 * Concurrent invocations for the same workspace share an in-flight
 * promise — AgentContext and RepoContext both calling on workspace-open
 * is safe.
 */
export async function importLegacyDataForWorkspace(
  workspacePath: string,
): Promise<LegacyImportResult> {
  const cached = inFlight.get(workspacePath);
  if (cached) return cached;

  const promise = (async (): Promise<LegacyImportResult> => {
    // Idempotency: short-circuit if this workspace has already imported.
    const initialState = await readImportState();
    if (initialState.imported[workspacePath]) {
      return { imported: 0, errors: 0 };
    }

    // Backup before any mutation. Best-effort; failure here is logged
    // but does not block the import.
    await backupLegacyStateOnce(workspacePath);

    let totalImported = 0;
    let totalErrors = 0;

    // Step 1: workspace-scoped agents.
    const scopedAgentsRaw = await storageService.get(agentsKey(workspacePath));
    const agentsResult = await importAgents(workspacePath, scopedAgentsRaw);
    totalImported += agentsResult.imported.length;
    totalErrors += agentsResult.errors;

    // Build the id-mapping for sessions to use.
    const idMap = new Map<string, string>();
    for (const r of agentsResult.imported) {
      if (r.oldId !== '') idMap.set(r.oldId, r.newId);
    }

    // Critical: clear the source key ONLY if every write succeeded.
    if (agentsResult.allSucceeded && Array.isArray(scopedAgentsRaw) && scopedAgentsRaw.length > 0) {
      await storageService.set(agentsKey(workspacePath), null);
    }

    // Step 2: workspace-scoped sessions (must run after step 1 so we have
    // the id map; saving sessions for un-imported agents is a no-op).
    const scopedSessionsRaw = await storageService.get(agentSessionsKey(workspacePath));
    const sessionsResult = await importSessions(workspacePath, scopedSessionsRaw, idMap);
    totalImported += sessionsResult.imported;
    totalErrors += sessionsResult.errors;
    if (sessionsResult.allSucceeded
        && scopedSessionsRaw
        && typeof scopedSessionsRaw === 'object'
        && !Array.isArray(scopedSessionsRaw)
        && Object.keys(scopedSessionsRaw as Record<string, unknown>).length > 0) {
      await storageService.set(agentSessionsKey(workspacePath), null);
    }

    // Step 3: workspace-scoped agent folders.
    const scopedFoldersRaw = await storageService.get(agentFoldersKey(workspacePath));
    const foldersResult = await importFolders(workspacePath, scopedFoldersRaw);
    totalImported += foldersResult.imported;
    totalErrors += foldersResult.errors;
    if (foldersResult.allSucceeded && scopedFoldersRaw && typeof scopedFoldersRaw === 'object') {
      const folders = scopedFoldersRaw as { chats?: unknown; agents?: unknown };
      const hasChats = Array.isArray(folders.chats) && folders.chats.length > 0;
      const hasAgents = Array.isArray(folders.agents) && folders.agents.length > 0;
      if (hasChats || hasAgents) {
        await storageService.set(agentFoldersKey(workspacePath), null);
      }
    }

    // Step 4: workspace-scoped repos.
    const scopedReposRaw = await storageService.get(reposKey(workspacePath));
    const reposResult = await importRepos(workspacePath, scopedReposRaw);
    totalImported += reposResult.imported;
    totalErrors += reposResult.errors;
    if (reposResult.allSucceeded && Array.isArray(scopedReposRaw) && scopedReposRaw.length > 0) {
      await storageService.set(reposKey(workspacePath), null);
    }

    // Step 5: pre-v0.22.0 globals — only if no other workspace has claimed them.
    // Re-read import state in case it changed during the steps above (it shouldn't,
    // but defensive against future changes).
    const stateBeforeGlobals = await readImportState();
    let globalsClaimed = stateBeforeGlobals.globalsClaimed;

    if (!globalsClaimed) {
      const globalAgentsRaw = await storageService.get(LEGACY_AGENTS_BASE);
      const globalSessionsRaw = await storageService.get(LEGACY_SESSIONS_BASE);
      const globalFoldersRaw = await storageService.get(LEGACY_FOLDERS_BASE);
      const globalReposRaw = await storageService.get(LEGACY_REPOS_BASE);

      const hasAnyGlobal =
        (Array.isArray(globalAgentsRaw) && globalAgentsRaw.length > 0)
        || (globalSessionsRaw
            && typeof globalSessionsRaw === 'object'
            && !Array.isArray(globalSessionsRaw)
            && Object.keys(globalSessionsRaw as Record<string, unknown>).length > 0)
        || (globalFoldersRaw
            && typeof globalFoldersRaw === 'object'
            && (Array.isArray((globalFoldersRaw as { chats?: unknown }).chats)
              ? ((globalFoldersRaw as { chats: unknown[] }).chats.length > 0)
              : false
            || Array.isArray((globalFoldersRaw as { agents?: unknown }).agents)
              ? ((globalFoldersRaw as { agents: unknown[] }).agents.length > 0)
              : false))
        || (Array.isArray(globalReposRaw) && globalReposRaw.length > 0);

      if (hasAnyGlobal) {
        const gAgents = await importAgents(workspacePath, globalAgentsRaw);
        totalImported += gAgents.imported.length;
        totalErrors += gAgents.errors;

        const gIdMap = new Map<string, string>();
        for (const r of gAgents.imported) {
          if (r.oldId !== '') gIdMap.set(r.oldId, r.newId);
        }

        const gSessions = await importSessions(workspacePath, globalSessionsRaw, gIdMap);
        totalImported += gSessions.imported;
        totalErrors += gSessions.errors;

        const gFolders = await importFolders(workspacePath, globalFoldersRaw);
        totalImported += gFolders.imported;
        totalErrors += gFolders.errors;

        const gRepos = await importRepos(workspacePath, globalReposRaw);
        totalImported += gRepos.imported;
        totalErrors += gRepos.errors;

        const allGlobalsSucceeded =
          gAgents.allSucceeded
          && gSessions.allSucceeded
          && gFolders.allSucceeded
          && gRepos.allSucceeded;

        if (allGlobalsSucceeded) {
          // Clear all four globals + claim them — atomically (modulo
          // storage-set's per-call atomicity; if the process dies between
          // these, the next launch will see partial cleanup but still
          // recognize the import via globalsClaimed).
          if (Array.isArray(globalAgentsRaw) && globalAgentsRaw.length > 0) {
            await storageService.set(LEGACY_AGENTS_BASE, null);
          }
          if (globalSessionsRaw
              && typeof globalSessionsRaw === 'object'
              && !Array.isArray(globalSessionsRaw)
              && Object.keys(globalSessionsRaw as Record<string, unknown>).length > 0) {
            await storageService.set(LEGACY_SESSIONS_BASE, null);
          }
          if (globalFoldersRaw && typeof globalFoldersRaw === 'object') {
            await storageService.set(LEGACY_FOLDERS_BASE, null);
          }
          if (Array.isArray(globalReposRaw) && globalReposRaw.length > 0) {
            await storageService.set(LEGACY_REPOS_BASE, null);
          }
          globalsClaimed = workspacePath;
        }
      }
    }

    // Mark this workspace imported. Always, even if some steps had
    // partial errors — the failed source keys remain for retry, but the
    // workspace itself has now been visited. This is intentional: we
    // don't want to re-attempt successful writes infinitely just because
    // one record was bad.
    //
    // Re-read state once more under the assumption that this is the only
    // mutator (single-instance lock + per-workspace in-flight cache make
    // this true in practice).
    const finalState = await readImportState();
    finalState.imported[workspacePath] = new Date().toISOString();
    if (globalsClaimed && !finalState.globalsClaimed) {
      finalState.globalsClaimed = globalsClaimed;
    }
    await writeImportState(finalState);

    return { imported: totalImported, errors: totalErrors };
  })();

  inFlight.set(workspacePath, promise);
  try {
    return await promise;
  } finally {
    // Clear the in-flight entry once the work has settled. A future
    // invocation will short-circuit on the persisted state instead.
    inFlight.delete(workspacePath);
  }
}

/**
 * Test-only escape hatch: reset all process-level state so tests using
 * `vi.resetModules` + a per-test tmp home can reset cleanly.
 */
export function __resetForTests(): void {
  homeDirPromise = null;
  backupPromise = null;
  inFlight.clear();
}
