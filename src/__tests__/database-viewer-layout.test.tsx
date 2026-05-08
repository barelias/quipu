import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import DatabaseViewer from '@/extensions/database-viewer/DatabaseViewer';

// jsdom does not lay out CSS (css: false in vitest.config.js), so these
// assertions check the wiring that produces alignment — every database
// surface should anchor its horizontal padding to the same --db-h-pad token,
// and the table no longer forces full panel width.

const SCHEMA_ONLY = '{"_schema":{"version":1,"name":"Untitled","columns":[{"id":"teste","name":"Teste","type":"text"}],"views":[{"id":"v1","name":"Table","type":"table","filters":[],"sorts":[],"columnWidths":{}}]}}';

const FIVE_COL_DB = (() => {
  const columns = ['a', 'b', 'c', 'd', 'e'].map(id => ({
    id,
    name: id.toUpperCase(),
    type: 'text',
  }));
  const schema = { version: 1, name: 'Wide', columns, views: [{ id: 'v1', name: 'Table', type: 'table', filters: [], sorts: [], columnWidths: {} }] };
  const lines = [JSON.stringify({ _schema: schema })];
  for (let i = 0; i < 3; i++) {
    lines.push(JSON.stringify({ _id: `r${i}`, a: 'x', b: 'x', c: 'x', d: 'x', e: 'x' }));
  }
  return lines.join('\n');
})();

describe('DatabaseViewer layout (Unit 1)', () => {
  it('exposes --db-h-pad in the theme so all surfaces share one token', () => {
    const themePath = path.join(__dirname, '..', 'styles', 'theme.css');
    const themeCss = fs.readFileSync(themePath, 'utf-8');
    expect(themeCss).toMatch(/--db-h-pad:\s*\d+px/);
  });

  it('title row uses the shared --db-h-pad token in standalone mode', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <DatabaseViewer content={SCHEMA_ONLY} onContentChange={onContentChange} mode="standalone" />,
    );
    const title = container.querySelector('h1');
    expect(title).toBeTruthy();
    const titleRow = title!.parentElement!;
    expect(titleRow.style.paddingInline).toBe('var(--db-h-pad)');
  });

  it('toolbar uses the shared --db-h-pad token', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <DatabaseViewer content={SCHEMA_ONLY} onContentChange={onContentChange} mode="standalone" />,
    );
    // Toolbar carries Filter/Sort + view-switcher; matches the second
    // shrink-0 row we tagged with the padding token.
    const toolbar = Array.from(container.querySelectorAll<HTMLElement>('div.shrink-0')).find(
      el => el.style.paddingInline === 'var(--db-h-pad)' && el.textContent?.includes('Filter'),
    );
    expect(toolbar, 'toolbar with --db-h-pad and Filter text should exist').toBeTruthy();
  });

  it('table scroll container uses the shared --db-h-pad token so its content aligns under the title', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <DatabaseViewer content={FIVE_COL_DB} onContentChange={onContentChange} mode="standalone" />,
    );
    // Find the scroll container that wraps <table>.
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBeGreaterThan(0);
    const scrollWrapper = tables[0].parentElement!;
    expect(scrollWrapper.style.paddingInline).toBe('var(--db-h-pad)');
    expect(scrollWrapper.className).toMatch(/overflow-auto/);
  });

  it('table is column-sized, not forced to fill the panel', () => {
    const onContentChange = vi.fn();
    const { container } = render(
      <DatabaseViewer content={FIVE_COL_DB} onContentChange={onContentChange} mode="standalone" />,
    );
    const table = container.querySelector('table')!;
    // w-full would force the table to stretch even when columns total less
    // than the panel — the user wanted the table to size to its columns.
    expect(table.className).not.toMatch(/\bw-full\b/);
    // The table still sets an explicit pixel width from TanStack so its
    // overflow is bounded by its scroll container, not by the document.
    expect(table.style.width).toBeTruthy();
  });
});
