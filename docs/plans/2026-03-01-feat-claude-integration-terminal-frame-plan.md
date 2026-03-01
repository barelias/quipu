---
title: "feat: Claude Integration - File Watching, FRAME Envelope, Terminal Fix"
type: feat
status: active
date: 2026-03-01
---

# Claude Integration — File Watching, FRAME Envelope, Terminal Fix

## Overview

Four related fixes to how Quipu integrates with Claude Code, all scoped to `App.jsx`, `Terminal.jsx`, and `WorkspaceContext.jsx`:

1. **Claude edits should update the open file** — When Claude modifies a file that's open in a tab, the editor should detect the change and reload the content.
2. **Use FRAME envelope, not VSCode change view** — The "Send to Claude" feature (`Ctrl+Shift+L`) currently builds a plain text prompt. It should wrap context in FRAME's structured envelope format.
3. **Send to Terminal should actually run Claude** — `Ctrl+Shift+Enter` (handleSendToTerminal) just pastes text into the terminal. It should launch Claude with the content as a prompt.
4. **Ensure Claude uses the FRAME skill** — The prompt sent to Claude should reference the FRAME context and instruct Claude to use the `/frame` skill for annotations.

## Problem Statement / Motivation

- When Claude edits a file externally, the user sees stale content until they close and reopen the tab. This breaks the feedback loop.
- The current `handleSendToClaude` (App.jsx:116-169) builds a reasonable prompt but doesn't use FRAME's structured format or instruct Claude to use the `/frame` skill.
- `handleSendToTerminal` (App.jsx:77-114) pastes raw editor content — it doesn't launch Claude at all, it just writes text to the terminal.

## Proposed Solution

### 1. File Watching (WorkspaceContext.jsx)

Add file system watching to detect external changes. When a file that's open in a tab is modified externally:
- Compare timestamps or content hashes
- If the tab is clean (not dirty), auto-reload the content
- If the tab is dirty, show a toast: "File changed on disk. Reload?"

### 2. FRAME Envelope (App.jsx)

Restructure `handleSendToClaude` to build a FRAME-compatible prompt:

```
/frame read {filePath}

Context:
- File: {relativePath}
- Instructions: {frame.instructions}
- Annotations: {annotations list}

Task: Review and work with this file. Use /frame to update annotations.
```

### 3. Terminal Send Fix (App.jsx)

Change `handleSendToTerminal` to:
- Launch Claude (if not already running)
- Send the editor content as a Claude prompt (not raw paste)
- Include the file path context

### 4. FRAME Skill Usage (App.jsx)

Add explicit instruction in the Claude prompt to use the `/frame` skill for two-way annotation sync.

## Technical Considerations

- **File watching in Electron**: Already has `watchDirectory` and `onDirectoryChanged` in preload (line 39-41 of fileSystem.js). Currently unused.
- **File watching in Browser**: Go server would need a new WebSocket or polling endpoint for file change events. Simpler approach: poll the file's mtime on an interval or after terminal focus changes.
- **FRAME service**: `frameService.js` already has `readFrame()`, `addAnnotation()`, `removeAnnotation()` — use these to build the envelope.
- **Terminal state tracking**: `isClaudeRunning` state (App.jsx:31) already exists but isn't reliable — it's set to true when Claude is launched but never set back to false.

## System-Wide Impact

- **App.jsx** — Modify `handleSendToTerminal` (~line 77), `handleSendToClaude` (~line 116), add Claude state tracking
- **Terminal.jsx** — Add output monitoring to detect when Claude exits (optional, for `isClaudeRunning` reliability)
- **WorkspaceContext.jsx** — Add `reloadTabFromDisk` function and file watching setup
- **No changes to**: Editor.jsx, FileExplorer.jsx, SearchPanel.jsx, SourceControlPanel.jsx, any service files, backend files

## Acceptance Criteria

- [ ] When Claude (or any external process) modifies an open file, the editor reloads the content automatically (if tab is clean)
- [ ] If tab is dirty when external change detected, a toast notification asks the user to reload
- [ ] `Ctrl+Shift+Enter` launches Claude with editor content as a structured prompt (not raw paste)
- [ ] `Ctrl+Shift+L` sends FRAME-enriched prompt including file instructions and annotations
- [ ] Prompt instructs Claude to use `/frame` for annotation management
- [ ] Works in both Electron and Browser runtimes

