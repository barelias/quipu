import React, { useRef, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { useColumnDefs } from '../hooks/useColumnDefs';
import type { DatabaseSchema, DatabaseRow } from '../types';

interface TableViewProps {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  addRow: () => void;
}

const ROW_HEIGHT = 36;

const TableView: React.FC<TableViewProps> = ({ schema, rows, updateCell, addRow }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const columns = useColumnDefs(schema);

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableSorting: true,
    getRowId: (row) => row._id,
    meta: {
      updateCell,
    },
  });

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const handleAddRow = useCallback(() => {
    addRow();
  }, [addRow]);

  if (schema.columns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        No columns defined yet. Add a column to get started.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Table container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
      >
        <table
          className="w-full border-collapse"
          style={{ width: table.getCenterTotalSize() }}
        >
          {/* Header */}
          <thead className="sticky top-0 z-10 bg-bg-elevated">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className={cn(
                      'relative text-left px-3 py-2 text-text-secondary font-medium text-xs uppercase tracking-wide',
                      'border-b border-r border-border select-none',
                      header.column.getCanSort() && 'cursor-pointer hover:bg-bg-surface',
                    )}
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && (
                        <span className="text-accent text-[10px]">▲</span>
                      )}
                      {header.column.getIsSorted() === 'desc' && (
                        <span className="text-accent text-[10px]">▼</span>
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                        'hover:bg-accent/50',
                        header.column.getIsResizing() && 'bg-accent',
                      )}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Body with virtualization */}
          <tbody>
            {/* Spacer for virtualized rows */}
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0 }}
                  colSpan={schema.columns.length}
                />
              </tr>
            )}
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const row = tableRows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/30 hover:bg-bg-surface/50 transition-colors"
                  style={{ height: ROW_HEIGHT }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-3 py-1.5 text-sm text-text-primary border-r border-border/20',
                        'overflow-hidden text-ellipsis whitespace-nowrap',
                      )}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {/* Bottom spacer */}
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  style={{
                    height:
                      rowVirtualizer.getTotalSize() -
                      (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                  }}
                  colSpan={schema.columns.length}
                />
              </tr>
            )}
          </tbody>
        </table>

        {/* Add row button */}
        <button
          onClick={handleAddRow}
          className={cn(
            'w-full text-left px-3 py-2 text-sm text-text-tertiary',
            'hover:bg-bg-surface/50 hover:text-text-secondary transition-colors',
            'border-b border-border/20',
          )}
        >
          + New row
        </button>
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center px-3 py-1 bg-bg-elevated border-t border-border text-xs text-text-tertiary">
        {tableRows.length === rows.length
          ? `${rows.length} row${rows.length !== 1 ? 's' : ''}`
          : `${tableRows.length} of ${rows.length} rows (filtered)`}
      </div>
    </div>
  );
};

export default TableView;
