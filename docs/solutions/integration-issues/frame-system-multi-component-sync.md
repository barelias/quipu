---
title: "FRAME System Multi-Component Sync"
date: 2026-03-01
category: integration-issues
problem_type: integration-gap
severity: high
tags:
  - FRAME
  - terminal
  - editor-comments
  - claude-skills
  - useEffect-deps
  - electron-ipc
  - sidecar-files
components:
  - Terminal.jsx
  - Editor.jsx
  - frameService.js
  - claudeInstaller.js
  - WorkspaceContext.jsx
  - App.jsx
  - electron/main.cjs
---

# FRAME System Multi-Component Sync

## Problem

After the initial FRAME system implementation, three integration gaps remained:

1. **Terminal stuck in old cwd** — Switching workspaces didn't restart the terminal. The `useEffect` in `Terminal.jsx` had an empty dependency array `[]`, so it only ran once on mount.
2. **Claude skills not auto-installed** — The `.claude/` skills, commands, scripts, and hook config for FRAME awareness only existed in the Quipu project repo, not in workspaces opened within Quipu.
3. **Editor comments ephemeral** — TipTap comment marks were stored in-memory only. Saving to markdown stripped them (serializer outputs empty strings). No bridge to FRAME sidecar files.

A secondary issue surfaced during testing: **ENOENT errors flooding the Electron console** when `readFrame()` and `claudeInstaller.fileExists()` tried to read non-existent files.

## Root Cause

| Issue | Root Cause |
|-------|-----------|
| Terminal not restarting | `useEffect(() => { ... }, [])` — empty deps, never re-runs on prop change |
| Skills not installed | No installer service existed; `.claude/` files were static repo assets |
| Comments not persisted | No sync layer between TipTap marks and FRAME JSON sidecar files |
| ENOENT noise | Electron `read-file` IPC handler threw on missing files instead of returning null |

## Solution

### Fix 1: Terminal restart on workspace change

**File**: `src/components/Terminal.jsx`

One-line change — add `workspacePath` to the dependency array:

```javascript
// Before
}, []);

// After
}, [workspacePath]);
```

The existing cleanup function already handles full teardown (removes event listeners, closes WebSocket, disposes xterm). Adding the dependency makes the effect re-run on workspace change, destroying the old terminal and creating a new one with the correct cwd.

### Fix 2: Auto-install Claude skills on workspace open

**New file**: `src/services/claudeInstaller.js`

Service that embeds FRAME-related Claude Code file content as string constants and writes them into any workspace:

- Creates `.claude/skills/`, `.claude/commands/`, `.claude/scripts/` directories
- Writes `frame.md` (skill), `frame.md` (command), `load-frame.sh` (hook script)
- **Skips files that already exist** to preserve user customizations
- **Merges `.claude/settings.json`** — reads existing JSON, adds PostToolUse hook only if not present. If existing JSON is invalid, skips merge to avoid data loss.

**Integration** (`src/context/WorkspaceContext.jsx`, `selectFolder()`):

```javascript
// Fire-and-forget after reading directory
claudeInstaller.installFrameSkills(folderPath).catch((err) => {
  console.warn('Claude skills install failed:', err);
});
```

### Fix 3: Two-way comment-FRAME sync

**Files**: `src/components/Editor.jsx`, `src/services/frameService.js`, `src/App.jsx`

Three-part bidirectional bridge:

**a) Comment -> FRAME** (`addComment`): After applying the TipTap mark, compute line number from editor position, call `frameService.addAnnotation()` with shared UUID so both systems reference the same ID.

```javascript
const { from } = editor.state.selection;
const lineNumber = posToLineNumber(editor.state.doc, from);
frameService.addAnnotation(workspacePath, activeFile.path, {
    id: commentId, line: lineNumber, text: commentText,
    type: 'review', author: 'user',
}).catch(err => console.warn('Failed to sync comment to FRAME:', err));
```

**b) FRAME -> Comment** (new `useEffect`): When switching tabs, reads FRAME via `frameService.readFrame()`. For each annotation, converts line number to editor position and applies a comment mark. Deduplicates by ID, skips `.quipu` files, guards against stale line numbers.

**c) Resolve -> FRAME** (`resolveComment`): After removing the editor mark, calls `frameService.removeAnnotation()` to delete from the FRAME sidecar.

**Supporting changes**:
- `frameService.js`: Added `removeAnnotation()`, made `addAnnotation()` accept optional `id` parameter
- `App.jsx`: Passes `workspacePath` prop to `<Editor>`
- `Editor.jsx`: Added `posToLineNumber()` and `lineNumberToPos()` helper functions outside the component

### Fix 4: ENOENT error noise

**File**: `electron/main.cjs`

```javascript
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
});
```

Plus defensive null check in `frameService.readFrame()`:

```javascript
const content = await fs.readFile(framePath);
if (!content) return null;
return JSON.parse(content);
```

## Prevention

### useEffect dependency arrays
- Every `useEffect` that uses props/state must include them in deps. An empty `[]` means "mount only" — if the effect uses any changing value, it's a bug.
- Use ESLint `exhaustive-deps` rule set to `"error"`.
- Code review checklist item: verify all `useEffect` deps match variables used inside.

### Sidecar file patterns
- Ephemeral UI state (comments, annotations) should always have a persistence layer when it needs to survive across sessions.
- Use shared UUIDs between in-memory marks and sidecar entries for deduplication and sync.
- Fire-and-forget writes with `.catch()` — never block the UI on sidecar I/O.

### IPC error handling
- Electron IPC handlers should catch expected errors (`ENOENT`, `EACCES`) and return `null` or structured error objects. Only unexpected errors should throw.
- Both Electron and Go server handlers must follow identical error semantics for dual-runtime consistency.

### Auto-install configuration
- When an app creates workspace-level config files, the installer must be **idempotent** (skip existing files) and **non-blocking** (fire-and-forget).
- If merging JSON config, always validate existing content before overwriting. Skip merge on invalid JSON.

## Related Documents

- [Feature plan](../../plans/2026-03-01-feat-terminal-frame-agent-comment-integration-plan.md) — Original 4-phase plan for FRAME system
- [Editor font, command palette & theme toggle](../ui-bugs/editor-font-command-palette-theme-toggle.md) — Theme toggle patterns
- [useCallback temporal dead zone](../runtime-errors/usecallback-temporal-dead-zone-in-useeffect.md) — Hook ordering conventions
- [File explorer & editor integration fixes](../integration-issues/file-explorer-editor-integration-fixes.md) — `.quipu/` exclusion, dual-runtime patterns
