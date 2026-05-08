import { describe, it, expect } from 'vitest';
import { applyDefaultExtension } from '@/extensions/database-viewer/components/cells/LinkCell';

describe('applyDefaultExtension (Unit 7)', () => {
  it('appends the default extension when missing', () => {
    expect(applyDefaultExtension('spec', '.md')).toBe('spec.md');
  });

  it('leaves the name alone when it already has the extension', () => {
    expect(applyDefaultExtension('spec.md', '.md')).toBe('spec.md');
  });

  it('matches case-insensitively', () => {
    expect(applyDefaultExtension('SPEC.MD', '.md')).toBe('SPEC.MD');
  });

  it('normalises a dotless extension', () => {
    expect(applyDefaultExtension('spec', 'md')).toBe('spec.md');
  });

  it('treats empty extension as "no extension"', () => {
    expect(applyDefaultExtension('spec', '')).toBe('spec');
  });

  it('falls back to .md when extension is undefined', () => {
    expect(applyDefaultExtension('spec', undefined)).toBe('spec.md');
  });

  it('preserves an empty input', () => {
    expect(applyDefaultExtension('', '.md')).toBe('');
  });

  it('trims whitespace around the input', () => {
    expect(applyDefaultExtension('  spec  ', '.md')).toBe('spec.md');
  });
});
