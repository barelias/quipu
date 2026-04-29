---
title: feat: Agents panel — recency sort and ISO date column
type: feat
status: active
date: 2026-04-29
---

# feat: Agents panel — recency sort and ISO date column

## Overview

Re-order rows inside the Agents panel so chats and agents within each folder (and within the uncategorized list) are sorted by `updatedAt` descending — most recent first. Show that timestamp as an ISO `yyyy-mm-dd` date on the right edge of each row, replacing the existing binding-count badge. The badge's count moves into the row's `title` tooltip so the information stays available without crowding the row.

This is a small, self-contained change to one component (`src/components/ui/AgentsPanel.tsx`), one row sub-component (`AgentRow` inside the same file), and one new unit test. The `Agent` type, `AgentContext` (including its existing `updatedAt` maintenance), and the storage layer are not touched — the field already exists and is already maintained on every relevant mutation.

## Problem Frame

The Agents panel currently sorts items alphabetically by name within each folder. As a user accumulates chats and agents, the list stops reflecting what they're actually working on — recently-touched items can be buried mid-list, and the user has no visual signal of when a row was last modified. They want the same affordance most chat clients give: most-recently-used floats to the top, with a date stamp visible on each row.

## Requirements Trace

- **R1.** Within each folder list and the uncategorized list, agents and chats are ordered by their `updatedAt` field, most recent first.
- **R2.** Each row in the Agents panel shows the `updatedAt` date as an ISO `yyyy-mm-dd` string on the right edge.
- **R3.** Folder ordering itself is unchanged — folders remain alphabetical.
- **R4.** The two `kind` sections (Chats, Agents) keep their current section ordering and counts.
- **R5.** The behavior is deterministic: items sharing the same `updatedAt` value resolve to a stable order (by name).

## Scope Boundaries

**In scope:**
- Sort order changes inside `AgentsPanel.tsx`'s `sections` memo.
- Visual change to `AgentRow`: replace binding-count badge with an ISO date label, move count into the row's tooltip.
- One new test file covering sort order and the date label.

**Out of scope (explicit non-goals):**
- Bumping `agent.updatedAt` on each new message. Sending messages today does not modify `agent.updatedAt` (it modifies `session.updatedAt`); the user explicitly chose to keep that behavior. A chat that has been chatted-into will not float back to the top until something else mutates the agent record (rename, model change, folder move, edit-and-save in the agent editor, or the auto-rename that happens on the first-ever message). Consequence: a chat with an active turn will show the running indicator (the pulsing accent dot in `AgentRow`) but its row position is stable until the agent record itself is modified — visual activity is decoupled from sort order on purpose.
- Sorting folders themselves by recency. Folders stay alphabetical.
- Re-ordering the two top-level kind sections (`Chats`, `Agents`).
- Adding a relative-time label ("3h ago"), tooltips on the date itself, or any time-of-day component.
- Persisting the user's sort preference. There is no toggle — recency is the only order.
- Changes to `AgentContext`, persistence, or any other panel.

## Context & Research

### Relevant Code and Patterns

- `src/components/ui/AgentsPanel.tsx` — the only component changing. The `sections` memo (lines 50–76) builds `{ folder, items }` groups and sorts items via `a.name.localeCompare(b.name)` at lines 64 and 69. `AgentRow` (lines 459–505) renders the right-edge binding count via `{bindingCount > 0 && (<span>...{bindingCount}</span>)}` at lines 478–485.
- `src/types/agent.ts` — `Agent.updatedAt: string` (ISO timestamp) is already part of the model and is maintained by `AgentContext`. No type changes needed.
- `src/context/AgentContext.tsx` — confirms `updatedAt` is set on creation (`createChat`, line 527), folder/kind moves (`moveAgent`, line 480), folder rename (line 511) and delete (line 500), the auto-rename on first message (line 866), and from the agent editor and chat-view model picker (`AgentEditorView.tsx:93`, `ChatView.tsx:496`). This confirms the field is reliably present and non-null on every persisted agent.
- The repo has no shared "format ISO date" utility. Existing usages of timestamps either format inline (`toLocaleString`) or pass full ISO strings through. We can slice the first 10 characters of the ISO string — `agent.updatedAt.slice(0, 10)` — which is correct for any well-formed ISO 8601 timestamp.
- Tailwind tokens already in use elsewhere in the row: `text-text-tertiary`, `text-[10px]`, `tabular-nums` is not currently used but is the right utility for fixed-width digit alignment in a date column. The project uses Tailwind v4 (`src/styles/theme.css`), and `tabular-nums` is part of core Tailwind utilities.

