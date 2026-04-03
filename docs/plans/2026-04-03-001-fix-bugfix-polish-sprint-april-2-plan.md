---
title: "fix: Bugfix and Polish Sprint — April 3, 2026"
type: fix
status: active
date: 2026-04-03
deepened: 2026-04-03
---

# Bugfix and Polish Sprint — April 3, 2026

## Overview

Addresses 14 user-reported issues spanning PDF viewing, code editing, file explorer, editor behavior, and UI polish. Builds on the completed [April 1 bugfix sprint](2026-04-01-fix-bugfix-and-polish-sprint-plan.md).

## Problem Frame

Multiple usability issues and missing behaviors across the application. Some are regressions (drag-and-drop highlight stuck, raw mode not editable), some are missing features (Ctrl+scroll zoom, inline mermaid, root-level file creation), and some are UX friction (PDF single-page view, code viewer cursor/line issues, tab sizing).

## Requirements Trace

- R1. PDF viewer shows all pages stacked vertically with scroll-to-page navigation
- R2. PDF comment highlights work on double-column documents
- R3. Markdown code blocks have a visible language selector
- R4. Code files (JSON, etc.) use Monaco editor for correct line numbers and cursor
- R5. Ctrl+scroll zooms all content types (editor, PDF, code, images)
- R6. "New folder" input renders at correct depth in file explorer
- R7. Root-level file/folder creation via right-click on empty explorer space
- R8. Wiki-link `[[` syntax works without bracket escaping
- R9. Folder links in editor open/close the folder in explorer (toggle behavior)
- R10. Raw mode allows editing
- R11. Drag-and-drop highlight clears when drag is cancelled
- R12. Mermaid code blocks render inline diagrams in the editor
- R13. Tab bar tabs are slightly wider
- R14. Web links open in a new browser tab, not a popup

## Scope Boundaries

- No new file format support beyond what exists
- No redesign of the comment system architecture
- Monaco replaces CodeViewer only — TipTap editor unchanged
- Mermaid rendering is read-only preview in richtext mode, not a full editor

## Context & Research

### Relevant Code and Patterns

- `src/components/PdfViewer.jsx` — single-page `react-pdf` rendering with comment system
- `src/components/CodeViewer.jsx` — highlight.js textarea overlay, to be replaced by Monaco
- `src/components/Editor.jsx` — TipTap editor, mode toggle (`richtext`/`obsidian`/`raw`), zoom state
- `src/components/FileExplorer.jsx` — `FileTreeItem` with drag-and-drop, context menu; `FileExplorer` root component has no context menu
- `src/components/TabBar.jsx` — tab styling with `px-3`, `h-[35px]`
- `src/extensions/WikiLink.js` — `wikiLinksToHTML()` regex, no `addInputRules` (wiki links only work on load, not while typing)
- `src/components/MermaidViewer.jsx` — standalone mermaid file viewer (not inline)
- `src/utils/fileTypes.js` — centralized file type detection and `getViewerType()`

### Institutional Learnings

- File tree mutations must call `setDirectoryVersion(v => v + 1)` to refresh expanded subdirectories
- New viewer types follow the 5-step checklist: fileTypes.js → getViewerType() → component → App.jsx routing → content change wiring
- Binary files use `fs.getFileUrl()`, never `readFile()`
- Editor mode persists in localStorage under `quipu-editor-mode` — raw mode already exists in the cycle but renders a non-editable `<pre>`
- Tab styling uses `group/tab` named Tailwind groups for scoped hover states

## Key Technical Decisions

