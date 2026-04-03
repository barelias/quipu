import { describe, it, expect } from 'vitest';

// Test the Monaco language mapping logic (extracted from CodeViewer)
const MONACO_LANG_MAP = {
  javascript: 'javascript',
  typescript: 'typescript',
  json: 'json',
  css: 'css',
  xml: 'xml',
  html: 'html',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  bash: 'shell',
  yaml: 'yaml',
  sql: 'sql',
  ruby: 'ruby',
  php: 'php',
  ini: 'ini',
  scss: 'scss',
  less: 'less',
};

import { getLanguage } from '../utils/fileTypes';

const getMonacoLanguage = (fileName) => {
  const lang = getLanguage(fileName);
  return MONACO_LANG_MAP[lang] || 'plaintext';
};

describe('Monaco language mapping', () => {
  it('maps JavaScript files to javascript', () => {
    expect(getMonacoLanguage('app.js')).toBe('javascript');
    expect(getMonacoLanguage('component.jsx')).toBe('javascript');
  });

  it('maps TypeScript files to typescript', () => {
    expect(getMonacoLanguage('index.ts')).toBe('typescript');
    expect(getMonacoLanguage('component.tsx')).toBe('typescript');
  });

  it('maps JSON files to json', () => {
    expect(getMonacoLanguage('package.json')).toBe('json');
  });

  it('maps Python files to python', () => {
    expect(getMonacoLanguage('main.py')).toBe('python');
  });

  it('maps Go files to go', () => {
    expect(getMonacoLanguage('server.go')).toBe('go');
  });

  it('maps bash to shell', () => {
    expect(getMonacoLanguage('script.sh')).toBe('shell');
    expect(getMonacoLanguage('setup.bash')).toBe('shell');
  });

  it('maps CSS/SCSS/LESS correctly', () => {
    expect(getMonacoLanguage('style.css')).toBe('css');
    expect(getMonacoLanguage('theme.scss')).toBe('scss');
  });

  it('maps YAML files', () => {
    expect(getMonacoLanguage('config.yaml')).toBe('yaml');
    expect(getMonacoLanguage('ci.yml')).toBe('yaml');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getMonacoLanguage('readme.txt')).toBe('plaintext');
    expect(getMonacoLanguage('Makefile')).toBe('plaintext');
  });

  it('maps all C-family languages', () => {
    expect(getMonacoLanguage('main.c')).toBe('c');
    expect(getMonacoLanguage('app.cpp')).toBe('cpp');
    expect(getMonacoLanguage('header.h')).toBe('c');
  });
});
