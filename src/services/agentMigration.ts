/**
 * One-time migration from path-derived agent ids to stable UUIDs.
 *
 * Pre-migration, an agent's identity was `joinId(folder, slug)` — derived
 * from its on-disk path. Renaming a folder changed the id, which orphaned
 * the bound repo clone (`tmp/<id>/repos/...`) and the session cache file
 * (`sessions-cache/<hash>/<id>.json`). Post-migration, every agent has a
 * stable UUID persisted inside its JSON record; folder/slug renames are
 * pure metadata.
 *
 * The migration runs at workspace boot, BEFORE agents are loaded into
 * React state. It rewrites legacy agent files in place and moves their
 * dependent on-disk data to the new UUID-keyed paths.
 *
 * **Crash recovery via per-agent manifests.** Before any moves, the
 * migration writes `.quipu/migrations/<legacyId>.json` containing the
 * UUID it intends to use. If the boot crashes mid-migration, the next
 * boot reads the manifest and recovers the same UUID — preventing a
 * second attempt from generating a fresh UUID and orphaning the data
 * already moved. The manifest is deleted only after the agent JSON has
 * been rewritten with the new id.
 */

import fs from './fileSystem';
import {
  readJsonFile,
  writeJsonFile,
  deleteFile,
  listJsonFilesRecursive,
} from './quipuFileStore';
import { renameSession } from './sessionCache';
import { splitId } from './slug';

function trimTrailing(path: string): string {
  return path.replace(/\/+$/, '');
}

/** Strip the trailing `.json` from a relative path. */
function relPathToId(relativePath: string): string {
  if (relativePath.endsWith('.json')) {
    return relativePath.slice(0, -'.json'.length);
  }
  return relativePath;
}

interface ManifestRecord {
  uuid: string;
  legacyId: string;
}

/**
 * Migrate every legacy (path-derived id) agent under `workspacePath` to
 * a stable UUID.
 *
 * Returns a `legacyId -> uuid` map of agents that were migrated this
 * pass — the caller uses it to repath any open `agent://<legacyId>` tabs.
 *
 * Idempotent: agents that already have an `id` field in their JSON are
 * skipped, and crashes mid-migration are recovered via the manifest.
 */
export async function migrateLegacyAgentIds(
  workspacePath: string,
): Promise<Map<string, string>> {
  const base = trimTrailing(workspacePath);
  const agentsRoot = `${base}/.quipu/agents`;
  const migrationsRoot = `${base}/.quipu/migrations`;
  const result = new Map<string, string>();

  let entries: Array<{ absolutePath: string; relativePath: string }>;
  try {
    entries = await listJsonFilesRecursive(agentsRoot);
  } catch {
    // No agents directory yet — nothing to migrate.
    return result;
  }

  for (const entry of entries) {
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(entry.absolutePath);
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;

    // Already has a stable id — nothing to do.
    if (typeof record.id === 'string' && record.id.length > 0) continue;

    const legacyId = relPathToId(entry.relativePath);
    if (legacyId === '') continue;
    const { folder, slug } = splitId(legacyId);
    if (slug === '') continue;

    // Reserve (or recover) a UUID via the per-agent manifest.
    const manifestPath = `${migrationsRoot}/${legacyId}.json`;
    let uuid: string;
    try {
      const existing = await readJsonFile<ManifestRecord>(manifestPath);
      if (existing && typeof existing.uuid === 'string' && existing.uuid.length > 0) {
        uuid = existing.uuid;
      } else {
        uuid = crypto.randomUUID();
        await writeJsonFile(manifestPath, { uuid, legacyId });
      }
    } catch {
      // Manifest doesn't exist or is unreadable — write a fresh one.
      uuid = crypto.randomUUID();
      try {
        await writeJsonFile(manifestPath, { uuid, legacyId });
      } catch (err) {
        console.warn('[agent-migration] failed to write manifest, skipping', legacyId, err);
        continue;
      }
    }

    // Move the agent's bound scratch dir, if it exists. ENOENT is the
    // expected case for an agent that never bound a repo. Anything else
    // is logged but doesn't block the migration — having no scratch dir
    // is a valid post-state, the next clone will materialize one at the
    // new UUID path.
    const oldScratch = `${base}/tmp/${legacyId}`;
    const newScratch = `${base}/tmp/${uuid}`;
    try {
      await fs.renamePath(oldScratch, newScratch);
    } catch (err) {
      // Best-effort — common case is "no such directory".
      console.debug('[agent-migration] scratch rename skipped', legacyId, err);
    }

    // Move the session cache file. Internally this is load + save +
    // delete, so a partial failure leaves both files (the next boot
    // recovers via the manifest).
    try {
      await renameSession(workspacePath, legacyId, uuid);
    } catch (err) {
      console.warn('[agent-migration] session rename failed', legacyId, '->', uuid, err);
    }

    // Commit point: rewrite the agent JSON with the stable id. After
    // this succeeds, normalizeLoaded reads `record.id` and skips
    // migration on subsequent boots.
    record.id = uuid;
    record.slug = slug;
    record.folder = folder;
    try {
      await writeJsonFile(entry.absolutePath, record);
    } catch (err) {
      console.warn('[agent-migration] failed to rewrite JSON', legacyId, err);
      // Manifest preserved — next boot recovers the same UUID and retries.
      continue;
    }

    // Cleanup: drop the manifest. Failure here is harmless — an orphan
    // manifest is just dead weight; the agent's JSON now has an id and
    // future boots skip migration entirely.
    try {
      await deleteFile(manifestPath);
    } catch {
      /* ignore */
    }

    result.set(legacyId, uuid);
  }

  return result;
}
