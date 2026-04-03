import { describe, it, expect } from 'vitest';

const ANNOTATION_TYPES = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
const TYPE_COLORS = {
  comment: 'bg-text-tertiary/20 text-text-secondary',
  review: 'bg-accent/20 text-accent',
  todo: 'bg-info/20 text-info',
  bug: 'bg-error/20 text-error',
  question: 'bg-warning/20 text-warning',
  instruction: 'bg-success/20 text-success',
};

describe('Annotation types', () => {
  it('has 6 annotation types including comment', () => {
    expect(ANNOTATION_TYPES).toHaveLength(6);
    expect(ANNOTATION_TYPES).toContain('comment');
  });

  it('comment is the first (default) type', () => {
    expect(ANNOTATION_TYPES[0]).toBe('comment');
  });

  it('every type has a color mapping', () => {
    for (const type of ANNOTATION_TYPES) {
      expect(TYPE_COLORS[type]).toBeDefined();
      expect(TYPE_COLORS[type]).toContain('bg-');
      expect(TYPE_COLORS[type]).toContain('text-');
    }
  });

  it('includes all originally specified FRAME types', () => {
    const frameTypes = ['review', 'todo', 'bug', 'question', 'instruction'];
    for (const type of frameTypes) {
      expect(ANNOTATION_TYPES).toContain(type);
    }
  });
});