### Institutional Learnings

- Reviewed `docs/solutions/`. No prior learnings touch sort order, recency display, or the Agents panel directly. Closest neighbors are general UI-pattern notes that don't constrain this change.

### External References

- None needed. Sort comparator + `String.slice(0, 10)` on an ISO timestamp covers everything.

## Key Technical Decisions

- **Sort key is `agent.updatedAt` only.** Chosen by the user. Keeps the sort stable, avoids extra storage writes per message, and treats the agent record as the canonical "modified" surface. Documented in Scope Boundaries as the explicit non-goal "do not bump on each message".
- **Tie-breaker is name ascending.** Two items with identical `updatedAt` strings (rare — same-millisecond creates) need a deterministic order so the list does not flicker on re-renders. `localeCompare` matches the previous sort behavior, so when `updatedAt` ties, ordering reverts to today's behavior.
- **Sort comparator uses string comparison on ISO strings; the visible date uses local-timezone formatting.** Two different concerns:
  - For sorting, we compare the raw persisted strings — `new Date().toISOString()` always emits a `Z`-suffixed, fixed-width string, so lexicographic order matches chronological order. No `Date` objects per comparison.
  - For display, we format in the user's **local** timezone via `new Date(agent.updatedAt).toLocaleDateString('sv-SE')`. The Swedish locale produces `yyyy-mm-dd` natively. A naive `slice(0, 10)` on the ISO string would show the UTC date, so a row touched at 9pm in UTC-8 would display tomorrow's date — wrong from the user's perspective. Local-formatted display fixes this without affecting sort order (the sort is always strictly chronological regardless of timezone).
- **Date column replaces the binding-count badge.** The badge was the only thing on the right edge today, and putting two small numbers there makes the row noisy. The count is preserved on an accessible affordance — see Unit 2 — rather than relegated to the `title` tooltip alone.
- **ISO `yyyy-mm-dd` chosen over relative time / today-suppression / hover-only date.** User decision. Rationale: (a) fixed-width 10-character column scans cleanly down a list of rows (`tabular-nums`), (b) absolute dates don't drift in meaning the way "3 days ago" does when the panel is left open, (c) a uniform column makes the sort order legible at a glance — the date next to each row is the same field that ordered the list. Today-suppression and hover-only variants were considered and rejected for inconsistency.
- **Folder-level sort stays alphabetical.** The user chose to keep folders alphabetical, so the `folderList` `localeCompare` sort at line 58 is unchanged.
- **Accessibility: render the date as a semantic `<time>` element with a stronger-contrast token, and surface the binding count on an accessible affordance.** The original plan reused `text-text-tertiary` and `title`; neither is sufficient for an always-rendered piece of metadata. See Unit 2 for the specific changes.

## Open Questions

### Resolved During Planning

- **Should sending a message bump the agent to the top?** No. User chose `agent.updatedAt`-only.
- **Should folders re-order by latest contained item?** No. Folders stay alphabetical.
- **What replaces the binding count on the row?** The date occupies the right edge. The count moves to a small visible chip between the running indicator and the date — keyboard- and touch-discoverable, with an `aria-label` for screen readers.
- **Date format?** ISO `yyyy-mm-dd`, formatted in the user's local timezone via `toLocaleDateString('sv-SE')`. Not derived from `slice(0, 10)` (which would show UTC).
- **Today / repeated-date / hover-relative variants?** Considered and rejected — uniform absolute dates scan more cleanly down a list, don't drift in meaning, and match the user's chosen aesthetic.
- **Accessibility surface?** Render via semantic `<time dateTime={...}>`; verify the contrast token before merging; replace `title` with a focus-discoverable count chip.

