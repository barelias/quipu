import { describe, it, expect } from 'vitest';
import { wikiLinksToHTML } from '../extensions/WikiLink';

describe('wikiLinksToHTML', () => {
  it('converts simple [[path]] to HTML span', () => {
    const result = wikiLinksToHTML('See [[my-note]]');
    expect(result).toContain('data-wiki-link="my-note"');
    expect(result).toContain('class="wiki-link"');
    expect(result).toContain('>my-note<');
  });

  it('converts [[path|label]] with pipe to HTML span with label', () => {
    const result = wikiLinksToHTML('See [[docs/readme|Read Me]]');
    expect(result).toContain('data-wiki-link="docs/readme"');
    expect(result).toContain('>Read Me<');
  });

  it('converts multiple wiki links in one string', () => {
    const result = wikiLinksToHTML('Link [[a]] and [[b]]');
    expect(result).toContain('data-wiki-link="a"');
    expect(result).toContain('data-wiki-link="b"');
  });

  it('leaves text without wiki links unchanged', () => {
    const text = 'No links here, just [brackets]';
    expect(wikiLinksToHTML(text)).toBe(text);
  });

  it('escapes double quotes in path', () => {
    const result = wikiLinksToHTML('[[path"with"quotes]]');
    expect(result).toContain('&quot;');
  });

  it('handles empty path gracefully', () => {
    const result = wikiLinksToHTML('[[]]');
    // Empty inner means regex doesn't match (requires [^\]]+)
    expect(result).toBe('[[]]');
  });
});
