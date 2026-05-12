import fs from './fileSystem';

// Template content for FRAME skill
const FRAME_SKILL = `---
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

FRAME files mirror the workspace folder structure under \`.quipu/meta/\`:

\`\`\`
workspace/
  src/
    components/
      Editor.jsx          # Source file
  .quipu/
    meta/
      src/
        components/
          Editor.jsx.frame.json   # Its FRAME sidecar
\`\`\`

**Path formula**: \`{workspacePath}/.quipu/meta/{relativePath}.frame.json\`

## JSON Schema (v1) — canonical

\`\`\`json
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
      "selectedText": "const handleClick = () => { ... }",
      "timestamp": "2026-03-01T12:00:00Z",
      "responses": [
        {
          "id": "uuid-v4",
          "author": "assistant",
          "body": "Agreed. Wrapping in useCallback with [] deps since there are no closures over props.",
          "createdAt": "2026-03-01T14:30:00Z"
        }
      ]
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
\`\`\`

### Field Reference

| Field | Type | Description |
|---|---|---|
| \`version\` | number | Always \`1\` for now |
| \`type\` | string | Always \`"frame"\` |
| \`id\` | string | UUID v4 for this FRAME |
| \`filePath\` | string | Relative path from workspace root |
| \`annotations[].type\` | string | One of: \`comment\`, \`review\`, \`todo\`, \`bug\`, \`question\`, \`instruction\` |
| \`annotations[].author\` | string | \`"user"\` or \`"assistant"\` |
| \`annotations[].text\` | string | The comment body (note: comments use \`text\`, responses use \`body\`) |
| \`annotations[].timestamp\` | string | ISO 8601 UTC |
| \`annotations[].responses[]\` | array | **Threaded replies** — see rules below |
| \`annotations[].responses[].body\` | string | Reply body (**\`body\`, not \`text\`**) |
| \`annotations[].responses[].createdAt\` | string | ISO 8601 UTC (**\`createdAt\`, not \`timestamp\`**) |
| \`annotations[].responses[].author\` | string | \`"user"\` or \`"assistant"\` |
| \`history[]\` | array | Capped at 20 entries (FIFO). Managed by the Quipu UI — don't write here unless asked. |
| \`instructions\` | string | Persistent context Claude should know about this file |

## Threaded replies (the \`responses\` array)

When the user asks you to **reply to a comment** in a FRAME, append to the target annotation's \`responses\` array. The schema is strict:

- The array **must** be named \`responses\` — not \`replies\`, not \`comments\`.
- Each response object has exactly these fields: \`id\`, \`author\`, \`body\`, \`createdAt\`.
  - \`body\` (not \`text\`, not \`content\`)
  - \`createdAt\` (not \`timestamp\`, not \`date\`)
  - \`author\`: use \`"assistant"\` when you write a reply
  - \`id\`: a fresh UUID v4
- Preserve every existing annotation and response. **Append only** — never reorder, modify, or remove existing entries unless the user explicitly asks.
- Do not touch the top-level \`history\` array when adding a reply. The Quipu UI manages history separately.

### Worked example

Input frame (one user question, no replies yet):

\`\`\`json
{ "version": 1, "type": "frame", "id": "...", "filePath": "notes.md",
  "createdAt": "...", "updatedAt": "...",
  "annotations": [
    { "id": "a1", "line": 3, "text": "What's the time complexity?",
      "type": "question", "author": "user", "timestamp": "..." }
  ],
  "instructions": "", "history": [] }
\`\`\`

After you reply to annotation \`a1\`:

\`\`\`json
{ "version": 1, "type": "frame", "id": "...", "filePath": "notes.md",
  "createdAt": "...", "updatedAt": "<now>",
  "annotations": [
    { "id": "a1", "line": 3, "text": "What's the time complexity?",
      "type": "question", "author": "user", "timestamp": "...",
      "responses": [
        { "id": "r1", "author": "assistant",
          "body": "O(n log n) — the sort dominates the loop.",
          "createdAt": "<now>" }
      ]
    }
  ],
  "instructions": "", "history": [] }
\`\`\`

Note: only \`updatedAt\` and the new response changed.

## How to Read a FRAME

To check if a file has a FRAME, compute the path and read it:

\`\`\`bash
# Given a file path, compute the FRAME path
FILE="src/components/Editor.jsx"
FRAME_PATH=".quipu/meta/\${FILE}.frame.json"

# Read it (returns the JSON or fails if not found)
cat "$FRAME_PATH" 2>/dev/null
\`\`\`

Or use the Read tool directly on the computed path.

## How to Create/Update a FRAME

1. Read the existing FRAME (or start with an empty one)
2. Modify the annotations, instructions, or history
3. Update \`updatedAt\` to current ISO 8601 timestamp
4. Ensure \`history\` has at most 20 entries (remove oldest if over)
5. Write the JSON back to the FRAME path
6. Create intermediate directories if they don't exist (\`mkdir -p\`)

## Rules

1. **Always use relative paths** in \`filePath\` (relative to workspace root)
2. **All timestamps** must be ISO 8601 UTC (e.g., \`2026-03-01T12:00:00Z\`)
3. **History cap**: Maximum 20 entries. When adding a new entry that would exceed 20, remove the oldest.
4. **Annotations use line numbers** as approximate anchors. They may become stale after edits — re-resolve by searching for nearby content.
5. **Never store full AI responses** in history. Use \`summary\` (1-3 sentences).
6. **Create directories** before writing: \`mkdir -p .quipu/meta/path/to/\`
7. **FRAME files are gitignored** — they contain per-developer context and should not be committed.

## When a FRAME is Auto-Loaded

A PostToolUse hook on the \`Read\` tool automatically checks for a FRAME when you read a file. If one exists, its contents are appended to your context. You do not need to manually load FRAMEs — they are injected automatically.

## Service Layer (for UI integration)

The \`src/services/frameService.js\` module provides programmatic access:

\`\`\`javascript
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
\`\`\`
`;

