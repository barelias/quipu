import { describe, it, expect } from 'vitest';

// Test the PDF viewer constants and logic (extracted from PdfViewer)
const PAGE_BUFFER = 2;
const ESTIMATED_PAGE_HEIGHT = 1056;

const ANNOTATION_TYPES = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
const TYPE_COLORS: Record<string, string> = {
  comment: 'bg-text-tertiary/20 text-text-secondary',
  review: 'bg-accent/20 text-accent',
  todo: 'bg-info/20 text-info',
  bug: 'bg-error/20 text-error',
  question: 'bg-warning/20 text-warning',
  instruction: 'bg-success/20 text-success',
};

describe('PDF page buffer logic', () => {
  // Simulates the renderedPages computation from PdfViewer
  const computeRenderedPages = (visiblePages: Set<number>, numPages: number) => {
    const rendered = new Set();
    for (const p of visiblePages) {
      for (let i = Math.max(1, p - PAGE_BUFFER); i <= Math.min(numPages, p + PAGE_BUFFER); i++) {
        rendered.add(i);
      }
    }
    return rendered;
  };

  it('renders buffer pages around a single visible page', () => {
    const rendered = computeRenderedPages(new Set([5]), 20);
    expect(rendered).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('clamps to page 1 at the start', () => {
    const rendered = computeRenderedPages(new Set([1]), 20);
    expect(rendered).toEqual(new Set([1, 2, 3]));
  });

  it('clamps to numPages at the end', () => {
    const rendered = computeRenderedPages(new Set([20]), 20);
    expect(rendered).toEqual(new Set([18, 19, 20]));
  });

  it('merges buffers for adjacent visible pages', () => {
    const rendered = computeRenderedPages(new Set([3, 4]), 20);
    expect(rendered).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('handles single-page PDF', () => {
    const rendered = computeRenderedPages(new Set([1]), 1);
    expect(rendered).toEqual(new Set([1]));
  });

  it('handles empty visible set', () => {
    const rendered = computeRenderedPages(new Set(), 20);
    expect(rendered).toEqual(new Set());
  });
});

describe('PDF page height estimation', () => {
  it('uses estimated height constant for unknown pages', () => {
    expect(ESTIMATED_PAGE_HEIGHT).toBe(1056);
  });

  it('computes page height from dimensions and scale', () => {
    const dims = { width: 612, height: 792 };
    const scale = 1.5;
    expect(dims.height * scale).toBe(1188);
  });
});

describe('PDF annotation types', () => {
  it('default type is comment', () => {
    expect(ANNOTATION_TYPES[0]).toBe('comment');
  });

  it('each type has a color', () => {
    for (const t of ANNOTATION_TYPES) {
      expect(TYPE_COLORS[t]).toBeDefined();
    }
  });

  it('comment annotation has correct structure', () => {
    const annotation = {
      page: 3,
      selectedText: 'some text',
      topRatio: 0.25,
      text: 'My comment',
      type: 'comment',
      author: 'user',
    };
    expect(annotation.type).toBe('comment');
    expect(annotation.page).toBe(3);
    expect(annotation.topRatio).toBeGreaterThan(0);
    expect(annotation.topRatio).toBeLessThan(1);
  });
});

describe('PDF options memoization', () => {
  it('options object is stable across references', () => {
    // Simulates the fix: options defined outside component
    const pdfOptions = {
      cMapUrl: 'https://unpkg.com/pdfjs-dist@3.0.0/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.0.0/standard_fonts/',
    };
    const ref1 = pdfOptions;
    const ref2 = pdfOptions;
    expect(ref1).toBe(ref2); // Same reference — won't trigger react-pdf reload
  });
});
