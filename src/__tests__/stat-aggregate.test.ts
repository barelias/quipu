import { describe, it, expect } from 'vitest';
import { aggregate, filterRows, parseWhere } from '@/extensions/mdx-runtime/charts/aggregate';

const ROWS = [
  { _id: 'r1', status: 'todo', priority: 'high', score: 70 },
  { _id: 'r2', status: 'done', priority: 'high', score: 90 },
  { _id: 'r3', status: 'done', priority: 'low', score: 85 },
  { _id: 'r4', status: 'doing', priority: 'high', score: null },
];

describe('parseWhere', () => {
  it('returns empty for blank input', () => {
    expect(parseWhere(undefined)).toEqual([]);
    expect(parseWhere('   ')).toEqual([]);
  });

  it('parses single equality clauses', () => {
    expect(parseWhere('status=done')).toEqual([{ column: 'status', op: '=', value: 'done' }]);
  });

  it('parses multiple comma-separated clauses', () => {
    expect(parseWhere('status=done, priority=high')).toEqual([
      { column: 'status', op: '=', value: 'done' },
      { column: 'priority', op: '=', value: 'high' },
    ]);
  });

  it('coerces numeric and boolean values', () => {
    expect(parseWhere('score>70')).toEqual([{ column: 'score', op: '>', value: 70 }]);
    expect(parseWhere('isDirectory=true')).toEqual([{ column: 'isDirectory', op: '=', value: true }]);
  });

  it('strips matching surrounding quotes from string values', () => {
    expect(parseWhere('ext=".md"')).toEqual([{ column: 'ext', op: '=', value: '.md' }]);
  });
});

describe('filterRows', () => {
  it('returns all rows when where is empty', () => {
    expect(filterRows(ROWS, [])).toHaveLength(4);
  });

  it('filters by equality', () => {
    expect(filterRows(ROWS, parseWhere('status=done'))).toHaveLength(2);
  });

  it('filters by inequality', () => {
    expect(filterRows(ROWS, parseWhere('status!=done'))).toHaveLength(2);
  });

  it('combines clauses with AND', () => {
    expect(filterRows(ROWS, parseWhere('status=done, priority=high'))).toHaveLength(1);
  });

  it('filters numeric comparisons', () => {
    expect(filterRows(ROWS, parseWhere('score>70'))).toHaveLength(2);
    expect(filterRows(ROWS, parseWhere('score>=70'))).toHaveLength(3);
  });
});

describe('aggregate', () => {
  it('count returns row count', () => {
    expect(aggregate(ROWS, 'count')).toBe(4);
    expect(aggregate([], 'count')).toBe(0);
  });

  it('sum / avg / min / max over a numeric column', () => {
    expect(aggregate(ROWS, 'sum', 'score')).toBe(70 + 90 + 85);
    expect(aggregate(ROWS, 'avg', 'score')).toBeCloseTo((70 + 90 + 85) / 3, 5);
    expect(aggregate(ROWS, 'min', 'score')).toBe(70);
    expect(aggregate(ROWS, 'max', 'score')).toBe(90);
  });

  it('first returns the first row value', () => {
    expect(aggregate(ROWS, 'first', 'status')).toBe('todo');
  });

  it('returns null for empty rows on non-count aggregates', () => {
    expect(aggregate([], 'sum', 'score')).toBeNull();
    expect(aggregate([], 'first', 'status')).toBeNull();
  });

  it('returns null when column has no numeric values', () => {
    expect(aggregate(ROWS, 'sum', 'status')).toBeNull();
  });

  it('combines naturally with filterRows for count-where workflow', () => {
    const done = filterRows(ROWS, parseWhere('status=done'));
    expect(aggregate(done, 'count')).toBe(2);
    expect(aggregate(done, 'avg', 'score')).toBeCloseTo((90 + 85) / 2, 5);
  });
});