// Template content for FRAME command
const FRAME_COMMAND = `---
description: Read, create, or update the FRAME (per-file AI context) for a source file
argument-hint: [filepath]
allowed-tools: Read, Write, Bash(mkdir *), Bash(cat *)
---

# FRAME Command

Work with the FRAME (Feedback-Referenced Active Modification Envelope) for the specified file.

## Target File

\`$ARGUMENTS\`

If no file path is provided, use the most recently read or discussed file in this conversation.

## Instructions

1. **Compute the FRAME path**: \`.quipu/meta/{relative-file-path}.frame.json\`
2. **Read the FRAME** if it exists (use the Read tool on the computed path)
3. **If no FRAME exists**, create one with this template:

\`\`\`json
{
  "version": 1,
  "type": "frame",
  "id": "<generate-uuid>",
  "filePath": "<relative-path>",
  "createdAt": "<now-iso8601>",
  "updatedAt": "<now-iso8601>",
  "annotations": [],
  "instructions": "",
  "history": []
}
\`\`\`

4. **Display the FRAME** contents to the user in a readable format
5. **Ask what to update**: annotations, instructions, or just review

## Creating directories

Before writing a new FRAME, ensure the parent directory exists:

\`\`\`bash
mkdir -p .quipu/meta/path/to/directory/
\`\`\`

## Rules

- Use the \`frame\` skill for schema details and field reference
- All timestamps: ISO 8601 UTC
- History capped at 20 entries (remove oldest when exceeded)
- Annotations use \`type\`: comment, review, todo, bug, question, instruction
- Store summaries in history, not full responses

## Annotation Type Behaviors

| Type | Behavior |
|------|----------|
| \`comment\` | Informational note. Read and acknowledge, no action unless imperative. |
| \`review\` | Mixed feedback — evaluate each point and propose improvements. |
| \`todo\` | Actionable task. Attempt to complete the described work. |
| \`bug\` | Reported defect. Investigate, confirm, and fix. |
| \`question\` | Author needs clarification. Answer referencing code context. |
| \`instruction\` | Persistent directive to follow when modifying this file. |

**Priority**: bug > todo > instruction > review > question > comment
`;