- **Monaco over highlight.js for code files**: The custom textarea+highlight overlay in CodeViewer has fundamental cursor and line-number sync issues. Monaco is the industry standard for code editing in web apps and solves all reported problems. Use `@monaco-editor/react` for React integration.
- **All-pages PDF scroll vs. virtual scroll**: Render all pages stacked with `react-pdf`. For PDFs with many pages, use intersection observer to lazy-render pages as they enter the viewport. Page navigator becomes a scroll-to anchor.
- **Wiki links — add TipTap input rule**: The `[[` issue is that the WikiLink extension has no `addInputRules()`, so typing `[[` doesn't create a wiki link node in real-time. The extension only works via `wikiLinksToHTML()` at load time. The `tiptap-markdown` serializer may also be escaping `[` characters. Both need fixing.
- **Mermaid inline rendering**: Use a TipTap node view for code blocks with `language=mermaid` that renders the diagram below the code. This avoids a new extension — it piggybacks on the existing CodeBlock node.
- **Ctrl+scroll zoom**: Implement at the App level with a global zoom context/state, propagated to each viewer. Editor already has `zoomLevel` — lift it up or unify.
- **Raw mode editing**: Convert the `<pre>` tag to a `<textarea>` and wire `onChange` to `onContentChange`.

## Open Questions

### Resolved During Planning

- **Should Monaco be lazy-loaded?**: Yes — Monaco is ~2MB. Use `React.lazy()` + `Suspense` to avoid impacting initial load for non-code files.
- **PDF: render all pages at once for large PDFs?**: No — use intersection observer to only render pages near the viewport. Keep a buffer of ±2 pages.

### Deferred to Implementation

- **Exact Monaco theme configuration**: Match the existing dark theme tokens at implementation time
- **Mermaid rendering error handling**: How to display syntax errors inline — decide when seeing actual mermaid render failures

## Implementation Units

### Priority 1 — Core Fixes

- [ ] **Unit 1: PDF all-pages scroll view with lazy rendering**

