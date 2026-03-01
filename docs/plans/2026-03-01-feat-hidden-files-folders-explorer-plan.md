---
title: "feat: Show Hidden Files and Folders in Explorer"
type: feat
status: active
date: 2026-03-01
---

# Show Hidden Files and Folders in Explorer

## Overview

Hidden files (dotfiles like `.gitignore`, `.env`) and folders (`.quipu`, `.claude`, `.git`) are currently filtered out at every level of the file system stack. Users need to see these entries — especially `.quipu` (FRAME metadata) and `.claude` (Claude Code config) — to manage their workspace effectively.

## Problem Statement / Motivation

The explorer hides all dotfiles/dotfolders because of hard-coded filters in three places:
1. **Go server** `server/main.go:152` — `strings.HasPrefix(e.Name(), ".")` skips all hidden entries
2. **Electron IPC** `electron/main.cjs:74` — `.filter(e => !e.name.startsWith('.'))` strips them client-side
3. **Search walker** `server/main.go:644` and `electron/main.cjs:232` — skip hidden entries during recursive search

Users expect to see `.quipu/`, `.claude/`, `.gitignore`, `.env.example`, etc. Only truly internal folders like `.git/` and `node_modules/` should be hidden by default.

## Proposed Solution

Replace the blanket "hide all dotfiles" filter with a configurable allowlist/blocklist approach. By default, show all hidden files/folders **except** a small blocklist (`.git`, `node_modules`).

## Technical Considerations

- **Four places to change** (dual runtime architecture):
  1. `server/main.go:150-154` — Go readdir endpoint
  2. `electron/main.cjs:71-74` — Electron readDirectory IPC
  3. `server/main.go:641-647` — Go recursive search walker
  4. `electron/main.cjs:229-233` — Electron recursive search walker
- **No frontend changes needed** — FileExplorer.jsx renders whatever the backend returns; it does not filter dotfiles itself
- **Security**: `.git/` should stay hidden to prevent accidental exposure of git internals
- **Performance**: Showing more files is negligible — typical projects have few dotfiles

## System-Wide Impact

- **FileExplorer.jsx** — No changes. It renders `fileTree` from context as-is.
- **WorkspaceContext.jsx** — No changes. It calls `fs.readDirectory()` and passes results through.
- **SearchPanel.jsx** — Search results will now include matches in dotfiles (desirable).
- **fileSystem.js** — No changes to the adapter itself, only to its backends.

## Acceptance Criteria

- [ ] `.quipu/` and `.claude/` folders appear in the explorer sidebar
- [ ] Dotfiles like `.gitignore`, `.env.example`, `.eslintrc` appear in explorer
- [ ] `.git/` folder is NOT shown (blocklisted)
- [ ] `node_modules/` folder is NOT shown (blocklisted)
- [ ] Recursive search includes results from dotfiles/dotfolders (except blocklisted)
- [ ] Both Electron and Browser runtimes behave identically

## Success Metrics

- All dotfiles/dotfolders (except `.git`, `node_modules`) visible in explorer after opening a workspace

## Dependencies & Risks

- Low risk — simple filter change in 4 isolated locations
- No frontend file changes, no conflict with other plans

## MVP

### server/main.go (readdir filter, ~line 150)

```go
// Replace blanket dotfile skip with blocklist
var hiddenDirs = map[string]bool{".git": true}

// In the readdir loop:
for _, e := range entries {
    if hiddenDirs[e.Name()] {
        continue
    }
    files = append(files, FileEntry{
        Name:        e.Name(),
        Path:        filepath.Join(absPath, e.Name()),
        IsDirectory: e.IsDir(),
    })
}
```

### electron/main.cjs (readdir filter, ~line 71)

```javascript
const HIDDEN_DIRS = new Set(['.git']);

ipcMain.handle('read-directory', async (event, dirPath) => {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
        .filter(e => !HIDDEN_DIRS.has(e.name))
        .map(e => ({
            name: e.name,
            path: path.join(dirPath, e.name),
            isDirectory: e.isDirectory(),
        }));
});
```

### server/main.go (search walker, ~line 641)

```go
// Replace blanket skip with blocklist check
if hiddenDirs[d.Name()] {
    if d.IsDir() {
        return filepath.SkipDir
    }
    return nil
}
```

### electron/main.cjs (search walker, ~line 229)

```javascript
// Replace blanket skip with blocklist check
if (HIDDEN_DIRS.has(entry.name) || excludeDirs.has(entry.name)) continue;
```

### electron/preload.cjs

No changes needed — preload bridges pass data through without filtering.

## Sources

- Go server readdir: `server/main.go:150-154`
- Electron readdir: `electron/main.cjs:71-74`
- Go search walker: `server/main.go:641-647`
- Electron search: `electron/main.cjs:229-233`
- Previous brainstorm noting hidden file filtering: `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md` (line 101)
