---
title: "guide: Worktree Workflow for Parallel Development"
type: guide
status: active
date: 2026-03-01
---

# Worktree Workflow for Parallel Development

## Overview

This guide explains how to use **git worktrees** to work on multiple plans simultaneously without branch switching or merge conflicts. Each plan gets its own isolated copy of the repository.

## What is a Git Worktree?

A worktree is a linked copy of your repository at a different path, with its own working directory and branch, but sharing the same `.git` history. Think of it as "checking out multiple branches at once, each in its own folder."

```
quipu_simple/              ← main worktree (main branch)
quipu_simple/.claude/worktrees/
  ├── hidden-files/        ← worktree for Plan 1 (feat/hidden-files)
  ├── editor-richtext/     ← worktree for Plan 2 (feat/editor-richtext)
  ├── claude-integration/  ← worktree for Plan 3 (feat/claude-integration)
  ├── search-highlight/    ← worktree for Plan 4 (feat/search-highlight)
  ├── git-diff/            ← worktree for Plan 5 (feat/git-diff)
  └── landing-page/        ← worktree for Plan 6 (feat/landing-page)
```

## Step-by-Step: Setting Up Worktrees for Each Plan

### 1. Create worktrees for all plans

From your main repository:

```bash
# Create a worktree for each plan with its own branch
git worktree add .claude/worktrees/hidden-files -b feat/hidden-files
git worktree add .claude/worktrees/editor-richtext -b feat/editor-richtext
git worktree add .claude/worktrees/claude-integration -b feat/claude-integration
git worktree add .claude/worktrees/search-highlight -b feat/search-highlight
git worktree add .claude/worktrees/git-diff -b feat/git-diff
git worktree add .claude/worktrees/landing-page -b feat/landing-page
```

Each command:
- Creates a new directory with a full checkout of the repo
- Creates and checks out a new branch based on current HEAD
- Links back to the main `.git` directory (shared history)

### 2. Spawn Claude agents for each plan

Open separate terminals (or use Claude Code's parallel agents) and point each to a different worktree:

```bash
# Terminal 1 — Plan 1: Hidden Files
cd .claude/worktrees/hidden-files
claude "Implement the plan in docs/plans/2026-03-01-feat-hidden-files-folders-explorer-plan.md"

# Terminal 2 — Plan 2: Editor Rich Text
cd .claude/worktrees/editor-richtext
claude "Implement the plan in docs/plans/2026-03-01-feat-editor-rich-text-mode-comment-ux-plan.md"

# Terminal 3 — Plan 3: Claude Integration
cd .claude/worktrees/claude-integration
claude "Implement the plan in docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md"

# ... and so on for each plan
```

### 3. Each agent works in isolation

Since each worktree has its own working directory and branch:
- No merge conflicts during development
- Each agent can `npm install`, `npm run dev`, test independently
- Changes in one worktree don't affect another

### 4. Review and merge

When an agent finishes, review the changes:

```bash
# List all worktrees
git worktree list

# Check what changed in a specific worktree
cd .claude/worktrees/hidden-files
git diff main..HEAD
git log --oneline main..HEAD

# If happy, push and create PR
git push -u origin feat/hidden-files
gh pr create --title "feat: Show hidden files in explorer" --body "Implements Plan 1"
```

### 5. Merge order (recommended)

Since these plans don't touch the same files, merge order is flexible. Suggested:

1. **Plan 1: Hidden Files** — Backend-only, no frontend conflicts
2. **Plan 4: Search Highlight** — Small, isolated
3. **Plan 5: Git Diff** — Isolated to SourceControlPanel
4. **Plan 2: Editor Rich Text** — Larger change, Editor.jsx
5. **Plan 3: Claude Integration** — Touches App.jsx + WorkspaceContext
6. **Plan 6: Landing Page** — Completely independent, merge anytime

### 6. Clean up worktrees

After merging:

```bash
# Remove a specific worktree
git worktree remove .claude/worktrees/hidden-files

# Or remove all at once
git worktree list --porcelain | grep 'worktree' | grep '.claude/worktrees' | while read _ path; do
  git worktree remove "$path" --force
done

# Prune stale worktree references
git worktree prune
```

## Using Claude Code's Built-in Worktree Support

If you're using Claude Code (the CLI tool), you can also use the built-in worktree feature:

```bash
# In Claude Code, say:
> start a worktree for the hidden files plan

# Claude Code will:
# 1. Create a worktree in .claude/worktrees/<name>
# 2. Switch the session to work inside it
# 3. On exit, prompt you to keep or remove the worktree
```

Or use the `isolation: "worktree"` parameter when spawning agents programmatically — each agent gets its own worktree automatically.

## Key Benefits

| Without Worktrees | With Worktrees |
|---|---|
| One branch at a time | All branches checked out simultaneously |
| Must stash/commit before switching | Each plan has its own working directory |
| Agents can't run in parallel | 6 agents working simultaneously |
| Merge conflicts during development | Conflicts only at merge time |
| Shared node_modules | Each worktree can have its own node_modules |

## Gotchas

- **node_modules**: Each worktree needs its own `npm install`. They don't share `node_modules/`.
- **Ports**: If running `npm run dev` in multiple worktrees, each needs a different port (Vite auto-increments).
- **Disk space**: Each worktree is a full checkout. For a project this size (~50MB), 6 worktrees ≈ 300MB. Trivial.
- **Branch naming**: Can't have two worktrees on the same branch. Use unique branch names per plan.
