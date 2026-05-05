import { describe, it, expect } from 'vitest';
import {
  slugify,
  normalizeFolder,
  disambiguateSlug,
  joinId,
  splitId,
} from '../services/slug';

describe('slugify', () => {
  it('lowercases and dash-joins multi-word names', () => {
    expect(slugify('FRAME Responder')).toBe('frame-responder');
  });

  it('handles a simple two-word name', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('ASCII-folds diacritics and strips apostrophes', () => {
    expect(slugify("Iagó D'Souza-García")).toBe('iago-d-souza-garcia');
  });

  it('trims outer whitespace', () => {
    expect(slugify('  trim me  ')).toBe('trim-me');
  });

  it('collapses runs of internal whitespace into a single dash', () => {
    expect(slugify('multiple    spaces')).toBe('multiple-spaces');
  });

  it('falls back to the default "item" when name is all punctuation', () => {
    expect(slugify('!!!')).toBe('item');
  });

  it('uses the provided fallback when name is empty', () => {
    expect(slugify('', 'chat')).toBe('chat');
  });

  it('uses the provided fallback when name is whitespace-only', () => {
    expect(slugify('   ', 'agent')).toBe('agent');
  });

  it('caps slugs at 64 chars for an unbroken letter run', () => {
    const result = slugify('a'.repeat(100));
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toBe('a'.repeat(64));
  });

  it('cuts at a dash boundary when truncating a long dashed name', () => {
    const result = slugify(
      'this-is-a-fairly-long-name-that-might-exceed-the-cap-eventually-yes-it-does',
    );
    expect(result.length).toBeLessThanOrEqual(64);
    // Should not end with a dash and should not end mid-word with the
    // original tail "does" present (it should have been cut off at a
    // dash boundary before the cap).
    expect(result.endsWith('-')).toBe(false);
    expect(result.endsWith('does')).toBe(false);
    // Sanity: still a valid kebab slug.
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(result)).toBe(true);
  });

  it('keeps numbers in the slug', () => {
    expect(slugify('123 numbers ok')).toBe('123-numbers-ok');
  });

  it('treats underscores as non-alnum and replaces with dash', () => {
    expect(slugify('Iago_Underscores!')).toBe('iago-underscores');
  });
});

describe('normalizeFolder', () => {
  it('returns "" for the empty string (root)', () => {
    expect(normalizeFolder('')).toBe('');
  });

  it('returns "" for a whitespace-only input', () => {
    expect(normalizeFolder('   ')).toBe('');
  });

  it('returns "" for null', () => {
    expect(normalizeFolder(null)).toBe('');
  });

  it('returns "" for undefined', () => {
    expect(normalizeFolder(undefined)).toBe('');
  });

  it('passes a single segment through', () => {
    expect(normalizeFolder('research')).toBe('research');
  });

  it('passes a two-segment slugged path through', () => {
    expect(normalizeFolder('research/web-scraping')).toBe('research/web-scraping');
  });

  it('slugifies each segment of a path with display-name segments', () => {
    expect(normalizeFolder('Research / Web Scraping')).toBe('research/web-scraping');
  });

  it('strips a leading slash', () => {
    expect(normalizeFolder('/leading/slash')).toBe('leading/slash');
  });

  it('strips a trailing slash', () => {
    expect(normalizeFolder('trailing/')).toBe('trailing');
  });

  it('collapses double slashes', () => {
    expect(normalizeFolder('foo//bar')).toBe('foo/bar');
  });

  it('throws on a parent-escape (..) segment', () => {
    expect(() => normalizeFolder('foo/../bar')).toThrow();
  });

  it('throws on a current-dir (.) segment', () => {
    expect(() => normalizeFolder('foo/./bar')).toThrow();
  });

  it('trims whitespace within each segment via slugify', () => {
    expect(normalizeFolder('  foo  /  bar  ')).toBe('foo/bar');
  });

  it('throws when a segment becomes empty after slugify', () => {
    expect(() => normalizeFolder('!!!/bar')).toThrow();
  });
});

describe('disambiguateSlug', () => {
  it('returns the base when existing is empty', () => {
    expect(disambiguateSlug('foo', [])).toBe('foo');
  });

  it('returns the base when existing has only unrelated names', () => {
    expect(disambiguateSlug('foo', ['bar'])).toBe('foo');
  });

  it('returns base-2 when only base is taken', () => {
    expect(disambiguateSlug('foo', ['foo'])).toBe('foo-2');
  });

  it('returns base-3 when base and base-2 are taken', () => {
    expect(disambiguateSlug('foo', ['foo', 'foo-2'])).toBe('foo-3');
  });

  it('returns base-4 when base, base-2, base-3 are taken', () => {
    expect(disambiguateSlug('foo', ['foo', 'foo-2', 'foo-3'])).toBe('foo-4');
  });

  it('accepts a Set as the existing collection', () => {
    expect(disambiguateSlug('foo', new Set(['foo']))).toBe('foo-2');
  });

  it('returns the base when only the disambiguated form is in existing', () => {
    expect(disambiguateSlug('foo', ['foo-2'])).toBe('foo');
  });
});

describe('joinId', () => {
  it('returns just the slug when folder is empty', () => {
    expect(joinId('', 'foo')).toBe('foo');
  });

  it('joins single-segment folder + slug', () => {
    expect(joinId('research', 'foo')).toBe('research/foo');
  });

  it('joins multi-segment folder + slug', () => {
    expect(joinId('a/b/c', 'foo')).toBe('a/b/c/foo');
  });
});

describe('splitId', () => {
  it('splits a root-level id', () => {
    expect(splitId('foo')).toEqual({ folder: '', slug: 'foo' });
  });

  it('splits a single-folder id', () => {
    expect(splitId('research/foo')).toEqual({ folder: 'research', slug: 'foo' });
  });

  it('splits a multi-folder id', () => {
    expect(splitId('a/b/c/foo')).toEqual({ folder: 'a/b/c', slug: 'foo' });
  });
});

describe('joinId / splitId round-trip', () => {
  const ids = ['foo', 'research/foo', 'research/web-scraping/foo', 'a/b/c/d/leaf'];

  for (const id of ids) {
    it(`round-trips id="${id}"`, () => {
      const { folder, slug } = splitId(id);
      expect(joinId(folder, slug)).toBe(id);
    });
  }
});
