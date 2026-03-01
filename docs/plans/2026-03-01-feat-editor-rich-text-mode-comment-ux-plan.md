---
title: "feat: Editor Rich Text Mode, Obsidian Mode Toggle, and Comment Ctrl+Enter"
type: feat
status: active
date: 2026-03-01
---

# Editor Rich Text Mode, Obsidian Mode Toggle, and Comment Ctrl+Enter

## Overview

Four related editor improvements, all scoped to `Editor.jsx` and `prosemirror.css`:

1. **Rich text toolbar** — Show a persistent formatting toolbar (Bold, Italic, Strikethrough, Underline, Link, alignment) at the top of the document page instead of only a bubble menu on selection.
2. **Obsidian vs Rich Text config toggle** — A setting (stored in localStorage) to switch between "obsidian mode" (show raw markdown syntax like `**bold**`) and "rich text mode" (WYSIWYG with toolbar). Rich text is the default.
3. **Obsidian mode editing behavior** — When in obsidian mode, backspacing the `*` before bold text (e.g., cursor at `**text*|`) should remove the bold mark and leave plain text. Currently it just shows the syntax but doesn't let you edit it structurally.
4. **Ctrl+Enter to publish comments** — The comment textarea (lines 561-581) should submit on Ctrl+Enter.

## Problem Statement / Motivation

- The current bubble menu (lines 500-544) only appears on text selection, making formatting discovery hard for new users.
- The `RevealMarkdown` extension shows raw markdown syntax (e.g., `**` for bold) but it's purely decorative — you can't interact with it. Backspacing a `*` doesn't toggle the mark off, it just breaks the display.
- Users expect Ctrl+Enter to submit a comment (standard UX pattern), but currently you must click the "Comment" button.

## Proposed Solution

### Rich Text Toolbar (default mode)

Add a persistent toolbar above the editor content area (inside the page `div`). It shows standard formatting buttons: Bold, Italic, Strikethrough, Underline, Link, Heading levels, alignment, lists. Active states highlighted. The existing bubble menu remains for quick actions on selection.

### Obsidian Mode

When toggled on, hide the rich text toolbar and enable the `RevealMarkdown` extension (already exists). The obsidian mode should add proper backspace handling so markdown syntax characters interact with marks.

### Config Toggle

Store `editorMode` in `localStorage` (`'richtext'` | `'obsidian'`), defaulting to `'richtext'`. Read it in `Editor.jsx` on mount. Expose a toggle in the command palette (QuickOpen commands) via an action dispatched from `App.jsx > handleMenuAction`.

**Note on App.jsx**: The command palette integration requires adding a command entry in `src/data/commands.js` (not App.jsx itself). The actual mode state lives entirely in `Editor.jsx`.

## Technical Considerations

- **TipTap toolbar buttons** use `editor.chain().focus().toggleBold().run()` pattern (already used in bubble menu at lines 514-522)
- **RevealMarkdown extension** at `src/extensions/RevealMarkdown.js` already handles decoration rendering; obsidian mode just needs to enable/disable it
- **Backspace behavior** in obsidian mode requires a custom `handleKeyDown` plugin or TipTap `addKeyboardShortcuts()` that detects when cursor is adjacent to a mark boundary and removes the mark instead of deleting the character
- **prosemirror.css** needs styles for the new toolbar and active button states
- **No changes to App.jsx, WorkspaceContext.jsx, or any service file**

## System-Wide Impact

- **Editor.jsx** — Major changes: new toolbar component, mode state, conditional rendering
- **prosemirror.css** — New styles for toolbar buttons and active states
- **src/data/commands.js** — Add "Toggle Editor Mode" command (minor, data-only file)
- **No backend changes** — purely frontend

## Acceptance Criteria

- [ ] Rich text toolbar appears above editor content in rich text mode (default)
- [ ] Toolbar buttons: Bold, Italic, Strikethrough, Underline, Link, H1/H2/H3, Bullet List, Ordered List, alignment
- [ ] Active formatting highlighted on toolbar (e.g., Bold button highlighted when cursor is in bold text)
- [ ] In obsidian mode, toolbar is hidden and RevealMarkdown decorations are shown
- [ ] In obsidian mode, backspacing a leading `*` from `**text**` toggles bold off the word
- [ ] Editor mode preference persists across sessions (localStorage)
- [ ] Default mode is rich text
- [ ] Ctrl+Enter in comment textarea publishes the comment
- [ ] Escape in comment textarea cancels

## Success Metrics

- New users can discover and use formatting without needing to select text first
- Comment workflow: type → Ctrl+Enter → done

## Dependencies & Risks

- Obsidian backspace behavior is the trickiest part — requires intercepting keydown at the ProseMirror level
- Risk: RevealMarkdown decorations may need adjustments to work well alongside the structural editing

## MVP

### Editor.jsx — Ctrl+Enter on comment textarea (~line 561)

```jsx
<textarea
  value={commentText}
  onChange={(e) => setCommentText(e.target.value)}
  onKeyDown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      addComment();
    }
    if (e.key === 'Escape') {
      cancelComment();
    }
  }}
  placeholder="Type your comment..."
  autoFocus
  className="..."
/>
```

### Editor.jsx — Editor mode state

```jsx
const [editorMode, setEditorMode] = useState(() => {
  return localStorage.getItem('quipu-editor-mode') || 'richtext';
});

const toggleEditorMode = useCallback(() => {
  setEditorMode(prev => {
    const next = prev === 'richtext' ? 'obsidian' : 'richtext';
    localStorage.setItem('quipu-editor-mode', next);
    return next;
  });
}, []);
```

### Editor.jsx — Rich text toolbar (above EditorContent)

```jsx
{editorMode === 'richtext' && editor && (
  <div className="flex items-center gap-1 px-4 py-2 border-b border-page-border bg-page-bg/50">
    <ToolbarButton
      onClick={() => editor.chain().focus().toggleBold().run()}
      isActive={editor.isActive('bold')}
      title="Bold"
    >
      <TextBIcon size={16} weight="bold" />
    </ToolbarButton>
    <ToolbarButton
      onClick={() => editor.chain().focus().toggleItalic().run()}
      isActive={editor.isActive('italic')}
      title="Italic"
    >
      <TextItalicIcon size={16} />
    </ToolbarButton>
    {/* ... more buttons */}
  </div>
)}
```

### prosemirror.css — Toolbar button styles

```css
/* Toolbar button base */
.editor-toolbar-btn {
  padding: 4px 6px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.editor-toolbar-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.editor-toolbar-btn.active {
  background: var(--color-accent-muted);
  color: var(--color-accent);
}
```

## Sources

- Current bubble menu: `src/components/Editor.jsx:500-544`
- Comment textarea: `src/components/Editor.jsx:561-581`
- RevealMarkdown extension: `src/extensions/RevealMarkdown.js`
- prosemirror styles: `src/styles/prosemirror.css`
- Command definitions: `src/data/commands.js`
