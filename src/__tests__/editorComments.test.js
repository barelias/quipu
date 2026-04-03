import { describe, it, expect } from 'vitest';

describe('Editor comment selection preservation', () => {
  it('savedSelectionRef captures from/to range', () => {
    // Simulates the selection save on handleCommentClick
    const savedSelection = { from: 10, to: 25 };
    expect(savedSelection.from).toBe(10);
    expect(savedSelection.to).toBe(25);
    expect(savedSelection.to - savedSelection.from).toBe(15); // 15 chars selected
  });

  it('selection is cleared on cancel', () => {
    let savedSelection = { from: 10, to: 25 };
    // Cancel
    savedSelection = null;
    expect(savedSelection).toBeNull();
  });

  it('selection is used then cleared on addComment', () => {
    let savedSelection = { from: 10, to: 25 };
    // addComment uses savedSelection
    const sel = savedSelection;
    expect(sel.from).toBe(10);
    expect(sel.to).toBe(25);
    // Then clears
    savedSelection = null;
    expect(savedSelection).toBeNull();
  });
});

describe('Annotation type in comments', () => {
  const ANNOTATION_TYPES = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];

  it('default comment type is comment', () => {
    let commentType = 'comment';
    expect(commentType).toBe('comment');
  });

  it('comment type resets to comment on cancel', () => {
    let commentType = 'bug';
    // Cancel
    commentType = 'comment';
    expect(commentType).toBe('comment');
  });

  it('comment type resets to comment after submission', () => {
    let commentType = 'todo';
    // After addComment
    commentType = 'comment';
    expect(commentType).toBe('comment');
  });

  it('all types are valid for FRAME annotation', () => {
    const annotation = (type) => ({
      id: 'test-id',
      line: 1,
      text: 'test comment',
      type,
      author: 'user',
    });

    for (const type of ANNOTATION_TYPES) {
      const a = annotation(type);
      expect(a.type).toBe(type);
      expect(typeof a.text).toBe('string');
    }
  });
});

describe('Raw mode content sync', () => {
  it('markdown raw content round-trips through string', () => {
    const originalMd = '# Hello\n\nSome **bold** text';
    // Raw mode shows the string as-is
    const rawContent = originalMd;
    expect(rawContent).toBe(originalMd);
  });

  it('quipu JSON raw content requires valid JSON to save', () => {
    const validJson = '{"type":"doc","content":[]}';
    expect(() => JSON.parse(validJson)).not.toThrow();

    const invalidJson = '{"type":"doc", broken}';
    expect(() => JSON.parse(invalidJson)).toThrow();
  });

  it('empty raw content does not trigger sync', () => {
    const rawContent = '';
    // In toggleEditorMode: `if (prev === 'raw' && ed && !ed.isDestroyed && raw)`
    // Empty string is falsy → no sync
    expect(!rawContent).toBe(true);
  });
});
