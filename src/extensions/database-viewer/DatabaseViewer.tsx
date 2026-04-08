import React from 'react';
import { useDatabase } from './hooks/useDatabase';
import TableView from './components/TableView';
import type { Tab, ActiveFile } from '@/types/tab';

export interface DatabaseViewerProps {
  tab: Tab;
  activeFile: ActiveFile;
  onContentChange?: (content: string) => void;
  isActive?: boolean;
}

const DatabaseViewer: React.FC<DatabaseViewerProps> = ({ activeFile, onContentChange }) => {
  const content = typeof activeFile.content === 'string' ? activeFile.content : null;

  const {
    schema,
    rows,
    addRow,
    updateCell,
  } = useDatabase({ content, onContentChange });

  return (
    <div className="flex-1 flex flex-col bg-bg-base overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-sm font-medium text-text-primary">{schema.name}</span>
        <span className="text-xs text-text-tertiary">
          {rows.length} row{rows.length !== 1 ? 's' : ''} &middot; {schema.columns.length} column{schema.columns.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table view */}
      <TableView
        schema={schema}
        rows={rows}
        updateCell={updateCell}
        addRow={addRow}
      />
    </div>
  );
};

export default DatabaseViewer;