// Template content for load-frame hook script
const LOAD_FRAME_SCRIPT = `#!/usr/bin/env bash
# PostToolUse hook for Read tool — loads FRAME sidecar if it exists.
# Receives JSON on stdin with tool_input.file_path and cwd.
# Outputs FRAME contents to stdout (appended to Claude's context).

set -euo pipefail

# Read the hook event JSON from stdin
INPUT=$(cat)

# Extract the file path that was just read
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Exit silently if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Determine workspace root (use cwd as workspace root)
WORKSPACE="$CWD"

# Compute relative path
REL_PATH="\${FILE_PATH#"$WORKSPACE"/}"

# Skip if the file is already inside .quipu/meta (avoid recursive loading)
if [[ "$REL_PATH" == .quipu/meta/* ]]; then
  exit 0
fi

# Compute FRAME path
FRAME_PATH="\${WORKSPACE}/.quipu/meta/\${REL_PATH}.frame.json"

# If FRAME exists, output its contents
if [ -f "$FRAME_PATH" ]; then
  echo ""
  echo "--- FRAME context for \${REL_PATH} ---"
  cat "$FRAME_PATH"
  echo ""
  echo "--- End FRAME ---"
fi

exit 0
`;

// --- Quipu chat rendering skills ---
//
// These skills are documentation-only (no hooks). They teach the agent
// how to emit the two fenced-block surfaces the chat upgrades into live
// React renders:
//
//   ```mdx              -> curated MDX surface (Card, Callout, Badge, …)
//   ```quipudb.jsonl    -> read-only DatabaseViewer
//
// Skill files are upserted on every workspace open — the same policy as
// `frame.md`. A header comment notes that hand edits will be overwritten.

