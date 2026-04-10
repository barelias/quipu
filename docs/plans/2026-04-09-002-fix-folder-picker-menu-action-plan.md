---
title: "fix: Repair File > Open Folder menu action and fallback dialog"
type: fix
status: active
date: 2026-04-09
---

# fix: Repair File > Open Folder menu action and fallback dialog

## Overview

Two bugs make folder opening broken or degraded:

1. **Menu does nothing** — `File > Open Folder...` dispatches `'file.openFolder'` but `handleMenuAction` in `src/App.tsx` has no case for it. The action falls through to the extension-command default and silently no-ops.

2. **Wrong fallback dialog** — When `fs.openFolderDialog()` returns null (browser mode or Electron on WSL), `showFolderPicker` is set to true and a primitive bare text-input dialog renders instead of the fully-implemented `FolderPicker` component that already exists in `src/components/ui/FolderPicker.tsx`.

## Problem Frame

In browser mode (Go server) and on WSL where native Electron dialogs fail, users must manually type an absolute path into a bare text field. The full `FolderPicker` component — which lists directories and allows keyboard+click navigation — is already written but never wired into App.tsx. Additionally the `File > Open Folder` menu item is entirely non-functional regardless of runtime.

## Requirements Trace

- R1. Clicking `File > Open Folder...` must open a folder-selection dialog.
- R2. In Electron on a platform with native dialogs, the OS-native picker must appear.
- R3. In browser mode or when the native dialog is unavailable, the `FolderPicker` directory-browser dialog must appear (not a bare text input).
- R4. Selecting a folder must call `selectFolder(path)` and load the workspace.

## Scope Boundaries

- No changes to `openFolder()` in `FileSystemContext.tsx` — the logic is correct.
- No changes to Electron IPC handler or Go server — both are correct.
- No changes to `FolderPicker.tsx` — the component is complete.
- No new UI or visual design beyond wiring the existing component.

## Context & Research

### Relevant Code and Patterns

- `src/App.tsx:55` — `useFileSystem()` destructure (missing `openFolder`)
- `src/App.tsx:591–670` — `handleMenuAction` switch statement (missing `'file.openFolder'` case)
- `src/App.tsx:773–794` — Primitive fallback dialog (renders bare `<form>` + `<input>` instead of FolderPicker)
- `src/context/FileSystemContext.tsx:214–221` — `openFolder()` already calls `fs.openFolderDialog()` and falls back to `setShowFolderPicker(true)` on null
- `src/components/ui/FolderPicker.tsx` — Fully implemented; manages its own `Dialog.Root`; props are `onSelect(path)` and `onCancel()`
- `src/App.tsx:600` — `case 'file.closeTab'` is the pattern to follow for single-line action dispatch

### Key Observations

- `FolderPicker` already wraps its own `Dialog.Root`, so it must be rendered directly — not nested inside App.tsx's current `Dialog.Root` wrapper. The wrapper must be removed.
- The `'file.openFolder'` → `openFolder()` path then handles both runtimes: Electron native dialog or fallback to `showFolderPicker`.

## Key Technical Decisions

- **Remove the Dialog wrapper in App.tsx, not just the body:** `FolderPicker` self-manages its modal; nesting Dialog roots causes accessibility and z-index issues.
- **Keep `openFolder` as the single call site:** `handleMenuAction` calls `openFolder()`, which owns the native-vs-fallback branching. App.tsx does not need to replicate that logic.

## Open Questions

### Resolved During Planning

- *Should we add a native `showDirectoryPicker()` browser API call?* No — the FolderPicker component already provides good UX for browser mode via the Go server file listing. Native browser APIs don't return filesystem paths, which the Go server requires.

### Deferred to Implementation

- Whether `openFolder` needs a guard for when it is called while a picker is already open — can be assessed during implementation.

## Implementation Units

- [ ] **Unit 1: Wire `file.openFolder` action to `openFolder()`**

  **Goal:** Make `File > Open Folder...` actually open the folder dialog.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Modify: `src/App.tsx`

  **Approach:**
  - Add `openFolder` to the `useFileSystem()` destructure at line 55
  - Add `case 'file.openFolder': openFolder(); break;` to the `handleMenuAction` switch, following the pattern of `case 'file.closeTab'` at line 600

  **Patterns to follow:**
  - `src/App.tsx:600` — `case 'file.closeTab'` single-line dispatch pattern

  **Test scenarios:**
  - Happy path: clicking `File > Open Folder...` triggers the folder dialog (Electron: native picker opens; browser: FolderPicker appears)
  - Happy path: selecting a folder via keyboard shortcut or Quick Open that resolves to `file.openFolder` behaves the same way
  - Edge case: calling `openFolder()` when a workspace is already open replaces it after selection

  **Verification:**
  - `File > Open Folder...` no longer silently no-ops; a dialog appears on click

- [ ] **Unit 2: Replace primitive fallback dialog with `FolderPicker`**

  **Goal:** When `showFolderPicker` is true, render the full directory-browser dialog instead of the bare text input.

  **Requirements:** R3, R4

  **Dependencies:** Unit 1 (so the dialog can be tested via the menu action)

  **Files:**
  - Modify: `src/App.tsx`

  **Approach:**
  - Import `FolderPicker` from `./components/ui/FolderPicker`
  - Replace the entire `{showFolderPicker && <Dialog.Root>...</Dialog.Root>}` block (lines 773–794) with `{showFolderPicker && <FolderPicker onSelect={selectFolder} onCancel={cancelFolderPicker} />}`
  - Do **not** wrap `FolderPicker` in an additional `Dialog.Root` — the component owns its modal

  **Patterns to follow:**
  - `src/components/ui/FolderPicker.tsx:12–15` — props interface (`onSelect`, `onCancel`)

  **Test scenarios:**
  - Happy path (browser mode): dialog opens, shows home directory listing, user can navigate subdirs and click `Select Folder`
  - Happy path: clicking `Cancel` or pressing Escape closes the dialog without changing workspace
  - Happy path: double-clicking a subdirectory navigates into it; `Select Folder` then sets that path as workspace
  - Happy path: typing a path in the path input and pressing Go navigates to it
  - Edge case: typing a non-existent path shows "No subfolders" or an error state without crashing
  - Integration: after selecting a folder, `selectFolder(path)` is called, the workspace loads, and the file tree populates

  **Verification:**
  - In browser mode, the dialog shows a navigable directory listing, not a bare text field
  - Selecting a folder loads the workspace correctly

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `FolderPicker` starts at home dir by calling `fs.getHomeDir()` which may fail in some runtimes | `FolderPicker` has a try/catch in `loadDirectory`; empty state already handled |
| Removing the Dialog.Root wrapper could affect z-index or overlay behavior | `FolderPicker` uses z-[2000]/z-[2001]; existing Dialog wrapper used z-[9998]/z-[9999] — verify visually after change |

## Sources & References

- Related code: `src/App.tsx`, `src/context/FileSystemContext.tsx`, `src/components/ui/FolderPicker.tsx`
- Related code: `src/services/fileSystem.ts` (openFolderDialog implementations)
- Related code: `electron/main.cjs` (open-folder-dialog IPC handler)
