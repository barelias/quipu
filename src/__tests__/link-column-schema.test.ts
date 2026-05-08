import { describe, it, expect } from 'vitest';
import { parseQuipuDb, serializeQuipuDb } from '@/extensions/database-viewer/utils/jsonl';
import type { DatabaseSchema, LinkColumnDef } from '@/extensions/database-viewer/types';

// Unit 4 — link column type is purely additive at the schema level. Cell
// values remain plain strings (or null), so parse/serialize need no special
// handling. These tests pin the round-trip behaviour and the dialog wiring.

const linkSchemaJsonl = (mode: 'global' | 'relative', ext = '.md') => {
  const schema: DatabaseSchema = {
    version: 1,
    name: 'Tasks',
    columns: [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'notes', name: 'Notes', type: 'link', mode, defaultExtension: ext } as LinkColumnDef,
    ],
    views: [{ id: 'v1', name: 'Table', type: 'table', filters: [], sorts: [], columnWidths: {} }],
  };
  const lines = [
    JSON.stringify({ _schema: schema }),
    JSON.stringify({ _id: 'r1', title: 'Ship v1', notes: 'ship-v1.md' }),
    JSON.stringify({ _id: 'r2', title: 'Empty link', notes: null }),
  ];
  return lines.join('\n');
};

describe('Link column schema (Unit 4)', () => {
  it('parses a link column with global mode and a default extension', () => {
    const { schema, rows } = parseQuipuDb(linkSchemaJsonl('global', '.md'));
    const notes = schema.columns.find(c => c.id === 'notes') as LinkColumnDef;
    expect(notes.type).toBe('link');
    expect(notes.mode).toBe('global');
    expect(notes.defaultExtension).toBe('.md');
    expect(rows[0].notes).toBe('ship-v1.md');
    expect(rows[1].notes).toBeNull();
  });

  it('parses a link column with relative mode', () => {
    const { schema } = parseQuipuDb(linkSchemaJsonl('relative', '.md'));
    const notes = schema.columns.find(c => c.id === 'notes') as LinkColumnDef;
    expect(notes.mode).toBe('relative');
  });

  it('serialises and re-parses link columns round-trip identical', () => {
    const original = parseQuipuDb(linkSchemaJsonl('relative', '.txt'));
    const serialized = serializeQuipuDb(original.schema, original.rows);
    const reparsed = parseQuipuDb(serialized);
    expect(reparsed.schema).toEqual(original.schema);
    expect(reparsed.rows).toEqual(original.rows);
  });

  it('treats the empty defaultExtension as a real "no extension" choice', () => {
    const schema: DatabaseSchema = {
      version: 1,
      name: 'No-ext',
      columns: [{ id: 'ref', name: 'Ref', type: 'link', mode: 'global', defaultExtension: '' } as LinkColumnDef],
      views: [{ id: 'v1', name: 'Table', type: 'table', filters: [], sorts: [], columnWidths: {} }],
    };
    const serialized = serializeQuipuDb(schema, []);
    const reparsed = parseQuipuDb(serialized);
    const col = reparsed.schema.columns[0] as LinkColumnDef;
    expect(col.defaultExtension).toBe('');
  });
});

describe('AddColumnDialog wiring (Unit 4)', () => {
  it('exposes a Link (file) option in the type list', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.join(__dirname, '..', 'extensions', 'database-viewer', 'components', 'ColumnManager.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/value:\s*'link',\s*label:\s*'Link \(file\)'/);
    expect(source).toMatch(/Link mode/);
    expect(source).toMatch(/Default extension/);
    expect(source).toMatch(/normalizeExtension/);
  });
});