const MDX_SKILL = `---
name: mdx
description: >
  Render rich UI in the Quipu chat by emitting a fenced \`\`\`mdx code
  block. The block is compiled through @mdx-js/mdx evaluate() and renders
  inside a sandboxed component map. Use this for cards, callouts, badges,
  stats, and side-by-side layouts — anything where markdown alone feels
  flat. For tabular data prefer \`\`\`quipudb.jsonl instead.
triggers:
  - mdx
  - rich rendering
  - chat ui
  - card
  - callout
---

<!-- Auto-managed by Quipu. Edits will be overwritten on workspace open. -->

# MDX rendering in the Quipu chat

When you need richer UI than plain markdown provides, emit a fenced
\`\`\`mdx block. The chat compiles it through @mdx-js/mdx and renders the
result with a curated component palette.

## Available components

| Component | Purpose | Props |
|-----------|---------|-------|
| \`<Card>\` | Bordered container, optional title | \`title?: string\`, \`variant?: 'default' \\| 'subtle' \\| 'accent'\` |
| \`<Callout>\` | Info / warn / error / success banner | \`type?: 'info' \\| 'warn' \\| 'error' \\| 'success'\`, \`title?\` |
| \`<Badge>\` | Pill-shaped tag | \`color?: 'accent' \\| 'muted' \\| 'success' \\| 'warning' \\| 'error' \\| 'info'\` |
| \`<Stat>\` | Big-number metric. Static \`value\` OR live from a file/dir via \`src + aggregate + where\` | \`label?\`, \`value?\`, \`hint?\`, \`src?\`, \`aggregate?: 'count' \\| 'sum' \\| 'avg' \\| 'min' \\| 'max' \\| 'first'\`, \`column?\`, \`where?\`, \`precision?\` |
| \`<Row>\` / \`<Col>\` | Horizontal layout | \`<Row gap='sm' \\| 'md' \\| 'lg'>\`, \`<Col grow={1}>\` |
| \`<LineChart>\` | Line chart (one line per series) | \`x\`, \`y: string \\| string[]\`, optional \`series\` for long data |
| \`<BarChart>\` | Bar chart, optionally stacked | \`x\`, \`y\`, optional \`series\`, \`stacked\` |
| \`<AreaChart>\` | Area chart, optionally stacked | \`x\`, \`y\`, optional \`series\`, \`stacked\` |
| \`<PieChart>\` | Pie chart | \`label\` (category column), \`value\` (numeric column) |

## Charts

Charts accept either inline \`data={[...]}\` or a workspace \`src=\` path.
Supported formats: \`.csv\`, \`.tsv\`, \`.json\` (array of objects), \`.jsonl\`,
\`.quipudb.jsonl\`. Prefer \`src\` for anything past ~20 rows — keeps the MDX
itself readable and lets the data file live alongside the conversation.

\`\`\`mdx
<LineChart src="data/experiments.csv" x="date" y="accuracy" series="model" title="Accuracy over time" />

<BarChart
  src="experiments.quipudb.jsonl"
  x="Model"
  y="Accuracy"
  series="Status"
  stacked
  title="Accuracy by model and status"
/>

<PieChart src="data/spend.csv" label="category" value="amount" title="Q1 spend by category" />
\`\`\`

\`series\` pivots long data into wide shape — one row per \`x\` value, one
line/bar/area per distinct \`series\` value. Omit \`series\` and pass an array
of \`y\` column names instead when the data is already wide.

**Column names must match the file exactly.** Read the first few lines of
the file with the Read tool before writing the chart MDX so you know what
the real column headers are. Guessing — \`x="index"\` when the CSV header
is actually \`year\` — renders an empty chart with an error message but
costs the user a round trip.

## Live stats — \`<Stat src=...>\`

\`<Stat>\` accepts the same data sources as charts. Add \`src\` + \`aggregate\`
(default \`count\`) to compute the value from a workspace file or directory
listing — no manually-maintained numbers in the MDX.

\`\`\`mdx
<Stat label="Tasks total"  src="project/Tasks.quipudb.jsonl" />
<Stat label="Tasks done"   src="project/Tasks.quipudb.jsonl" where="status=done" />
<Stat label="Average score" src="evaluations.csv" aggregate="avg" column="score" precision={1} />
<Stat label="Repositories" src="dir:./repos" where="isDirectory=true" />
<Stat label="Markdown docs" src="dir:./docs"  where="ext=.md" />
\`\`\`

\`src="dir:./<path>"\` reads the immediate children of a workspace directory
and returns rows shaped \`{ name, path, isDirectory, ext }\` — combine
with \`where\` to count only directories, only files of a given extension,
etc. The same dataset can drive a \`<PieChart>\` for visual breakdown.

\`aggregate\` options:
- \`count\` (default) — number of matching rows
- \`sum\` / \`avg\` / \`min\` / \`max\` — over the numeric \`column\`
- \`first\` — the first row's \`column\` value (useful for "most recent" if data is sorted)

\`where\` syntax: comma-separated \`column op value\` clauses combined with
AND. Supported ops: \`=\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`. Values are coerced
(\`true\`/\`false\` to boolean, numeric strings to numbers).

Markdown inside MDX renders with Quipu's chat typography — paragraphs,
headings, lists, blockquotes, inline code, links.

## Sandbox rules

- \`import\` and \`export\` statements are rejected.
- \`dangerouslySetInnerHTML\`, \`__html\`, and \`<script>\` are rejected.
- Anchor \`href\` values are scrubbed (no \`javascript:\` or \`data:\`).
- Unknown components fall back to plain text — they cannot become
  arbitrary DOM elements.

## Example

\`\`\`mdx
<Callout type="success" title="Build passed">
  All 142 tests green. Deploy is queued.
</Callout>

<Row>
  <Col>
    <Stat label="Coverage" value="87%" hint="+3% vs main" />
  </Col>
  <Col>
    <Stat label="Bundle" value="412 KB" hint="-18 KB" />
  </Col>
</Row>

<Card title="Next steps">
  - Watch the canary metrics for 30 minutes
  - Roll forward once latency stays under 200ms
</Card>
\`\`\`

## When to use this

- Comparison layouts (two stats side by side)
- Status responses (pass/fail with detail)
- Anything that benefits from visual chrome — but only when it adds
  signal over plain markdown.

For raw tabular data, prefer the \`quipudb\` skill — markdown tables and
ASCII art are illegible past three columns.

## Working with .mdx files in the workspace

The same MDX surface is available as a first-class file type. Files
ending in \`.mdx\` open in a split-pane viewer (source on the left, live
preview on the right). The component palette and security posture match
the chat block exactly.

When the user asks for a durable artifact — a dashboard, a runbook, a
status report they'll come back to — write the content to a \`.mdx\` file
with the Write tool instead of (or alongside) emitting a \`\`\`mdx fenced
block in chat. Charts in standalone \`.mdx\` files auto-refresh when the
referenced \`.csv\` / \`.tsv\` / \`.json\` / \`.jsonl\` / \`.quipudb.jsonl\` is
edited on disk — the workspace's file watcher dispatches a
\`quipu:file-changed\` window event the preview pane listens for.

Markdown notes can embed \`.mdx\` files inline:

\`\`\`
Some prose…

![[notes/q2-status.mdx]]

More prose…
\`\`\`

The editor renders the embed as a live preview card; clicking the
header opens the \`.mdx\` standalone for editing.
`;

const QUIPUDB_SKILL = `---
name: quipudb
description: >
  Render typed tabular data in the Quipu chat by emitting a fenced
  \`\`\`quipudb.jsonl code block. The chat upgrades it into a read-only
  DatabaseViewer styled to match the editor. Prefer this over markdown
  tables for any data that has more than three columns, mixes types, or
  benefits from typed cell rendering (badges, dates, checkboxes, links).
triggers:
  - quipudb
  - database render
  - tabular data
  - typed table
---

<!-- Auto-managed by Quipu. Edits will be overwritten on workspace open. -->

# quipudb.jsonl rendering in the Quipu chat

When the answer is structured data, emit a fenced \`\`\`quipudb.jsonl\`
block. The chat upgrades it into a Quipu DatabaseViewer (read-only). The
viewer types each column, shows colored badges for selects, formats
dates, and supports horizontal scroll — features markdown tables can't.

## Format

Line 1 is the schema. Subsequent lines are one row per JSON object with a
unique \`_id\`.

\`\`\`quipudb.jsonl
{"_schema":{"version":1,"name":"Open issues","columns":[{"id":"title","name":"Title","type":"text"},{"id":"priority","name":"Priority","type":"select","options":[{"value":"P0","color":"#f43f5e"},{"value":"P1","color":"#f97316"},{"value":"P2","color":"#eab308"}]},{"id":"due","name":"Due","type":"date"},{"id":"done","name":"Done","type":"checkbox"}],"views":[{"id":"v1","name":"Table","type":"table","filters":[],"sorts":[],"columnWidths":{}}]}}
{"_id":"r1","title":"Restore CI parity","priority":"P0","due":"2026-05-12","done":false}
{"_id":"r2","title":"Migrate auth middleware","priority":"P1","due":"2026-05-20","done":false}
{"_id":"r3","title":"Audit error toasts","priority":"P2","due":"2026-05-25","done":true}
\`\`\`

## Column types

| type | Cell value | Notes |
|------|-----------|-------|
| \`text\` | string | Free-form |
| \`number\` | number | Right-aligned |
| \`select\` | string | One of \`options[].value\` — rendered as colored badge |
| \`multi-select\` | string[] | Multiple option values |
| \`date\` | ISO date string | e.g. \`"2026-05-12"\` |
| \`checkbox\` | boolean | \`true\` / \`false\` |
| \`link\` | string | Path; needs schema \`mode\` (\`'global'\` or \`'relative'\`) and optional \`defaultExtension\` |

## When to use this

- More than three columns
- Mixed value types (dates, booleans, badges)
- Any "show me the list of …" response that should remain explorable

For plain prose with light decoration, prefer the \`mdx\` skill.
`;

// Hook configuration to merge into settings.json
interface FrameHookEntry {
  type: string;
  command: string;
  timeout: number;
}

interface FrameHookConfig {
  matcher: string;
  hooks: FrameHookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: Array<{
      matcher: string;
      hooks?: Array<{ command?: string }>;
    }>;
  };
  [key: string]: unknown;
}

