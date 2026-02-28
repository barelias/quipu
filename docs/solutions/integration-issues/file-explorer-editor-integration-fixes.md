---
title: File Explorer & Editor Integration Fixes
date: 2026-02-28
category: integration-issues
tags: [css, tiptap, markdown, xterm, fonts, jsx, unicode, electron, wsl, file-explorer]
severity: moderate
component: Editor, FileExplorer, Terminal, Electron
symptoms:
  - Document has no visible paper-on-desk styling (white page not visible against background)
  - Markdown files display raw syntax instead of rendered content
  - Terminal characters misaligned and broken
  - File tree shows literal "\u2630" text instead of icons
  - App crashes on startup with "Cannot find module electron-squirrel-startup"
  - Folder dialog fails silently on WSL
root_cause: Multiple integration issues discovered during file explorer + document styling feature development
---

# File Explorer & Editor Integration Fixes

## Context

During development of the VS Code-like file explorer sidebar and document "paper on desk" styling for Quipu Simple (React + Electron + Go text editor), six distinct issues were discovered across CSS, JavaScript, and Electron layers. All issues surfaced during the same feature session and were interconnected through the file explorer, editor, terminal, and styling subsystems.

## Solution

### Fix 1: Unclosed CSS Comment Breaking All Page Styling

**File:** `src/components/Editor.css` (line 22)

**Problem:** A malformed CSS comment `/* A4 height *` was missing the closing `*/`, causing the CSS parser to treat ALL subsequent rules as comment content. This silently broke the `.editor-page` class — background, border, box-shadow, padding were never applied.

**Before:**
```css
min-height: 1056px;
/* A4 height *
background: #ffffff;
```

**After:**
```css
min-height: 1056px;
/* A4 height */
background: #ffffff;
```

**Impact:** This single-character fix restored the entire visual design — the white A4 document on tan background with shadow became visible.

---

### Fix 2: Markdown File Rendering

**File:** `src/components/Editor.jsx`

**Problem:** TipTap's StarterKit provides heading/bold/italic node types but doesn't automatically parse markdown syntax from plain text. Loading .md files showed raw markdown.

**Solution:** Install `marked` and convert markdown to HTML before feeding to TipTap:

```javascript
import { marked } from 'marked';

// In file loading effect:
const isMarkdown = activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown');
if (isMarkdown) {
    const html = marked.parse(text);
    editor.commands.setContent(html);
}
```

---

### Fix 3: Terminal Font Loading Race Condition

**Files:** `src/index.css`, `src/components/Terminal.jsx`

**Problem:** xterm.js measured character grid dimensions before web fonts finished loading, causing broken terminal layout. The Google Fonts import also didn't include Fira Code.

**Solution:**
1. Added Fira Code to Google Fonts import
2. Simplified font stack: `"JetBrains Mono", "Fira Code", monospace`
3. Wait for fonts before fitting:

```javascript
term.open(terminalRef.current);
document.fonts.ready.then(() => {
    fitAddon.fit();
});
```

---

### Fix 4: JSX Unicode Escape Rendering Bug

**File:** `src/components/FileExplorer.jsx`

**Problem:** `\u2630` written as raw JSX text renders as the literal string `\u2630`, not the Unicode character. Must use `{'\u2630'}` (JS expression) instead.

**Solution:** Replaced all Unicode symbols with CSS pseudo-elements:

```css
.dir-arrow::before {
  content: '';
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid #c5c5c5;
  transition: transform 0.15s ease;
}
.dir-arrow-open::before {
  transform: rotate(90deg);
}
```

---

### Fix 5: electron-squirrel-startup Module Error

**File:** `electron/main.cjs`

**Problem:** `require('electron-squirrel-startup')` throws when the module isn't installed (only needed for Windows Squirrel installer context).

**Solution:** Wrap in try-catch:

```javascript
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // Not available outside Squirrel installer context
}
```

---

### Fix 6: WSL Folder Dialog Fallback

**Files:** `electron/main.cjs`, `src/components/FolderPicker.jsx`, `src/services/fileSystem.js`

**Problem:** `dialog.showOpenDialog()` fails on WSL because no native desktop environment is available.

**Solution:** Built an in-app folder picker as fallback:
1. Electron tries native dialog first, returns `null` on failure
2. Renderer detects `null` and shows `FolderPicker` component
3. FolderPicker browses filesystem via IPC/REST, supports path input and navigation
4. Added `get-home-dir` IPC and `/homedir` Go endpoint for starting directory

---

## Related Documentation

This is the first solution document for the Quipu Simple project. No existing `docs/solutions/` directory or troubleshooting documentation existed prior.

## Prevention

### Unclosed CSS Comments
- **Install stylelint** with `comment-no-empty` rule to catch malformed comments
- Add CSS validation to pre-commit hooks via husky + lint-staged
- Use IDE CSS validators that highlight syntax errors in real-time

### TipTap Markdown Loading
- Always convert markdown to HTML via `marked.parse()` before passing to `setContent()`
- Add error handling around markdown conversion with plain-text fallback
- Test with edge cases: empty files, nested markdown, special characters

### Web Font Race Conditions
- Always `await document.fonts.ready` before measuring character grids
- Add `<link rel="preload" as="font">` for critical fonts in `index.html`
- Test with slow network simulation (DevTools > Network > Slow 3G)

### JSX Unicode Escapes
- Never use `\uXXXX` as raw JSX text; always wrap in `{'\uXXXX'}` or use CSS
- Prefer CSS-based icons over Unicode symbols for cross-platform consistency
- Consider a centralized constants file for all symbol characters

### Optional Module Crashes
- Wrap all optional `require()` calls in try-catch blocks
- Log which optional features are unavailable rather than crashing
- Document required vs optional dependencies in README

### Electron APIs on WSL
- Always provide web-based fallbacks for native Electron dialogs
- Detect WSL via `/proc/version` containing "microsoft"
- Test on WSL as part of the development workflow