### Deferred to Implementation

- The exact contrast-passing token for the date label. Plan starts at `text-text-secondary` and bumps to `text-text-primary` if WCAG AA fails — pick during implementation against the actual rendered theme.

## Implementation Units

- [ ] **Unit 1: Sort items by `updatedAt` desc within each list**

**Goal:** Replace the alphabetical item sort inside `sections` with `updatedAt`-descending, name-ascending tie-breaker. Folders themselves remain alphabetical.

**Requirements:** R1, R3, R5

**Dependencies:** None

**Files:**
- Modify: `src/components/ui/AgentsPanel.tsx`

**Approach:**
- Define a tiny comparator inside the `sections` memo:
  - Primary: `(b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')` (descending; `localeCompare` works fine on ISO strings). The `?? ''` guard hardens against any pre-MVP persisted record that might be missing the field — `AgentContext`'s load normalizer (lines 393–399) defaults `kind`, `bindings`, `permissionMode`, and `allowedTools` but does NOT default `updatedAt`/`createdAt`, so a defensive guard is cheap insurance.
  - Secondary (tie): `a.name.localeCompare(b.name)`.
- Replace the two `.sort((a, b) => a.name.localeCompare(b.name))` calls (the per-folder `items` sort at line 64 and the `uncategorized` sort at line 69) with the new comparator. Leave the `folderList` sort at line 58 unchanged.
- The memo's dep array (`[agents, folders]`) is already correct — `agents` updates on every `updatedAt` change because the array reference changes when `setAgents(prev.map(...))` runs.

**Patterns to follow:**
- Existing memo structure and immutable `.slice().sort(...)` pattern used in the file.

**Test scenarios:**
- Happy path: three chats in the same folder with `updatedAt = 2026-04-27`, `2026-04-29`, `2026-04-28` render in order `[2026-04-29, 2026-04-28, 2026-04-27]`.
- Happy path: items in two different folders sort independently inside each folder; folder order itself stays alphabetical.
- Edge case: two items with identical `updatedAt` strings render in name-ascending order (`"alpha"` before `"beta"`).
- Edge case: empty `agents` array renders no rows and does not throw.
- Edge case: an agent whose `updatedAt` is later than another in the uncategorized list sorts above it (uncategorized list also obeys recency).

**Verification:**
- Mounting `AgentsPanel` with a fixture of agents whose `updatedAt` values are out of order produces DOM rows in the expected order.
- `npx tsc --noEmit` passes.

- [ ] **Unit 2: Render ISO `yyyy-mm-dd` on the right edge of each row**

**Goal:** Replace the binding-count badge in `AgentRow` with a date label sourced from `agent.updatedAt`. Preserve the binding count by moving it into the row's tooltip.

**Requirements:** R2, R4

**Dependencies:** Unit 1 (not strictly required, but landing them together keeps the visual change consistent with the new order).

**Files:**
- Modify: `src/components/ui/AgentsPanel.tsx`