const FRAME_HOOK: FrameHookConfig = {
  matcher: 'Read',
  hooks: [
    {
      type: 'command',
      command: 'bash .claude/scripts/load-frame.sh',
      timeout: 5,
    },
  ],
};

async function installFrameSkills(workspacePath: string): Promise<void> {
  if (!workspacePath) return;

  const claudeDir = workspacePath + '/.claude';
  const skillsDir = claudeDir + '/skills';
  const commandsDir = claudeDir + '/commands';
  const scriptsDir = claudeDir + '/scripts';

  // Create directories
  await fs.createFolder(skillsDir);
  await fs.createFolder(commandsDir);
  await fs.createFolder(scriptsDir);

  // Skills are installed as `<name>/SKILL.md` directories (the format
  // Quipu's slash-command discovery + Claude Code's "rich skill" loader
  // both look for). The previous flat `<name>.md` layout was valid for
  // Claude Code itself but invisible to Quipu's command popup.
  const skillFolders: Array<{ name: string; content: string }> = [
    { name: 'frame', content: FRAME_SKILL },
    { name: 'mdx', content: MDX_SKILL },
    { name: 'quipudb', content: QUIPUDB_SKILL },
  ];

  for (const skill of skillFolders) {
    const dir = `${skillsDir}/${skill.name}`;
    await fs.createFolder(dir);
    await fs.writeFile(`${dir}/SKILL.md`, skill.content);
    // Migrate away from the old flat layout: if `<name>.md` lives next
    // to the new folder, remove it so the slash popup doesn't show a
    // ghost entry and so Claude Code doesn't see two definitions of the
    // same skill. Best-effort — silent failure if absent.
    try {
      await fs.deletePath(`${skillsDir}/${skill.name}.md`);
    } catch {
      /* not present, nothing to clean up */
    }
  }

  // Commands + scripts stay as flat files — the commands loader reads
  // top-level .md files from `.claude/commands/` directly.
  const supportFiles = [
    { path: commandsDir + '/frame.md', content: FRAME_COMMAND },
    { path: scriptsDir + '/load-frame.sh', content: LOAD_FRAME_SCRIPT },
  ];

  for (const file of supportFiles) {
    await fs.writeFile(file.path, file.content);
  }

  // Merge settings.json (add hook if not present)
  const settingsPath = claudeDir + '/settings.json';
  let settings: ClaudeSettings = {};
  let existingContent = '';

  try {
    existingContent = await fs.readFile(settingsPath);
    settings = JSON.parse(existingContent) as ClaudeSettings;
  } catch {
    // If file exists but has invalid JSON, don't overwrite it
    if (existingContent && existingContent.trim()) {
      console.warn('Skipping settings.json merge: existing file has invalid JSON');
      return;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }

  // Check if our Read/load-frame hook already exists
  const hasReadHook = settings.hooks.PostToolUse.some(
    (entry) =>
      entry.matcher === 'Read' &&
      entry.hooks?.some((h) => h.command?.includes('load-frame.sh'))
  );

  if (!hasReadHook) {
    settings.hooks.PostToolUse.push(FRAME_HOOK);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
}

export interface ClaudeInstallerService {
  installFrameSkills: (workspacePath: string) => Promise<void>;
}

const claudeInstaller: ClaudeInstallerService = {
  installFrameSkills,
};

export default claudeInstaller;
