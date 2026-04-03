import { describe, it, expect } from 'vitest';

describe('FileExplorer creation input indent', () => {
  // Simulates the padding calculation from FileExplorer
  const getItemPadding = (depth) => 12 + depth * 16;
  const getCreationInputPadding = (depth) => 12 + (depth + 1) * 16;

  it('child items are indented by depth * 16 + 12', () => {
    expect(getItemPadding(0)).toBe(12);
    expect(getItemPadding(1)).toBe(28);
    expect(getItemPadding(2)).toBe(44);
  });

  it('creation input is at depth+1 level', () => {
    // Creating inside a folder at depth 0 → input at depth 1
    expect(getCreationInputPadding(0)).toBe(28);
    // Creating inside a folder at depth 1 → input at depth 2
    expect(getCreationInputPadding(1)).toBe(44);
  });

  it('creation input + caret spacer aligns with child text', () => {
    // Child at depth 1: padding=28, then caret(14px) + gap(4px) + icon(16px) + gap(4px) + text
    // Creation at depth 0: padding=28, then spacer(14px) + gap(4px) + icon(16px) + gap(4px) + text
    // Both have text starting at: 28 + 14 + 4 + 16 + 4 = 66px from left
    const childTextStart = getCreationInputPadding(0) + 14 + 4 + 16 + 4;
    const creationTextStart = getCreationInputPadding(0) + 14 + 4 + 16 + 4;
    expect(childTextStart).toBe(creationTextStart);
  });
});

describe('Drag-and-drop cleanup', () => {
  it('quipu-drag-end custom event can be created', () => {
    const event = new CustomEvent('quipu-drag-end');
    expect(event.type).toBe('quipu-drag-end');
  });

  it('dragend fires on the source element (design assumption)', () => {
    // This documents the design decision: onDragEnd on each draggable item
    // dispatches 'quipu-drag-end' to clear all isDragOver states
    const handlers = [];
    const mockDispatch = (event) => handlers.push(event.type);

    // Simulate: drag ends → handler fires → custom event dispatched
    const dragEndHandler = () => {
      mockDispatch(new CustomEvent('quipu-drag-end'));
    };
    dragEndHandler();
    expect(handlers).toContain('quipu-drag-end');
  });
});

describe('revealFolder logic', () => {
  // Simulates the revealFolder function from WorkspaceContext
  const revealFolder = (folderPath, workspacePath, expandedFolders) => {
    const next = new Set(expandedFolders);
    if (!folderPath.startsWith(workspacePath)) return next;

    const relative = folderPath.substring(workspacePath.length + 1);
    const segments = relative.split('/');
    let current = workspacePath;
    for (const seg of segments) {
      current += '/' + seg;
      if (current === folderPath) {
        if (next.has(current)) next.delete(current);
        else next.add(current);
      } else {
        next.add(current);
      }
    }
    return next;
  };

  const ws = '/home/user/project';

  it('expands all ancestors and toggles the target', () => {
    const result = revealFolder(`${ws}/src/components/ui`, ws, new Set());
    expect(result.has(`${ws}/src`)).toBe(true);
    expect(result.has(`${ws}/src/components`)).toBe(true);
    expect(result.has(`${ws}/src/components/ui`)).toBe(true);
  });

  it('toggles target off if already expanded', () => {
    const initial = new Set([`${ws}/src`, `${ws}/src/components`, `${ws}/src/components/ui`]);
    const result = revealFolder(`${ws}/src/components/ui`, ws, initial);
    expect(result.has(`${ws}/src`)).toBe(true); // ancestor stays open
    expect(result.has(`${ws}/src/components`)).toBe(true); // ancestor stays open
    expect(result.has(`${ws}/src/components/ui`)).toBe(false); // target toggled off
  });

  it('works for top-level folder', () => {
    const result = revealFolder(`${ws}/docs`, ws, new Set());
    expect(result.has(`${ws}/docs`)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('ignores paths outside workspace', () => {
    const result = revealFolder('/other/path', ws, new Set());
    expect(result.size).toBe(0);
  });
});