**Approach:**
- Inside `AgentRow` (currently lines 459–505):
  - Compute the displayed date in the **user's local timezone** once per render: `const date = new Date(agent.updatedAt).toLocaleDateString('sv-SE');`. The Swedish locale yields `yyyy-mm-dd`. Do NOT use `agent.updatedAt.slice(0, 10)` — that returns the UTC date, which can be off by one day for users east/west of UTC.
  - Render the date as a semantic `<time>` element so screen readers and assistive tools can interpret it correctly: `<time dateTime={agent.updatedAt} className="ml-auto text-[10px] text-text-secondary shrink-0 tabular-nums">{date}</time>`. Note `text-text-secondary` rather than `text-text-tertiary` — this is now a permanent piece of metadata on every row, not a sparse signal, so it earns a contrast token closer to the row's primary text. Verify the chosen token meets WCAG AA contrast against `bg-bg-surface` and `bg-bg-elevated` (the row-hover background) before merging; bump to `text-text-primary` if it doesn't.
  - The `<time>`'s `dateTime` attribute carries the full ISO timestamp for assistive tech and for power users who inspect the DOM. Do not rely on `title` for that information.
  - Move the binding count to a small visible chip that renders only when `bindingCount > 0`, sitting between the running dot and the date. Use a token-driven pill: `<span className="text-[10px] text-text-tertiary shrink-0 px-1 rounded bg-bg-elevated" aria-label={`${bindingCount} context binding${bindingCount === 1 ? '' : 's'}`}>{bindingCount}</span>`. The chip is keyboard- and touch-discoverable; the `aria-label` gives screen readers the long form.
  - Drop the row button's `title={agent.name}` (the visible name plus the truncate-on-overflow ellipsis is sufficient — `title` was redundant for sighted users and `title` cannot replace proper a11y semantics).
- Preserve everything else in `AgentRow` exactly: drag handle, running indicator, edit button, more-actions button.

**Technical design:** *(directional, not implementation specification)*

```
[icon] [name (truncate)] [running dot?]    [count chip?] [yyyy-mm-dd]   [edit]  [more]
                                  ml-auto on the count chip pushes everything right;
                                  the date follows it with a fixed-width tabular column.
```

DOM order inside the row's main `<button>`: `icon -> name span -> running dot (when active) -> binding-count chip (when > 0) -> <time>`. The `ml-auto` lives on the **first right-aligned element** (chip when present, else `<time>`); the running dot stays inline immediately after the name so it visually anchors to the row identity, not to the date. This avoids the "is the dot labelling the date column?" ambiguity flagged in review.

**Patterns to follow:**
- Reuse the existing right-edge span layout (`ml-auto text-[10px] text-text-tertiary shrink-0`) — same tokens used by the previous binding count.
- Tooltip composition follows the existing `title="…"` convention used elsewhere in the panel (e.g. the section header buttons at lines 365, 373).