**Goal:** Replace single-page PDF view with a vertically-stacked scroll view. Page navigator scrolls to page instead of switching.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/components/PdfViewer.jsx`

**Approach:**
- Render a container with one `<Page>` per page, each wrapped in a sentinel div
- Use `IntersectionObserver` to track which pages are near the viewport; only render `<Page>` for visible ±2 pages, show placeholder divs (with correct height based on page dimensions) for others
- Replace prev/next buttons with a page number input that calls `element.scrollIntoView()` on the target page's sentinel div
- Track current page via intersection observer (whichever page is most visible updates `pageNumber` state)
- **Comment system adaptation (significant):** The current comment system is coupled to single-page rendering — it uses a single `pageContainerRef`, queries one `.react-pdf__Page` element, and uses `page.offsetHeight` for positioning. With multi-page scroll:
  - Each page wrapper needs its own ref or data attribute for comment positioning
  - Highlight rects must be computed per-page within each page's coordinate space
  - Comments sidebar should show comments for all visible pages (use the intersection observer's visible page set)
  - When pages are lazy-unmounted (outside ±2 buffer), their text layers are destroyed. Store highlight data as **character offsets within the text content string** (not DOM Range serialization) so highlights can be reconstructed when pages remount

**Patterns to follow:**
- Existing `PdfViewer.jsx` structure — keep comment system, scale controls
- `react-pdf` `<Document>` + `<Page>` API

**Test scenarios:**
- Happy path: Open a multi-page PDF → all pages visible in scroll, scroll down to see subsequent pages
- Happy path: Enter page number in navigator → view scrolls to that page
- Edge case: Single-page PDF renders correctly without scroll artifacts
- Edge case: PDF with 100+ pages doesn't render all pages at once (intersection observer lazy loading)
- Integration: Comments on page 3 appear when scrolling to page 3

**Verification:**
- PDF opens with all pages stacked, scrollable
- Page navigator input scrolls to target page
- Large PDFs don't cause performance issues

---

- [ ] **Unit 2: Fix PDF comment highlights on double-column documents**

**Goal:** Fix text selection and highlight overlay positioning on multi-column PDF layouts.

**Requirements:** R2

**Dependencies:** Unit 1 (page structure changes)

**Files:**
- Modify: `src/components/PdfViewer.jsx`

**Approach:**
- The current highlight system uses `Range` API to find matching text in the PDF text layer. On double-column documents, `react-pdf`'s text layer spans may split across columns with different positioning
- Instead of matching by text content alone, store the selection's `Range` serialization (start container offset, end container offset relative to the text layer) or use character offsets within the text layer
- When restoring highlights, use the stored offsets to recreate the Range and get bounding rects via `range.getClientRects()` (which returns multiple rects for multi-line/multi-column selections)
- Render one highlight rect per `ClientRect` returned, not one rect for the bounding box

**Patterns to follow:**
- Existing `highlightRects` state and overlay rendering in PdfViewer

**Test scenarios:**
- Happy path: Select text spanning two columns in a double-column PDF → highlight covers both column segments
- Happy path: Comment on single-column PDF still works as before
- Edge case: Selection that starts in one column and ends in another produces correct multi-rect highlight

**Verification:**
- Comment highlights visually match the selected text on both single and double-column PDFs

---

- [ ] **Unit 3: Replace CodeViewer with Monaco editor**

**Goal:** Replace the highlight.js textarea overlay with Monaco for correct line numbers, cursor positioning, and syntax highlighting.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `src/components/CodeViewer.jsx` (rewrite internals)
- Modify: `package.json` (add `@monaco-editor/react`)
- Modify: `src/utils/fileTypes.js` (if language mapping changes needed)

**Approach:**
- Before committing to Monaco, spend 30 minutes investigating whether the textarea/highlight overlay sync in the current CodeViewer can be fixed (line-height sync, scroll offset). If unfixable, proceed with Monaco.
- Install `@monaco-editor/react`
- Replace CodeViewer internals with `<Editor>` from `@monaco-editor/react`, lazy-loaded via `React.lazy`
- **Monaco worker configuration:** `@monaco-editor/react` loads workers from CDN by default. This works in browser mode but may fail in Electron due to CSP or offline. Configure `MonacoEnvironment.getWorker` to use Vite-bundled workers, or verify the CDN approach works in both runtimes before shipping. If using bundled workers, ensure `electron-builder` includes the worker files.
- Map existing `getLanguage()` return values to Monaco language identifiers
- Configure Monaco with: read-only=false, dark theme matching app theme tokens, minimap off, line numbers on, word wrap on, font size from existing settings
- Wire `onChange` to `onContentChange` prop
- Maintain the existing 816px centered layout and responsive breakpoints around the Monaco container
- Remove highlight.js dependencies once Monaco is confirmed working

**Patterns to follow:**
- Existing `CodeViewer` prop interface: `{ content, fileName, onContentChange }`
- 816px page layout from `Editor.jsx` and current `CodeViewer.jsx`

**Test scenarios:**
- Happy path: Open a `.json` file → Monaco renders with correct syntax highlighting, line numbers, and cursor
- Happy path: Edit a `.py` file → changes propagate via `onContentChange`, dirty indicator appears
- Happy path: Open a `.go` file → correct language detection and highlighting
- Edge case: Open a file with unknown extension → Monaco renders as plain text
- Edge case: Very large file (10k+ lines) → Monaco handles scrolling and rendering

**Verification:**
- Code files render with correct line numbers and working cursor
- Syntax highlighting matches file type
- Editing and saving works end-to-end

---

- [ ] **Unit 4: Wiki-link `[[` input rule and escaping fix**

**Goal:** Allow typing `[[path]]` in the editor to create wiki links in real-time, and fix bracket escaping.

**Requirements:** R8

**Dependencies:** None

**Files:**
- Modify: `src/extensions/WikiLink.js`

**Approach:**
- Add `addInputRules()` to the WikiLink extension using TipTap's `nodeInputRule` helper (not generic `addInputRules`). Use a find regex like `/\[\[([^\]]+)\]\]$/` — when the user types the closing `]]`, ProseMirror matches the full `[[...]]` pattern in the current text block and replaces it with a `wikiLink` atom node. Extract `path` and optional `label` (split on `|`) via `getAttributes`.
- The escaping issue is caused by `tiptap-markdown`'s serializer escaping `[` as `\[` before the wiki link pattern can be recognized. Using `nodeInputRule` solves this — once `[[path]]` becomes a `wikiLink` atom node, the custom serializer in `addStorage.markdown.serialize` handles output correctly (it writes `[[path]]` directly, bypassing markdown escaping).

**Patterns to follow:**
- TipTap `addInputRules()` API
- Existing `addStorage.markdown` serialization in WikiLink.js

**Test scenarios:**
- Happy path: Type `[[my-note]]` → converts to a clickable wiki link node
- Happy path: Type `[[path|Display Name]]` → creates wiki link with label
- Edge case: Type `[[` then delete → no partial node created
- Edge case: Existing wiki links in loaded markdown files still render correctly

**Verification:**
- Typing `[[path]]` creates a wiki link inline
- No `\[` escaping artifacts appear

---

### Priority 2 — Explorer and Navigation Fixes

- [ ] **Unit 5: File explorer — root-level creation and new-folder depth fix**

**Goal:** Enable right-click on empty explorer space to create files/folders at root level. Fix "New folder" input rendering at wrong depth.

**Requirements:** R6, R7

**Dependencies:** None

**Files:**
- Modify: `src/components/FileExplorer.jsx`

**Approach:**
- **Root-level creation (R7):** Add `onContextMenu` handler to the scrollable file tree container div (the one with `onDragOver={handleRootDragOver}`). Show a context menu with "New File" and "New Folder" options. These call `createNewFile(workspacePath, name)` and `createNewFolder(workspacePath, name)` respectively. Add `isCreating` and `createValue` state to the `FileExplorer` component (similar to `FileTreeItem`), and render the creation input at the top of the file list when active.
- **New folder depth (R6):** The `isCreating` input inside `FileTreeItem` renders at `depth + 1` indentation (line 297: `paddingLeft: ${12 + (depth + 1) * 16}px`). This is correct for items inside a folder. If the visual level appears wrong, the issue may be that `toggleFolder` hasn't expanded the parent before `setIsCreating` fires. Verify the expand-then-create sequence in `handleNewFolder`: `if (!isExpanded) toggleFolder(entry.path)` runs synchronously but folder expansion is async (triggers `loadSubDirectory`). The creation input may render before children load, appearing at the wrong visual position. Fix: ensure the creation input renders after the children container, not before.

**Patterns to follow:**
- Existing `FileTreeItem` creation input pattern
- Context menu pattern from `FileTreeItem.contextMenuItems`

**Test scenarios:**
- Happy path: Right-click empty area in explorer → context menu with "New File" / "New Folder"
- Happy path: Create file at root level → file appears in tree
- Happy path: Right-click folder → "New Folder" → input appears at correct indentation inside the folder
- Edge case: Right-click empty area when no workspace is open → no context menu

**Verification:**
- Root-level file and folder creation works
- Creation input indentation matches the target folder's children depth

---

- [ ] **Unit 6: Drag-and-drop highlight cleanup on cancelled drag**

**Goal:** Clear the `isDragOver` highlight state when a drag operation is cancelled (Escape, drop outside target).

**Requirements:** R11

**Dependencies:** None

**Files:**
- Modify: `src/components/FileExplorer.jsx`

**Approach:**
- The `isDragOver` state on `FileTreeItem` is set on `dragover` and cleared on `dragleave`/`drop`. But if the drag is cancelled (Escape key, drop outside the explorer), no `dragleave` event fires on the highlighted element.
- Add a document-level `dragend` listener in `FileExplorer` (via `useEffect`). On `dragend`, dispatch a custom event (e.g., `quipu-drag-end`) that all `FileTreeItem` instances listen for to clear their local `isDragOver` state. Also reset `isRootDragOver` in the same handler.
- Note: `dragend` fires on the *source* element, not the target — so a document-level listener catches all cases (completed drops, cancelled drags, drops outside the explorer).

**Patterns to follow:**
- HTML5 drag-and-drop event lifecycle
- Existing `isRootDragOver` cleanup pattern

**Test scenarios:**
- Happy path: Drag file over folder → highlight appears → drop → highlight clears
- Edge case: Drag file over folder → press Escape → highlight clears
- Edge case: Drag file over folder → drop outside explorer → highlight clears

**Verification:**
- No stuck highlight state after any drag operation (completed, cancelled, or dropped outside)

---

- [ ] **Unit 7: Folder links toggle open/close in explorer**

**Goal:** When clicking a folder link (wiki-link or other reference) in the editor, toggle the folder open/closed in the file explorer.

**Requirements:** R9

**Dependencies:** None

**Files:**
- Modify: `src/extensions/WikiLink.js` (or the `onOpen` handler in Editor.jsx)
- Modify: `src/context/WorkspaceContext.jsx` (if `toggleFolder` needs to be exposed differently)

**Approach:**
- The `WikiLink` extension's `onOpen` callback currently calls a handler that opens files. When the target path is a directory, it should call `toggleFolder(path)` instead.
- In the `onOpen` handler (wired in Editor.jsx), check if the path points to a directory. If so, call `toggleFolder`; if already expanded, call `toggleFolder` again to collapse. The existing `toggleFolder` already does this toggle behavior.
- To determine if a path is a directory: check against the file tree state first (search `fileTree` recursively for the path and check `isDirectory`). Fall back to `fs.stat()` if the path is not in the loaded tree. Do not use extension heuristics — directories can have dots in names.

**Patterns to follow:**
- Existing `openFile` / `toggleFolder` in WorkspaceContext

**Test scenarios:**
- Happy path: Click a `[[my-folder]]` link → folder expands in explorer sidebar
- Happy path: Click same link again → folder collapses
- Edge case: Click a link to a non-existent folder → no crash, possibly a toast

**Verification:**
- Folder links toggle the folder open/closed in the explorer

---

### Priority 3 — Editor Behavior

- [ ] **Unit 8: Raw mode editing**

**Goal:** Make raw mode editable instead of read-only `<pre>`.

**Requirements:** R10

**Dependencies:** None

**Files:**
- Modify: `src/components/Editor.jsx`

**Approach:**
- Replace the `<pre>` element at line 1064 with a `<textarea>`
- Initialize textarea value from the same source as the current `<pre>` content
- Maintain a local `rawContent` state in the textarea. On change, update `rawContent` only — do not call `onContentChange` on every keystroke
- On save (Ctrl+S): for `.quipu` files, attempt `JSON.parse(rawContent)`. If valid, call `onContentChange` with the parsed object. If invalid, show an error toast and block the save — keep the textarea content for further editing, file retains old version on disk. For `.md` and other files, call `onContentChange` with the raw string directly.
- Style the textarea to match the current `<pre>` appearance (monospace, same padding, same background)

**Patterns to follow:**
- Existing raw mode render block in Editor.jsx (line 1063-1068)
- `onContentChange` callback pattern

**Test scenarios:**
- Happy path: Switch to raw mode → text is editable → make changes → dirty indicator appears
- Happy path: Edit markdown in raw mode → save → reopen in richtext mode → changes reflected
- Edge case: Edit `.quipu` JSON in raw mode → save → file saves valid JSON
- Error path: Edit `.quipu` JSON to invalid JSON → save → show error toast, don't corrupt file

**Verification:**
- Raw mode content is editable and changes persist on save

---

- [ ] **Unit 9: Ctrl+scroll zoom for all content types**

**Goal:** Ctrl+scroll wheel zooms content across all viewers (editor, PDF, code, images).

**Requirements:** R5

**Dependencies:** Unit 3 (Monaco needs to receive zoom)

**Files:**
- Modify: `src/components/Editor.jsx` (add wheel listener to existing zoom)
- Modify: `src/components/PdfViewer.jsx` (add wheel listener to existing scale)
- Modify: `src/components/CodeViewer.jsx` (add zoom state + wheel listener for Monaco font size)

**Approach:**
- Keep zoom state local to each viewer — no state lifting. Each viewer already has or will have its own zoom/scale state. Ctrl+scroll simply adds a new input method to adjust each viewer's existing zoom independently.
- Add a `wheel` event listener (with `{ passive: false }` to allow `preventDefault`) to each viewer's container div. When `e.ctrlKey` is held, adjust the viewer's local zoom state and call `e.preventDefault()` to suppress browser zoom.
- Editor: wire to existing `zoomLevel` state (already has `transform: scale()`)
- PDF: wire to existing `scale` state (already has `<Page scale={scale}>`)
- Monaco (CodeViewer): add a `fontSize` state, adjustable via Ctrl+scroll
- Each viewer persists its own zoom in localStorage independently
- Zoom range: 50%-200% in 10% increments per Ctrl+scroll tick

**Patterns to follow:**
- Existing `zoomLevel` state and `transform: scale()` in Editor.jsx
- Existing `scale` state in PdfViewer.jsx

**Test scenarios:**
- Happy path: Ctrl+scroll up on editor → content gets bigger
- Happy path: Ctrl+scroll down on PDF → PDF gets smaller
- Happy path: Ctrl+scroll on code file → Monaco font size changes
- Edge case: Zoom at maximum (200%) → Ctrl+scroll up does nothing
- Edge case: Zoom persists across tab switches and page reload

**Verification:**
- Ctrl+scroll zooms content in all viewer types
- Zoom level persists in localStorage

---

- [ ] **Unit 10: Markdown code block language selector**

**Goal:** Add a visible UI to change the language of code blocks in the TipTap editor.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `src/components/Editor.jsx` (or create a node view for code blocks)
- Modify: `src/styles/prosemirror.css` (styling for the language selector)

**Approach:**
- **Important:** The `StarterKit` extension includes a default `codeBlock`. To add a custom node view, first disable it: `StarterKit.configure({ codeBlock: false })`, then register a separate `CodeBlock` extension (from `@tiptap/extension-code-block`) with `addNodeView()` using `ReactNodeViewRenderer`.
- Add a React node view for `codeBlock` that renders a small text input at the top-right corner of each code block
- The input shows the current `language` attribute value (default: "plain text" or empty)
- Typing in the input updates the `language` attribute on the code block node via `updateAttributes({ language: value })`
- Provide a short suggestions list of common languages (js, python, go, css, html, json, bash, mermaid, etc.) that appears on focus
- Style: small, unobtrusive, positioned absolute top-right of the code block

**Patterns to follow:**
- TipTap `addNodeView()` API for CodeBlock
- Existing code block styling in `prosemirror.css`

**Test scenarios:**
- Happy path: Insert code block → language input visible at top-right, defaults to empty/plain text
- Happy path: Type "javascript" in the input → code block language attribute updates
- Happy path: Save and reopen → language persists in markdown as ````javascript`
- Edge case: Clear the language input → defaults back to plain text

**Verification:**
- Each code block has a visible language selector
- Language changes persist through save/reload cycle

---

- [ ] **Unit 11: Inline mermaid diagram rendering in code blocks**

**Goal:** Code blocks with `language=mermaid` render an inline diagram preview below the code.

**Requirements:** R12

**Dependencies:** Unit 10 (language selector provides the `language` attribute UI)

**Files:**
- Modify: `src/components/Editor.jsx` (code block node view)
- Existing: `mermaid` package (already a dependency via MermaidViewer)

**Approach:**
- Extend the code block node view from Unit 10: when `language === 'mermaid'`, render a preview div below the code content
- Use `mermaid.render()` with debounced input (300ms, matching MermaidViewer pattern)
- Preview is read-only — user edits the code, diagram updates live
- In obsidian mode: same behavior. In raw mode: no preview (raw shows source)
- Handle render errors gracefully: show error message in the preview area
- **Mermaid ID collisions:** `mermaid.render()` creates DOM elements keyed by an ID. Multiple mermaid code blocks in the same document need unique render IDs. Use a per-block counter or UUID (the existing `MermaidViewer.jsx` uses a `renderCounter` — replicate this pattern per node view instance)

**Patterns to follow:**
- `src/components/MermaidViewer.jsx` — `mermaid.render()` with debounce and error handling

**Test scenarios:**
- Happy path: Create code block → set language to "mermaid" → type valid mermaid syntax → diagram renders below
- Happy path: Edit mermaid code → diagram updates after debounce
- Error path: Invalid mermaid syntax → error message shown instead of diagram
- Edge case: Switch language from "mermaid" to "javascript" → diagram preview disappears

**Verification:**
- Mermaid code blocks show live diagram preview in richtext and obsidian modes

---

### Priority 4 — UI Polish

- [ ] **Unit 12: Wider tabs in tab bar**

**Goal:** Increase tab minimum width for better readability.

**Requirements:** R13

**Dependencies:** None

**Files:**
- Modify: `src/components/TabBar.jsx`

**Approach:**
- Add `min-w-[120px]` (or similar) to tab items to prevent them from being too narrow
- Optionally increase `px-3` to `px-4` for more breathing room
- Keep `max-w-[150px]` text truncation or increase to `max-w-[180px]`

**Test expectation:** none — pure styling change, visual verification only

**Verification:**
- Tabs are visually wider and more readable
- Tab bar still scrolls horizontally when many tabs are open

---

- [ ] **Unit 13: Web links open in new browser tab**

**Goal:** External links (http/https) in the editor open in a new browser tab instead of a popup or doing nothing.

**Requirements:** R14

**Dependencies:** None

**Files:**
- Modify: `src/components/Editor.jsx` (add click handler or ProseMirror plugin for links)
- Modify: `electron/main.cjs` (if Electron needs `shell.openExternal` for external URLs)
- Modify: `electron/preload.cjs` (expose `openExternal` if needed)

**Approach:**
- Add a ProseMirror plugin (or extend an existing one) that intercepts clicks on `<a>` elements with `href` starting with `http://` or `https://`
- In browser mode: `window.open(href, '_blank')` 
- In Electron mode: `window.electronAPI.openExternal(href)` which calls `shell.openExternal(href)` in main process
- Prevent default navigation behavior

**Patterns to follow:**
- WikiLink click handler plugin pattern in `src/extensions/WikiLink.js`
- Dual-runtime pattern: browser uses `window.open`, Electron uses `shell.openExternal`

**Test scenarios:**
- Happy path: Click an `https://example.com` link in a markdown file → opens in system browser (Electron) or new tab (browser)
- Edge case: Internal wiki links (`[[path]]`) are not affected
- Edge case: `mailto:` links are not intercepted

**Verification:**
- External links open correctly in both runtimes without a popup dialog

---

## System-Wide Impact

- **Interaction graph:** Monaco editor addition affects `App.jsx` viewer routing, `CodeViewer.jsx` internals, and the build bundle size. Lazy loading mitigates the bundle impact.
- **State lifecycle risks:** Zoom remains local to each viewer — no conflict between viewers. PDF lazy-rendering lifecycle (mount/unmount pages) affects comment highlight persistence — use character offsets not DOM Ranges.
- **API surface parity:** Ctrl+scroll zoom and web link opening need both Electron and browser runtime support. Monaco works in both runtimes natively.
- **Unchanged invariants:** TipTap editor, comment system, file save formats, and workspace state management are not changed. The CodeViewer prop interface (`content`, `fileName`, `onContentChange`) remains the same even though internals change to Monaco.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Monaco bundle size (~2MB) impacts load time | Lazy-load with `React.lazy` + `Suspense`, only loads when opening code files |
| PDF all-pages rendering causes memory issues on large PDFs | Intersection observer lazy-rendering with ±2 page buffer |
| Mermaid rendering inside TipTap node view is complex | Reuse existing `MermaidViewer` render logic; degrade gracefully on errors |
| Ctrl+scroll may conflict with browser/OS zoom | `e.preventDefault()` on the wheel event when Ctrl is held |
| Wiki-link input rule may conflict with markdown bracket syntax | Test thoroughly with various bracket patterns; input rule should only trigger on complete `[[...]]` |
| Monaco workers may fail in Electron due to CSP/offline | Configure `MonacoEnvironment.getWorker` for bundled workers, or verify CDN works in Electron |
| TipTap code block node view requires disabling StarterKit default | Use `StarterKit.configure({ codeBlock: false })` and register custom CodeBlock separately |
| PDF comment system is deeply coupled to single-page rendering | Budget extra time for Unit 1 — comment positioning/highlight logic needs significant rework |
| Ctrl+scroll `preventDefault` silently fails on passive listeners | Register wheel listeners with `{ passive: false }` option |

## Sources & References

- Previous sprint plan: [docs/plans/2026-04-01-fix-bugfix-and-polish-sprint-plan.md](2026-04-01-fix-bugfix-and-polish-sprint-plan.md)
- Code viewer pattern: `docs/solutions/feature-implementations/syntax-highlighted-code-viewer-component.md`
- File tree refresh pattern: `docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md`
- Editor mode toggle: `docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md`
- Tab styling: `docs/solutions/ui-patterns/status-indicators-tabs-and-activity-bar.md`
