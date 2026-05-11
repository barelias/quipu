import { describe, it, expect, vi } from 'vitest';

// We test the parsing pipeline directly — no React, no DOM. The hook
// itself is covered indirectly by chart-mdx-block / agent-chat-custom-
// blocks tests; this file pins the format coverage.

vi.mock('@/services/fileSystem', () => ({
  default: { readFile: vi.fn() },
}));

import { parseChartFile, pivotWide, resolveChartSrc } from '@/extensions/mdx-runtime/charts/dataLoader';

describe('parseChartFile (Unit 12 — charts)', () => {
  it('parses CSV with header row + numeric coercion via papaparse', async () => {
    const csv = 'date,accuracy\n2026-01-01,67.3\n2026-02-01,72.8\n';
    const rows = await parseChartFile(csv, 'csv');
    expect(rows).toEqual([
      { date: '2026-01-01', accuracy: 67.3 },
      { date: '2026-02-01', accuracy: 72.8 },
    ]);
  });

  it('parses TSV with tab delimiter', async () => {
    const tsv = 'model\taccuracy\nNCA\t70\nTX\t65\n';
    const rows = await parseChartFile(tsv, 'tsv');
    expect(rows).toEqual([
      { model: 'NCA', accuracy: 70 },
      { model: 'TX', accuracy: 65 },
    ]);
  });

  it('parses JSON array of objects', async () => {
    const json = JSON.stringify([{ a: 1 }, { a: 2 }]);
    const rows = await parseChartFile(json, 'json');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('rejects JSON that is not an array', async () => {
    await expect(parseChartFile('{"a":1}', 'json')).rejects.toThrow(/must be an array/);
  });

  it('parses JSONL (one object per line)', async () => {
    const jsonl = '{"a":1}\n{"a":2}\n\n{"a":3}\n';
    const rows = await parseChartFile(jsonl, 'jsonl');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('reports the bad line number on JSONL parse errors', async () => {
    const jsonl = '{"a":1}\n{bad}\n';
    await expect(parseChartFile(jsonl, 'jsonl')).rejects.toThrow(/line 2/);
  });

  it('parses .quipudb.jsonl, returning rows without the schema line', async () => {
    const text = [
      '{"_schema":{"version":1,"name":"X","columns":[{"id":"v","name":"V","type":"number"}],"views":[]}}',
      '{"_id":"r1","v":10}',
      '{"_id":"r2","v":20}',
    ].join('\n');
    const rows = await parseChartFile(text, 'quipudb');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ _id: 'r1', v: 10 });
  });

  it('returns an empty array for empty input', async () => {
    expect(await parseChartFile('', 'csv')).toEqual([]);
    expect(await parseChartFile('   \n   ', 'jsonl')).toEqual([]);
  });
});

describe('pivotWide (Unit 12 — charts)', () => {
  it('pivots long data into wide shape, one column per series value', () => {
    const long = [
      { date: 'A', model: 'NCA', acc: 70 },
      { date: 'A', model: 'TX', acc: 65 },
      { date: 'B', model: 'NCA', acc: 75 },
      { date: 'B', model: 'TX', acc: 68 },
    ];
    const { rows, seriesNames } = pivotWide(long, 'date', 'acc', 'model');
    expect(seriesNames.sort()).toEqual(['NCA', 'TX']);
    expect(rows).toEqual([
      { date: 'A', NCA: 70, TX: 65 },
      { date: 'B', NCA: 75, TX: 68 },
    ]);
  });

  it('labels null/missing series values as "Unknown" rather than dropping rows', () => {
    const long = [
      { x: 1, group: null, y: 10 },
      { x: 1, group: 'a', y: 20 },
    ];
    const { rows, seriesNames } = pivotWide(long, 'x', 'y', 'group');
    expect(seriesNames.sort()).toEqual(['Unknown', 'a']);
    expect(rows[0]).toMatchObject({ x: 1, Unknown: 10, a: 20 });
  });
});

describe('resolveChartSrc (Unit 12 — charts)', () => {
  it('joins workspace-relative paths under the workspace root', () => {
    expect(resolveChartSrc('data/a.csv', '/ws')).toBe('/ws/data/a.csv');
  });

  it('passes absolute paths through verbatim', () => {
    expect(resolveChartSrc('/abs/a.csv', '/ws')).toBe('/abs/a.csv');
  });

  it('falls back to the bare src when no workspace is known', () => {
    expect(resolveChartSrc('data/a.csv', null)).toBe('data/a.csv');
  });
});