## Success Metrics

- Round-trip editing: write a comment → send to Claude → Claude edits file → editor shows updated content
- No stale file content after external modifications

## Dependencies & Risks

- File watching in browser mode is harder — may need polling as a fallback
- Detecting Claude process exit in terminal is unreliable (xterm doesn't expose subprocess lifecycle)
- Risk of infinite loop: Claude edits file → watcher reloads → content change triggers dirty flag. Mitigation: don't mark as dirty on external reload.

## MVP

### WorkspaceContext.jsx — File reload function

```jsx
const reloadTabFromDisk = useCallback(async (tabId) => {
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab) return;

  try {
    const content = await fs.readFile(tab.path);
    const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');

    let bodyContent = content;
    let frontmatter = tab.frontmatter;
    let frontmatterRaw = tab.frontmatterRaw;

    if (isMarkdown && typeof content === 'string') {
      const fm = extractFrontmatter(content);
      frontmatter = fm.frontmatter;
      frontmatterRaw = fm.frontmatterRaw;
      bodyContent = fm.body;
    }

    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? {
        ...t,
        content: bodyContent,
        tiptapJSON: null, // Force editor to re-read from content
        isDirty: false,
        frontmatter,
        frontmatterRaw,
      } : t
    ));
  } catch (err) {
    showToast('Failed to reload file: ' + err.message, 'error');
  }
}, [openTabs, extractFrontmatter, showToast]);
```

### App.jsx — Improved handleSendToClaude

```jsx
const handleSendToClaude = useCallback(async () => {
  if (!activeFile || !workspacePath) {
    showToast('No file open to send to Claude', 'warning');
    return;
  }

  // Auto-save if dirty
  if (editorInstance && activeTab?.isDirty) {
    await saveFile(editorInstance);
  }

  // Expand terminal
  if (terminalPanelRef.current?.isCollapsed()) {
    terminalPanelRef.current.expand();
  }

  // Build FRAME-enriched prompt
  const relativePath = activeFile.path.replace(workspacePath + '/', '');
  let prompt = `Use /frame read ${relativePath} to get the full file context.\n\n`;
  prompt += `Work with: ${relativePath}\n`;

  try {
    const frame = await frameService.readFrame(workspacePath, activeFile.path);
    if (frame?.instructions) {
      prompt += `\nFile instructions: ${frame.instructions}`;
    }
    if (frame?.annotations?.length > 0) {
      const notes = frame.annotations
        .map(a => `- Line ${a.line}: [${a.type}] ${a.text}`)
        .join('\n');
      prompt += `\n\nAnnotations to address:\n${notes}`;
    }
  } catch {}

  prompt += `\n\nAfter making changes, use /frame to update annotations.`;

  terminalRef.current.focus();
  if (isClaudeRunning) {
    terminalRef.current.write(prompt + "\r");
  } else {
    terminalRef.current.write("claude\r");
    setIsClaudeRunning(true);
    setTimeout(() => {
      terminalRef.current.write(prompt + "\r");
    }, 1500);
  }
}, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, showToast]);
```

### App.jsx — Fix handleSendToTerminal to launch Claude

```jsx
const handleSendToTerminal = useCallback(() => {
  if (!editorInstance) return;

  // Get editor content as plain text prompt
  const text = editorInstance.getText();
  if (!text.trim()) return;

  if (terminalRef.current) {
    terminalRef.current.focus();
    if (isClaudeRunning) {
      terminalRef.current.write(text + "\r");
    } else {
      terminalRef.current.write("claude\r");
      setIsClaudeRunning(true);
      setTimeout(() => {
        terminalRef.current.write(text + "\r");
      }, 1500);
    }
  }
}, [editorInstance, isClaudeRunning]);
```

## Sources

- Current handleSendToTerminal: `src/App.jsx:77-114`
- Current handleSendToClaude: `src/App.jsx:116-169`
- File watcher in Electron preload: `src/services/fileSystem.js:39-42`
- FRAME service: `src/services/frameService.js`
- Terminal component: `src/components/Terminal.jsx`
