import fs from './fileSystem';

/**
 * Sibling-folder lifecycle for `.quipudb.jsonl` files.
 *
 * Each database file may have an adjacent folder named after its basename
 * (without the `.quipudb.jsonl` suffix) that holds files referenced by
 * relative-mode link columns. The folder is created lazily on first use,
 * renamed/moved with the database, and deleted alongside it.
 *
 * Operations are best-effort: if a sibling folder rename collides with an
 * existing entry, we abort that side and surface the failure via a result
 * object rather than rolling back the database file's own rename. The
 * caller toasts a warning so the user can fix manually.
 */

const DB_SUFFIX = '.quipudb.jsonl';

export function isDatabaseFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(DB_SUFFIX);
}

/**
 * Compute the sibling folder path for a database file. The folder lives
 * next to the database and shares its basename without the extension —
 * `/ws/tasks.quipudb.jsonl` → `/ws/tasks`.
 */
export function siblingFolderPath(databasePath: string): string {
  const slash = databasePath.lastIndexOf('/');
  const dir = slash >= 0 ? databasePath.slice(0, slash) : '';
  const base = slash >= 0 ? databasePath.slice(slash + 1) : databasePath;
  const stem = base.replace(/\.quipudb\.jsonl$/i, '');
  return dir ? `${dir}/${stem}` : stem;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.readDirectory(path);
    return true;
  } catch {
    // Could be a missing folder OR a regular file. Probe via readFile to
    // distinguish: a successful readFile = file (collision); a failure =
    // truly missing.
    try {
      await fs.readFile(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function entryExists(path: string): Promise<{ exists: boolean; isDirectory: boolean | null }> {
  // readDirectory throws on files; readFile throws on directories. Combine
  // both probes to learn what (if anything) lives at `path`.
  try {
    await fs.readDirectory(path);
    return { exists: true, isDirectory: true };
  } catch {
    try {
      await fs.readFile(path);
      return { exists: true, isDirectory: false };
    } catch {
      return { exists: false, isDirectory: null };
    }
  }
}

export interface FolderOpResult {
  ok: boolean;
  /** Reason for failure or skip; absent when ok=true. */
  error?: string;
}

/** Create the sibling folder if it does not exist. Idempotent. */
export async function ensureSiblingFolder(databasePath: string): Promise<FolderOpResult> {
  if (!isDatabaseFile(databasePath)) return { ok: false, error: 'not a database file' };
  const folder = siblingFolderPath(databasePath);
  const probe = await entryExists(folder);
  if (probe.exists) {
    if (probe.isDirectory) return { ok: true };
    return { ok: false, error: 'a file already exists at the sibling folder path' };
  }
  try {
    await fs.createFolder(folder);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Rename/move the sibling folder when its database file is renamed or
 * moved. Skips silently when the source folder doesn't exist (no relative
 * links yet) and aborts when the destination already exists.
 */
export async function renameSiblingFolder(oldDbPath: string, newDbPath: string): Promise<FolderOpResult> {
  if (!isDatabaseFile(oldDbPath) || !isDatabaseFile(newDbPath)) {
    return { ok: false, error: 'not a database file' };
  }
  const oldFolder = siblingFolderPath(oldDbPath);
  const newFolder = siblingFolderPath(newDbPath);
  if (oldFolder === newFolder) return { ok: true };

  const oldProbe = await entryExists(oldFolder);
  if (!oldProbe.exists) {
    // Nothing to move — no relative links were ever written.
    return { ok: true };
  }
  if (!oldProbe.isDirectory) {
    return { ok: false, error: `${oldFolder} is not a directory` };
  }

  const newProbe = await entryExists(newFolder);
  if (newProbe.exists) {
    return { ok: false, error: `${newFolder} already exists; sibling folder not moved` };
  }

  try {
    await fs.renamePath(oldFolder, newFolder);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Probe whether the sibling folder has any non-empty content. Used by
 * deleteEntry to decide whether to prompt the user before cascading.
 */
export async function siblingFolderEntries(databasePath: string): Promise<{ exists: boolean; count: number }> {
  if (!isDatabaseFile(databasePath)) return { exists: false, count: 0 };
  const folder = siblingFolderPath(databasePath);
  try {
    const entries = await fs.readDirectory(folder);
    return { exists: true, count: entries.length };
  } catch {
    return { exists: false, count: 0 };
  }
}

/** Best-effort delete. Skips if folder is missing. */
export async function deleteSiblingFolder(databasePath: string): Promise<FolderOpResult> {
  if (!isDatabaseFile(databasePath)) return { ok: false, error: 'not a database file' };
  const folder = siblingFolderPath(databasePath);
  const probe = await entryExists(folder);
  if (!probe.exists) return { ok: true };
  if (!probe.isDirectory) return { ok: false, error: `${folder} is not a directory` };
  try {
    await fs.deletePath(folder);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Re-export for back-compat with LinkCell which imported from there.
export { pathExists };
