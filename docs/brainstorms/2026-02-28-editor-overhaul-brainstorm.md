---
title: Editor Overhaul - Tabs, Markdown Fix, Activity Bar, Search & Git
date: 2026-02-28
topic: editor-overhaul
participants: [user, claude]
status: decided
---

# Editor Overhaul: Tabs, Markdown Fix, Activity Bar, Search & Git

## What We're Building

A cohesive set of improvements to Quipu Simple that bring it closer to a VSCode-like editing experience:

1. **Fix markdown round-trip save** - Markdown files currently lose formatting (`#`, `**`, etc.) when saved because `editor.getText()` strips all markup. Need proper TipTap-to-markdown serialization.
2. **Multi-tab file system** - Currently only one file can be open at a time with no way to close it. Add a full tab bar with unsaved indicators, close buttons, confirm-on-close, and Ctrl+Tab switching.
3. **Activity Bar + panel system** - Replace the single FileExplorer sidebar with a VSCode-style icon rail (Activity Bar) that switches between multiple panels.
4. **Search panel** - Full-text search across workspace files + Ctrl+P quick file finder overlay.
5. **Source Control panel** - Full git UI: changed files list, stage/unstage, commit, push, pull, branch switching, side-by-side diff viewer.

## Why This Approach

**Approach chosen: Incremental Layers** (over Big Bang Redesign or Feature Branches)

Build in 4 shippable phases:
- Phase 1: Fix markdown save (quick win, immediate bug fix)
- Phase 2: Multi-tab system (refactor WorkspaceContext)
- Phase 3: Activity Bar + Explorer migration (UI restructure)
- Phase 4: Search + Source Control panels (new features)

**Rationale:** Each phase is testable in isolation, lower risk of breaking existing functionality, and delivers value incrementally. The markdown fix is a standalone bug that doesn't depend on any other work. Tabs need to exist before the Activity Bar makes sense (multiple panels imply multiple files). Search and Git are additive features that plug into the panel system.

## Key Decisions

### 1. Tab System
- **Full VSCode behavior**: Dot indicator on dirty tabs, confirm dialog before closing with unsaved changes, Ctrl+Tab to switch between tabs
- **State model**: Refactor `WorkspaceContext` from single `activeFile` + `isDirty` to `openTabs[]` array with per-tab state (`{ path, name, content, isQuipu, isDirty }`) and `activeTabPath`
- **Tab close with unsaved changes**: Use `window.confirm()` pattern (already used for file delete in FileExplorer)
- **Editor content**: Save/restore TipTap JSON per tab when switching (since TipTap is a single instance)

### 2. Markdown Round-Trip
- **Approach**: Use a library to convert TipTap HTML/JSON back to markdown syntax on save
- **Detection**: Same check as load - `.md` or `.markdown` file extensions
- **Library candidates**: `turndown` (HTML-to-markdown), `tiptap-markdown` extension, or ProseMirror markdown serializer
- **Custom marks**: The custom "comment" mark should be stripped or ignored during markdown serialization (comments are editor-only annotations)
- **Save path changes**: In `WorkspaceContext.saveFile()`, detect markdown files and use the markdown serializer instead of `getText()`

### 3. Activity Bar Layout
- **Structure**: `[ActivityBar | SidePanel | editor-pane / terminal-pane]`
- **Activity Bar**: Narrow dark icon rail (48px wide, dark `#252526` background)
- **Panels**: Warm theme (matching the tan/paper aesthetic) instead of the current dark sidebar
- **Current FileExplorer**: Migrated into the Explorer panel, re-themed to warm colors
- **Panel switching**: Click icon to show panel, click same icon to toggle panel off
- **Panels planned**: Explorer, Search, Source Control

### 4. Theme Strategy
- **Activity Bar**: Dark (`#252526` background, light icons)
- **Side panels (Explorer, Search, Source Control)**: Warm theme using existing CSS variables (`--bg-color`, `--border-color`, `--text-color`)
- **This means FileExplorer CSS needs retheming** from current dark `#252526` to warm tan/paper colors
- **Editor + Terminal**: Unchanged (paper theme for editor, dark for terminal)

### 5. Search Panel
- **Full-text search**: Grep-like search across all workspace files, results show file + line number, click to open file at line
- **Ctrl+P quick file finder**: Overlay/modal that searches filenames, fuzzy match, click to open
- **Backend**: New Go server endpoints (`GET /search?q=...&path=...`) and Electron IPC handlers
- **UI**: Search input + results list in the side panel; Ctrl+P opens a floating command palette

### 6. Source Control / Git
- **Backend approach**: Go server shells out to `git` CLI via `exec.Command` (requires git installed)
- **Electron approach**: Same - use `child_process.exec` to run git commands
- **Service layer**: New `gitService.js` following the same adapter pattern as `fileSystem.js` (electronGit vs browserGit)
- **Full git UI**: Changed files list with M/A/D/U status indicators, per-file and "stage all" buttons, commit message textarea + commit button, push/pull buttons, branch indicator + branch switching dropdown
- **Diff viewer**: Side-by-side diff display (old on left, new on right)
- **Status updates**: Poll `git status` on an interval or after file save events
- **Go endpoints needed**:
  - `GET /git/status` - changed, staged, untracked files
  - `GET /git/diff?path=...` - file-level diff
  - `POST /git/stage` - stage file(s)
  - `POST /git/unstage` - unstage file(s)
  - `POST /git/commit` - commit with message
  - `POST /git/push` - push to remote
  - `POST /git/pull` - pull from remote
  - `GET /git/branches` - list branches
  - `POST /git/checkout` - switch branch
  - `GET /git/log` - recent commits

### 7. File System Abstraction Extension
- Git operations go in a **separate** `gitService.js` (not overloading `fileSystem.js`)
- Search operations go in a **separate** `searchService.js`
- Both follow the same `isElectron() ? electronImpl : browserImpl` adapter pattern
- New Go server endpoints, Electron IPC handlers, and preload bridge additions needed for each

## Constraints & Requirements

- **No TypeScript** - codebase is plain JS/JSX, keep it that way
- **Co-located CSS** - one CSS file per component, no CSS modules or CSS-in-JS
- **CSS variables** - use existing vars from `index.css` for warm theme; new vars may be needed for the activity bar dark theme
- **Functional components only** - no class components
- **useCallback for handlers** - follow existing pattern
- **Dual runtime** - every backend operation needs Go server + Electron IPC implementations
- **Hidden files filtered** - both backends filter dotfiles; git operations may need to see `.git` but not expose it in Explorer

## Open Questions

1. **Markdown library choice**: `turndown` (HTML→MD) vs `tiptap-markdown` (integrated TipTap extension) vs ProseMirror markdown serializer - needs research to pick the best option for TipTap v3.
2. **Diff library**: What React-compatible library to use for side-by-side diff rendering? (diff2html, react-diff-viewer, custom?)

## Resolved Questions

1. **Tab limit**: Cap at 10-15 open tabs. Prompt to close one when exceeded.
2. **Search backend**: Shell out to `grep` or `rg` (ripgrep) CLI from Go server - fast and battle-tested.

## Success Criteria

- Markdown files saved from the editor can be opened in any markdown viewer and render correctly (headings, bold, italic, lists, code blocks preserved)
- Users can have 5+ files open simultaneously and switch between them without losing content or unsaved changes
- Activity Bar provides clear, clickable icons to switch between Explorer, Search, and Source Control panels
- Search returns results across all workspace files within 2 seconds for typical project sizes
- Git status, staging, committing, push/pull all work from the Source Control panel without needing the terminal
- Side-by-side diff accurately shows changes for any modified file