**Test scenarios:**
- Happy path: an agent with `updatedAt: '2026-04-29T10:14:33.987Z'` renders a row containing a `<time>` element whose visible text matches `new Date('2026-04-29T10:14:33.987Z').toLocaleDateString('sv-SE')` (use the same call in the test so it stays correct under the test environment's timezone).
- Happy path: the rendered `<time>` element has `dateTime="2026-04-29T10:14:33.987Z"` (the full ISO string) as an attribute.
- Happy path: an agent with `bindings: [b1, b2]` renders a count chip with text `2` and `aria-label="2 context bindings"`. An agent with `bindings: [b1]` renders a chip with text `1` and `aria-label="1 context binding"` (singular).
- Happy path: an agent with `bindings: []` renders no count chip.
- Happy path: a chat (`kind: 'chat'`) and an agent (`kind: 'agent'`) both render the same `<time>` column on the right edge.
- Edge case: timezone awareness — a fixture with `updatedAt: '2026-04-30T03:00:00.000Z'` rendered in a `process.env.TZ='America/Los_Angeles'` (UTC-7) test environment shows `2026-04-29`, NOT `2026-04-30`. Without this test, a `slice(0, 10)` regression would silently pass.
- Edge case: the running indicator, count chip, and `<time>` all render together when `isTurnActive(agent.id)` is true and `bindings.length > 0` — assert DOM order is `name -> running dot -> chip -> time`.

**Verification:**
- Visual: open the Agents panel in a workspace with several agents and chats; each row shows a `yyyy-mm-dd` on the right edge in the user's local timezone.
- Visual: rows with bindings show a small count chip between the running indicator and the date; tabbing through the panel reaches the chip and a screen reader announces the long form ("2 context bindings").
- Inspect: each date is wrapped in a `<time dateTime="...">` element whose `dateTime` attribute matches the persisted ISO string.
- Contrast: spot-check the date's foreground/background combination in both light and dark themes against `bg-bg-surface` and `bg-bg-elevated`; bump the token if it fails WCAG AA.
- `npx tsc --noEmit` passes; no Tailwind classes regress.

- [ ] **Unit 3: Test coverage for sort order and date rendering**

**Goal:** Add a focused test file that verifies the new sort order and the date column. The component currently has no test, so we create one rather than extend an existing file.

**Requirements:** R1, R2, R3, R5

**Dependencies:** Units 1 and 2

**Files:**
- Create: `src/__tests__/AgentsPanel.test.tsx`

**Approach:**
- Mock the contexts `AgentsPanel` consumes at the module level (mirroring `AgentContext.drafts.test.tsx`'s `vi.mock('...')` pattern, not provider wrapping). The drafts test only mocks `useTab` enough to satisfy `AgentProvider` — for `AgentsPanel`, the mock surface is larger and must include:
  - `useTab()`: `openAgentTab: vi.fn()`, `openAgentEditorTab: vi.fn()`, `renameTabsByPath: vi.fn()` (and any other field the panel reads — verify against current `TabContext`).
  - `useAgent()`: `agents`, `folders`, `createChat`, `deleteAgent`, `moveAgent`, `createFolder`, `deleteFolder`, `renameFolder`, `isTurnActive` — the exact set destructured at lines 35–40 of `AgentsPanel.tsx`.
  - `useToast()`: `showToast: vi.fn()`.
- Build fixture agents with explicit `updatedAt` values across three buckets:
  1. Two chats in folder `"work"` with mixed dates.
  2. Two agents in folder `"work"` with mixed dates.
  3. One uncategorized chat and one uncategorized agent.
- Query rendered DOM order carefully — each `AgentRow` renders three buttons (the row button with `title={...}`, an Edit button with `aria-label={`Edit ${agent.name}`}`, a More-actions button). A loose `getAllByRole('button', { name: /<agent-name>/ })` will match both the row and the Edit button for the same agent, breaking order assertions. Use one of:
  - `within(rowEl).getByText(agent.name)` after locating each row by `data-testid` or by walking the DOM (e.g. parent of an icon),
  - or query rows by their accessible name (the row button uses `title`, not `aria-label`, so a `name`-regex query may need to be paired with `getByTitle` to disambiguate from the Edit button's `aria-label`).
- Assert:
  - The order of rows within each folder list matches expected recency order.
  - The order within the uncategorized list matches expected recency order.
  - Each row contains the expected `yyyy-mm-dd` substring.
  - Folders sort alphabetically regardless of their items' dates.
  - Two agents with identical `updatedAt` render in name-ascending order.

**Patterns to follow:**
- `src/__tests__/AgentContext.drafts.test.tsx` for context-wrapping setup and Vitest + React Testing Library style.
- `src/__tests__/AgentContext.test.tsx` for fixture-agent shape (`bindings: []`, `permissionMode: 'default'`, etc.).

**Test scenarios:**
- Happy path: rows inside folder `"work"` (chats) appear in `updatedAt` desc order.
- Happy path: rows inside folder `"work"` (agents) appear in `updatedAt` desc order, independently of the chats list.
- Happy path: rows in the uncategorized list (both kinds) appear in `updatedAt` desc order.
- Happy path: each rendered row's text content includes `agent.updatedAt.slice(0, 10)`.
- Edge case: identical `updatedAt` resolves to name-ascending order.
- Edge case: folders themselves render in alphabetical order even when one folder contains the most-recent item.

**Verification:**
- `npm run test:run -- AgentsPanel` (or equivalent vitest filter) passes.
- `npx tsc --noEmit` passes.

## System-Wide Impact

- **Interaction graph:** Self-contained. The change touches one component and reads existing context state. No callbacks, observers, or middleware are affected. The `sections` memo recomputes on every `agents`/`folders` update, which is unchanged from today.
- **Error propagation:** No new failure modes. `updatedAt.slice(0, 10)` is safe given the type system guarantees `string` and the persisted shape is always `new Date().toISOString()`.
- **State lifecycle risks:** None. We don't mutate persistence, don't add storage keys, don't change the workspace-scope barrier in `AgentContext` (`loadedWorkspaceRef`), and don't touch the session/turn lifecycle.
- **API surface parity:** None — this is internal UI only. No exported types, hooks, or services change.
- **Integration coverage:** The new test exercises the sort comparator and the date label together by rendering the component, which is the only meaningful integration surface.
- **Unchanged invariants:** `Agent` type stays as-is. `agent.updatedAt` semantics stay as-is — sending a message still does NOT bump it, and that is intentional (the auto-rename on the first message bumps it once via existing logic at `AgentContext.tsx:866`). The Chat side panel, agent editor, and persistence layer are not touched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| User expects sending a message to float a chat back to the top, but it doesn't (because we sort by `agent.updatedAt`, not session activity). | Documented as an explicit non-goal in Scope Boundaries. The auto-rename on the first message of a "New chat" already bumps `updatedAt`, so the very first send still moves it. Subsequent sends don't reorder — that matches the user's chosen semantics. |
| Same-millisecond ties produce nondeterministic order on re-render. | Tie-breaker on `name.localeCompare` makes the order deterministic even when `updatedAt` strings are identical. |
| `AgentRow` truncation collides with the date column on narrow widths. | The date is fixed-width (`yyyy-mm-dd` is always 10 characters, `tabular-nums` ensures consistent glyph width). The name `<span>` already has `truncate`; it will continue to ellipsize before the date encroaches. Note: the date column is now permanent on every row (the previous binding-count badge was conditional on `bindingCount > 0`), so names that previously fit on rows without bindings will now have less horizontal space available. This is intentional — uniform right-edge metadata is the design — but worth noting visually. |
| Visual regression — readers used to seeing the binding count on a row will lose that signal. | Count is preserved as a small visible chip rendered only when `bindingCount > 0`, sitting between the running indicator and the date. It remains visually discoverable on every relevant row and announces accessibly via `aria-label`. |
| Date renders in UTC instead of the user's timezone if the implementer reaches for the obvious-but-wrong `slice(0, 10)`. | Approach explicitly mandates `new Date(...).toLocaleDateString('sv-SE')`. Unit 2's test scenarios include a UTC-30Apr-03:00 / TZ=America/Los_Angeles fixture that would catch a regression. |
| The date's `text-text-secondary` token may fail WCAG AA contrast in some themes. | Verification step in Unit 2 instructs bumping to `text-text-primary` if AA fails against `bg-bg-surface` and `bg-bg-elevated`. Token choice is intentionally an implementation-time decision. |
| The persisted `updatedAt` for very old agents predates this change but is well-formed ISO. | Already the case — the field has been written with `new Date().toISOString()` since the agent-manager-mvp landed. No migration needed. |

## Documentation / Operational Notes

- No docs update required — `CLAUDE.md` does not document the Agents panel's row layout. No rollout, monitoring, or migration concerns.

## Sources & References

- Origin: this skill's feature description (no upstream `docs/brainstorms/` requirements doc).
- Related code:
  - `src/components/ui/AgentsPanel.tsx` (the `sections` memo at lines 50–76 and `AgentRow` at lines 459–505)
  - `src/context/AgentContext.tsx` (where `updatedAt` is maintained: `createChat`, `moveAgent`, `renameFolder`, `deleteFolder`, `sendMessage`'s auto-rename)
  - `src/types/agent.ts` (the `Agent` type)
- Related plans:
  - `docs/plans/2026-04-23-001-feat-agent-manager-mvp-plan.md`
  - `docs/plans/2026-04-28-001-feat-workspace-scoped-agent-data-plan.md`
- Existing tests followed for patterns:
  - `src/__tests__/AgentContext.drafts.test.tsx`
  - `src/__tests__/AgentContext.test.tsx`
