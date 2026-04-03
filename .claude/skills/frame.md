---
name: frame
description: >
  This skill should be used when the user asks to "read a frame", "create a frame",
  "update annotations", "add file context", "check file metadata", or mentions FRAME,
  .quipu/meta, or per-file AI context. It teaches how to work with FRAME (Feedback-Referenced
  Active Modification Envelope) sidecar JSON files that store annotations, AI instructions,
  and conversation history for each source file.
triggers:
  - frame
  - FRAME
  - file annotations
  - file context
  - .quipu/meta
  - per-file metadata
  - sidecar
---

# FRAME (Feedback-Referenced Active Modification Envelope)

Use this skill when reading, creating, or updating FRAME metadata files for source files in the workspace.

## What is a FRAME?

A FRAME is a JSON sidecar file that stores per-file metadata:
- **Annotations**: Line-level notes (review comments, TODOs, bugs, questions)
- **Instructions**: Persistent AI context about what the file does and how to handle it
- **History**: Log of past AI interactions about this file (capped at 20 entries)

## File Location

FRAME files mirror the workspace folder structure under `.quipu/meta/`:

```
workspace/
  src/
    components/
      Editor.jsx          # Source file
  .quipu/
    meta/
      src/
        components/
          Editor.jsx.frame.json   # Its FRAME sidecar
```

**Path formula**: `{workspacePath}/.quipu/meta/{relativePath}.frame.json`

## JSON Schema (v1)

```json
{
  "version": 1,
  "type": "frame",
  "id": "uuid-v4",
  "filePath": "src/components/Editor.jsx",
  "createdAt": "2026-03-01T12:00:00Z",
  "updatedAt": "2026-03-01T14:30:00Z",
  "annotations": [
    {
      "id": "uuid-v4",
      "line": 42,
      "text": "Refactor this to use useCallback",
      "type": "review",
      "author": "user",
      "timestamp": "2026-03-01T12:00:00Z"
    }
  ],
  "instructions": "This file handles the TipTap editor setup. Always preserve the comment mark extension when modifying.",
  "history": [
    {
      "id": "uuid-v4",
      "prompt": "Review this file for performance issues",
      "summary": "Found unnecessary re-renders in useEffect...",
      "timestamp": "2026-03-01T13:00:00Z"
    }
  ]
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `version` | number | Always `1` for now |
| `type` | string | Always `"frame"` |
| `id` | string | UUID v4 for this FRAME |
| `filePath` | string | Relative path from workspace root |
| `annotations[].type` | string | One of: `comment`, `review`, `todo`, `bug`, `question`, `instruction` |
| `annotations[].author` | string | `"user"` or `"ai"` |
| `history[]` | array | Capped at 20 entries (FIFO eviction). Store summaries, not full responses. |
| `instructions` | string | Persistent context Claude should know about this file |

## How to Read a FRAME

To check if a file has a FRAME, compute the path and read it:

```bash
# Given a file path, compute the FRAME path
FILE="src/components/Editor.jsx"
FRAME_PATH=".quipu/meta/${FILE}.frame.json"

# Read it (returns the JSON or fails if not found)
cat "$FRAME_PATH" 2>/dev/null
```

Or use the Read tool directly on the computed path.

## How to Create/Update a FRAME

1. Read the existing FRAME (or start with an empty one)
2. Modify the annotations, instructions, or history
3. Update `updatedAt` to current ISO 8601 timestamp
4. Ensure `history` has at most 20 entries (remove oldest if over)
5. Write the JSON back to the FRAME path
6. Create intermediate directories if they don't exist (`mkdir -p`)

## Annotation Type Behaviors

When processing annotations, the agent should interpret each type differently:

| Type | Behavior | When to use |
|------|----------|-------------|
| `comment` | Informational note. Read and acknowledge but no action required unless the content is imperative. | Default type. General observations, thoughts, context notes. |
| `review` | Mixed feedback — may contain suggestions, critiques, or praise. Evaluate each point and propose improvements where the author identifies weaknesses. | Code review comments, design feedback, editorial suggestions. |
| `todo` | Actionable task. The agent should attempt to complete the described work. | Concrete work items: "add error handling here", "extract this to a function". |
| `bug` | Reported defect. The agent should investigate, confirm the bug, and propose or implement a fix. | "This crashes when input is null", "off-by-one error in loop". |
| `question` | The author needs clarification. The agent should answer the question, referencing code context. Do not modify code unless the answer implies a fix. | "Why does this use setTimeout?", "Is this O(n²)?". |
| `instruction` | Persistent directive the agent must follow when modifying this file. Unlike `todo`, instructions are ongoing constraints, not one-time tasks. | "Always validate auth before DB queries", "Keep this file under 200 lines". |

**Processing priority**: `bug` > `todo` > `instruction` > `review` > `question` > `comment`

When a file has multiple annotations, process higher-priority types first. Instructions should be treated as constraints that apply to all other work on the file.

## Rules

1. **Always use relative paths** in `filePath` (relative to workspace root)
2. **All timestamps** must be ISO 8601 UTC (e.g., `2026-03-01T12:00:00Z`)
3. **History cap**: Maximum 20 entries. When adding a new entry that would exceed 20, remove the oldest.
4. **Annotations use line numbers** as approximate anchors. They may become stale after edits — re-resolve by searching for nearby content.
5. **Never store full AI responses** in history. Use `summary` (1-3 sentences).
6. **Create directories** before writing: `mkdir -p .quipu/meta/path/to/`
7. **FRAME files are gitignored** — they contain per-developer context and should not be committed.

## When a FRAME is Auto-Loaded

A PostToolUse hook on the `Read` tool automatically checks for a FRAME when you read a file. If one exists, its contents are appended to your context. You do not need to manually load FRAMEs — they are injected automatically.

## Service Layer (for UI integration)

The `src/services/frameService.js` module provides programmatic access:

```javascript
import frameService from './services/frameService.js';

// Read
const frame = await frameService.readFrame(workspacePath, filePath);

// Create (idempotent — returns existing if present)
const frame = await frameService.createFrame(workspacePath, filePath);

// Add annotation
await frameService.addAnnotation(workspacePath, filePath, {
  line: 42, text: 'Needs refactor', type: 'review', author: 'user'
});

// Add history entry
await frameService.addHistoryEntry(workspacePath, filePath, {
  prompt: 'Review for bugs', summary: 'Found null check missing on line 55'
});

// Update instructions
await frameService.updateInstructions(workspacePath, filePath,
  'This file handles auth. Always validate tokens before proceeding.'
);
```
