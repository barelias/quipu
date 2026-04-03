import { describe, it, expect } from 'vitest';
import { getLanguage, isCodeFile, isMediaFile, isExcalidrawFile, isMermaidFile, isPdfFile, getViewerType } from '../utils/fileTypes';

describe('getLanguage', () => {
  it('returns javascript for .js files', () => {
    expect(getLanguage('app.js')).toBe('javascript');
  });

  it('returns typescript for .ts files', () => {
    expect(getLanguage('index.ts')).toBe('typescript');
  });

  it('returns json for .json files', () => {
    expect(getLanguage('package.json')).toBe('json');
  });

  it('returns python for .py files', () => {
    expect(getLanguage('script.py')).toBe('python');
  });

  it('returns null for unknown extensions', () => {
    expect(getLanguage('readme.txt')).toBeNull();
  });

  it('returns null for files without extension', () => {
    expect(getLanguage('Makefile')).toBeNull();
  });
});

describe('isCodeFile', () => {
  it('returns true for code files', () => {
    expect(isCodeFile('app.js')).toBe(true);
    expect(isCodeFile('main.go')).toBe(true);
    expect(isCodeFile('style.css')).toBe(true);
  });

  it('returns false for non-code files', () => {
    expect(isCodeFile('readme.md')).toBe(false);
    expect(isCodeFile('photo.png')).toBe(false);
  });
});

describe('isMediaFile', () => {
  it('returns true for image files', () => {
    expect(isMediaFile('photo.png')).toBe(true);
    expect(isMediaFile('banner.jpg')).toBe(true);
  });

  it('returns true for video files', () => {
    expect(isMediaFile('clip.mp4')).toBe(true);
  });

  it('returns false for code files', () => {
    expect(isMediaFile('app.js')).toBe(false);
  });
});

describe('special file type checks', () => {
  it('detects excalidraw files', () => {
    expect(isExcalidrawFile('drawing.excalidraw')).toBe(true);
    expect(isExcalidrawFile('file.json')).toBe(false);
  });

  it('detects mermaid files', () => {
    expect(isMermaidFile('diagram.mmd')).toBe(true);
    expect(isMermaidFile('chart.mermaid')).toBe(true);
    expect(isMermaidFile('file.md')).toBe(false);
  });

  it('detects PDF files', () => {
    expect(isPdfFile('document.pdf')).toBe(true);
    expect(isPdfFile('document.PDF')).toBe(true);
    expect(isPdfFile('file.txt')).toBe(false);
  });
});

describe('getViewerType', () => {
  it('returns editor for markdown files', () => {
    expect(getViewerType({ name: 'readme.md' })).toBe('editor');
    expect(getViewerType({ name: 'doc.markdown' })).toBe('editor');
  });

  it('returns editor for quipu files', () => {
    expect(getViewerType({ name: 'note.quipu', isQuipu: true })).toBe('editor');
  });

  it('returns code for code files', () => {
    expect(getViewerType({ name: 'app.js' })).toBe('code');
    expect(getViewerType({ name: 'data.json' })).toBe('code');
  });

  it('returns excalidraw for excalidraw files', () => {
    expect(getViewerType({ name: 'drawing.excalidraw' })).toBe('excalidraw');
  });

  it('returns media for media files', () => {
    expect(getViewerType({ name: 'photo.png', isMedia: true })).toBe('media');
  });

  it('returns diff for diff tabs', () => {
    expect(getViewerType({ name: 'file.js', isDiff: true })).toBe('diff');
  });

  it('returns null for null input', () => {
    expect(getViewerType(null)).toBeNull();
  });
});
