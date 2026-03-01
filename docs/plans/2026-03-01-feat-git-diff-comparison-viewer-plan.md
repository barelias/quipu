---
title: "feat: Git Diff Comparison Viewer in Source Control Panel"
type: feat
status: active
date: 2026-03-01
---

# Git Diff Comparison Viewer in Source Control Panel

## Overview

The Source Control panel currently lists changed files with status badges but doesn't show the actual diff. When clicking a changed file, it should display a side-by-side (or inline) diff comparison showing the old version vs. the current version, similar to VSCode's built-in diff viewer.

## Problem Statement / Motivation

Users can see that a file is modified (M), added (A), or deleted (D), but they can't see **what** changed without switching to the terminal and running `git diff`. The brainstorm explicitly called for "Side-by-side diff accurately shows changes for any modified file" as a success criterion (see brainstorm line 120).

The backend already has a `diff` endpoint:
- **Electron**: `window.electronAPI.gitDiff(dirPath, file, staged)` (gitService.js:11)
- **Browser**: `GET /git/diff?file=...&staged=true|false` (gitService.js:28-35)

Both return raw unified diff text. The frontend just needs to parse and render it.

## Proposed Solution

Add an inline diff viewer within the Source Control panel. When a user clicks a changed file:

1. Fetch the unified diff via `gitService.diff(workspacePath, filePath, isStaged)`
2. Parse the diff into hunks (added/removed/context lines)
3. Render a split or inline view with line numbers, color-coded additions (green) and deletions (red)

Use a lightweight diff parser — no heavy library needed. Unified diff format is simple:
- Lines starting with `+` are additions
- Lines starting with `-` are deletions
- Lines starting with `@@` are hunk headers
- Everything else is context

## Technical Considerations

- **SourceControlPanel.jsx** is the only component that changes
- **gitService.js** already has the `diff()` method — no backend changes needed
- **Diff rendering**: A simple custom renderer is preferable to a library dependency (keep it lightweight). Parse unified diff into `{ type: 'add'|'remove'|'context', text, oldLine, newLine }[]` and render colored lines.
- **UI pattern**: Collapsible diff view below the file entry, or a dedicated panel area. Collapsible is simpler and avoids layout changes.
- **Staged vs unstaged**: When clicking a staged file, pass `staged=true` to see the diff of what's staged. For unstaged, pass `staged=false`.

## System-Wide Impact

- **SourceControlPanel.jsx** — Add diff fetching, parsing, and rendering
- **gitService.js** — No changes (diff method already exists at line 11 and 28)
- **No changes to**: Editor.jsx, App.jsx, SearchPanel.jsx, FileExplorer.jsx, any backend files

## Acceptance Criteria

- [ ] Clicking a changed file in Source Control shows the unified diff inline
- [ ] Added lines shown in green (`text-git-added`) background
- [ ] Removed lines shown in red (`text-git-deleted`) background
- [ ] Context lines shown in neutral color
- [ ] Line numbers displayed for both old and new versions
- [ ] Staged file diffs show staged changes; unstaged show working directory changes
- [ ] Clicking the same file again collapses the diff
- [ ] Diff view scrolls independently if content is long
- [ ] Works in both Electron and Browser runtimes

## Success Metrics

- Users can review all changes without leaving Quipu
- Side-by-side diff accurately shows changes for any modified file (from original brainstorm success criteria)

## Dependencies & Risks

- Low risk — diff endpoint already works, just need frontend parsing/rendering
- Large diffs may need truncation (cap at N lines with "show more" button)

## MVP

### SourceControlPanel.jsx — Diff state and fetching

```jsx
const [expandedDiff, setExpandedDiff] = useState(null); // { path, diff, staged }
const [isDiffLoading, setIsDiffLoading] = useState(false);

const handleFileClick = useCallback(async (filePath, isStaged = false) => {
  // Toggle if already expanded
  if (expandedDiff?.path === filePath && expandedDiff?.staged === isStaged) {
    setExpandedDiff(null);
    return;
  }

  setIsDiffLoading(true);
  try {
    const diffText = await gitService.diff(workspacePath, filePath, isStaged);
    setExpandedDiff({ path: filePath, diff: diffText, staged: isStaged });
  } catch (err) {
    showToast('Failed to load diff: ' + err.message, 'error');
  } finally {
    setIsDiffLoading(false);
  }
}, [workspacePath, expandedDiff, showToast]);
```

### SourceControlPanel.jsx — Diff parser

```jsx
function parseDiff(diffText) {
  if (!diffText) return [];
  const lines = diffText.split('\n');
  const result = [];
  let oldLine = 0, newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1]) - 1;
        newLine = parseInt(match[2]) - 1;
      }
      result.push({ type: 'header', text: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      newLine++;
      result.push({ type: 'add', text: line.slice(1), newLine });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      oldLine++;
      result.push({ type: 'remove', text: line.slice(1), oldLine });
    } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
      oldLine++;
      newLine++;
      result.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldLine, newLine });
    }
  }
  return result;
}
```

### SourceControlPanel.jsx — Diff renderer (after file entry)

```jsx
{expandedDiff?.path === file.path && (
  <div className="bg-bg-base border-t border-border max-h-[300px] overflow-auto font-mono text-[11px] leading-[18px]">
    {parseDiff(expandedDiff.diff).map((line, idx) => (
      <div
        key={idx}
        className={cn(
          "flex px-2 whitespace-pre",
          line.type === 'add' && "bg-git-added/10 text-git-added",
          line.type === 'remove' && "bg-git-deleted/10 text-git-deleted",
          line.type === 'header' && "bg-white/[0.03] text-accent font-semibold py-0.5",
          line.type === 'context' && "text-text-secondary",
        )}
      >
        <span className="w-8 text-right pr-2 shrink-0 opacity-50 select-none">
          {line.oldLine || ''}
        </span>
        <span className="w-8 text-right pr-2 shrink-0 opacity-50 select-none">
          {line.newLine || ''}
        </span>
        <span className="flex-1 min-w-0">{line.text}</span>
      </div>
    ))}
  </div>
)}
```

## Sources

- Git diff API (Electron): `src/services/gitService.js:11`
- Git diff API (Browser): `src/services/gitService.js:28-35`
- File click handler: `src/components/SourceControlPanel.jsx:244-251`
- Git status colors: `src/components/SourceControlPanel.jsx:32-39`
- Original brainstorm on diff viewer: `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md` (line 73, 120)
