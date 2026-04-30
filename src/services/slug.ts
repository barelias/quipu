/**
 * Slug + folder-path utilities for the file-based knowledge store.
 *
 * Pure, side-effect-free helpers used to map user-facing entity names
 * to filesystem-safe slugs, validate and canonicalize folder paths,
 * and disambiguate collisions when two entities in the same folder
 * would otherwise produce the same slug.
 */

const MAX_SLUG_LENGTH = 64;
const DEFAULT_FALLBACK = 'item';
const MAX_NUMERIC_DISAMBIG_ATTEMPTS = 1000;
const MAX_RANDOM_DISAMBIG_RETRIES = 5;

/**
 * Convert an arbitrary user-facing name into a filesystem-safe slug.
 *
 * - Trims outer whitespace.
 * - Lowercased.
 * - ASCII-folded via NFKD + combining-mark stripping (e.g. "Iagó" -> "iago").
 * - Runs of non-`[a-z0-9]` characters collapse to a single `-`.
 * - Leading/trailing `-` are trimmed.
 * - Capped at 64 chars; when truncation occurs we cut at the last `-`
 *   boundary if one exists in the trailing portion to avoid leaving
 *   half-words at the end. Otherwise hard-cut.
 * - When the result is empty, returns `fallback`.
 */
export function slugify(name: string, fallback: string = DEFAULT_FALLBACK): string {
  const slug = baseSlug(name);
  if (slug) return slug;
  return fallback;
}

/**
 * Core slugify pipeline.
 * Returns the empty string when nothing slug-worthy survives.
 */
function baseSlug(input: string): string {
  if (!input) return '';

  // Trim outer whitespace, NFKD normalize, strip combining diacritical
  // marks, then lowercase. This turns "Iagó" into "iago".
  const folded = input
    .trim()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  // Replace any run of non-[a-z0-9] with a single dash.
  let slug = folded.replace(/[^a-z0-9]+/g, '-');

  // Trim leading/trailing dashes.
  slug = slug.replace(/^-+/, '').replace(/-+$/, '');

  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }

  // Truncate to MAX_SLUG_LENGTH; if there is a dash in the trailing
  // portion, cut at it to avoid trailing fragments.
  const truncated = slug.slice(0, MAX_SLUG_LENGTH);
  const lastDash = truncated.lastIndexOf('-');
  if (lastDash > 0) {
    return truncated.slice(0, lastDash);
  }
  return truncated;
}

/**
 * Validate and canonicalize a folder path.
 *
 * - Empty / whitespace-only input -> `''` (root).
 * - Strips leading and trailing slashes.
 * - Collapses internal `/+` runs to a single `/`.
 * - Splits on `/`, slugifies each segment (with fallback `'folder'`),
 *   and rejoins with `/`.
 * - Rejects any segment equal to `..` or `.`.
 * - Rejects any segment that is empty after slugification.
 */
export function normalizeFolder(folder: string | null | undefined): string {
  if (folder === null || folder === undefined) return '';
  if (typeof folder !== 'string') {
    throw new Error('Invalid folder path: ' + String(folder));
  }

  const trimmed = folder.trim();
  if (trimmed === '') return '';

  // Strip leading and trailing slashes, then collapse interior `/+` runs.
  const stripped = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
  if (stripped === '') return '';
  const collapsed = stripped.replace(/\/+/g, '/');

  const rawSegments = collapsed.split('/');
  const slugSegments: string[] = [];
  for (const raw of rawSegments) {
    const seg = raw.trim();
    if (seg === '..' || seg === '.') {
      throw new Error('Invalid folder path: ' + folder);
    }
    const slug = slugify(seg, '');
    if (slug === '') {
      throw new Error('Invalid folder path: ' + folder);
    }
    // Re-check post-slug for `.` / `..` (defense in depth — slugify
    // can't actually produce these but be explicit).
    if (slug === '.' || slug === '..') {
      throw new Error('Invalid folder path: ' + folder);
    }
    slugSegments.push(slug);
  }

  return slugSegments.join('/');
}

/**
 * Pick the next free slug given a desired base and a set of already-used slugs.
 *
 * Returns `base` when it is not in `existing`. Otherwise tries `base-2`,
 * `base-3`, ... up to a sane limit; if that limit is exceeded, falls back
 * to a short random suffix. Comparison is case-sensitive.
 */
export function disambiguateSlug(base: string, existing: Set<string> | string[]): string {
  const set = existing instanceof Set ? existing : new Set(existing);
  if (!set.has(base)) return base;

  for (let n = 2; n <= MAX_NUMERIC_DISAMBIG_ATTEMPTS; n += 1) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }

  // Fall back to a short random suffix. Vanishingly unlikely to collide.
  for (let i = 0; i < MAX_RANDOM_DISAMBIG_RETRIES; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!set.has(candidate)) return candidate;
  }
  throw new Error(`disambiguateSlug: exhausted attempts for base "${base}"`);
}

/**
 * Build a folder-relative entity id from folder + slug.
 *
 * Caller is responsible for passing an already-normalized folder and
 * an already-slugified slug; this is a pure string concat.
 *
 * `joinId('', 'foo')` -> `'foo'`
 * `joinId('research', 'foo')` -> `'research/foo'`
 */
export function joinId(folder: string, slug: string): string {
  if (folder === '') return slug;
  return `${folder}/${slug}`;
}

/**
 * Inverse of joinId. Splits an entity id into folder + slug at the last `/`.
 *
 * `splitId('foo')` -> `{ folder: '', slug: 'foo' }`
 * `splitId('research/foo')` -> `{ folder: 'research', slug: 'foo' }`
 * `splitId('research/web-scraping/foo')` -> `{ folder: 'research/web-scraping', slug: 'foo' }`
 */
export function splitId(id: string): { folder: string; slug: string } {
  const idx = id.lastIndexOf('/');
  if (idx === -1) {
    return { folder: '', slug: id };
  }
  return { folder: id.slice(0, idx), slug: id.slice(idx + 1) };
}
