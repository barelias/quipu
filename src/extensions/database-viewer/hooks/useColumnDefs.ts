import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ColumnDef as TanstackColumnDef } from '@tanstack/react-table';
import type { DatabaseRow, DatabaseSchema, ColumnDef } from '../types';

const columnHelper = createColumnHelper<DatabaseRow>();

/**
 * Format a cell value for display based on column type.
 */
function formatCellValue(value: unknown, colDef: ColumnDef): string {
  if (value == null) return '';

  switch (colDef.type) {
    case 'text':
      return String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    case 'select':
      return String(value);
    case 'multi-select':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'date':
      if (typeof value === 'string') {
        try {
          return new Date(value).toLocaleDateString();
        } catch {
          return value;
        }
      }
      return String(value);
    case 'checkbox':
      return value ? '✓' : '';
    default:
      return String(value);
  }
}

/**
 * Generate TanStack Table column definitions from the database schema.
 * Returns column defs with type-appropriate sorting and display.
 */
export function useColumnDefs(schema: DatabaseSchema): TanstackColumnDef<DatabaseRow, unknown>[] {
  return useMemo(() => {
    return schema.columns.map((col) => {
      return columnHelper.accessor(col.id, {
        id: col.id,
        header: col.name,
        cell: (info) => formatCellValue(info.getValue(), col),
        sortingFn: col.type === 'number' ? 'basic' : 'alphanumeric',
        size: 180,
        minSize: 80,
        maxSize: 500,
        enableResizing: true,
        meta: {
          columnDef: col,
        },
      });
    });
  }, [schema.columns]);
}
