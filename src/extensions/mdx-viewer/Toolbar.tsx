import React from 'react';
import { CodeIcon, ColumnsIcon, EyeIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type MdxViewMode = 'source' | 'split' | 'preview';

interface ToolbarProps {
  fileName: string;
  isDirty: boolean;
  mode: MdxViewMode;
  onModeChange: (next: MdxViewMode) => void;
}

const MODE_OPTIONS: { value: MdxViewMode; label: string; Icon: React.ComponentType<{ size?: number; weight?: 'bold' | 'fill' }> }[] = [
  { value: 'source', label: 'Source', Icon: CodeIcon },
  { value: 'split', label: 'Split', Icon: ColumnsIcon },
  { value: 'preview', label: 'Preview', Icon: EyeIcon },
];

const MdxToolbar: React.FC<ToolbarProps> = ({ fileName, isDirty, mode, onModeChange }) => {
  return (
    <div
      className="shrink-0 flex items-center gap-3 py-1.5 border-b border-border/30"
      style={{ paddingInline: 'var(--db-h-pad)' }}
    >
      <div className="flex items-center gap-1.5 text-sm text-text-secondary">
        <span className="font-medium text-text-primary">{fileName}</span>
        {isDirty && <span className="text-xs text-text-tertiary" title="Unsaved changes">●</span>}
      </div>

      <div className="ml-auto flex items-center gap-0.5 bg-bg-surface rounded-md p-0.5 border border-border/50">
        {MODE_OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            title={label}
            aria-pressed={mode === value}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              'text-text-tertiary hover:text-text-secondary',
              mode === value && 'bg-bg-elevated text-text-primary shadow-sm',
            )}
          >
            <Icon size={14} weight="bold" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MdxToolbar;
