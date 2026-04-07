import React, { useState } from 'react';
import jsYaml from 'js-yaml';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CaretRight, CaretDown, X, Plus } from '@phosphor-icons/react';
import { useToast } from './Toast';
import type { Frontmatter } from '../types/tab';

interface TagEditorProps {
  tags: unknown[];
  fieldKey: string;
  tabId: string;
  onAddTag: (tabId: string, key: string, tagValue: string) => void;
  onRemoveTag: (tabId: string, key: string, index: number) => void;
  onUpdateTag: (tabId: string, key: string, index: number, newValue: string) => void;
}

const TagEditor = ({ tags, fieldKey, tabId, onAddTag, onRemoveTag, onUpdateTag }: TagEditorProps) => {
  const [newTag, setNewTag] = useState<string>('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    onAddTag(tabId, fieldKey, trimmed);
    setNewTag('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAddTag();
    else if (e.key === 'Escape') setNewTag('');
  };

  const startEditing = (i: number, val: unknown) => {
    setEditingIndex(i);
    setEditingValue(String(val));
  };

  const commitEdit = (i: number) => {
    const trimmed = editingValue.trim();
    if (trimmed) onUpdateTag(tabId, fieldKey, i, trimmed);
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter') commitEdit(i);
    else if (e.key === 'Escape') { setEditingIndex(null); setEditingValue(''); }
  };

  return (
    <div className="flex flex-wrap gap-1 items-center pt-0.5">
      {tags.map((tag, i) => (
        <Badge key={i} variant="secondary" className="group/tag gap-1 pr-1 text-xs font-mono">
          {editingIndex === i ? (
            <input
              autoFocus
              value={editingValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingValue(e.target.value)}
              onBlur={() => commitEdit(i)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleEditKeyDown(e, i)}
              className="bg-transparent outline-none w-[6ch] min-w-[3ch] max-w-[20ch] text-xs font-mono"
              style={{ width: `${Math.max(3, editingValue.length + 1)}ch` }}
            />
          ) : (
            <span
              className="cursor-text"
              onDoubleClick={() => startEditing(i, tag)}
              title="Double-click to edit"
            >
              {String(tag)}
            </span>
          )}
          <button
            className="opacity-0 group-hover/tag:opacity-100 transition-opacity cursor-pointer"
            onClick={() => onRemoveTag(tabId, fieldKey, i)}
            title="Remove tag"
          >
            <X size={10} />
          </button>
        </Badge>
      ))}
      <div className="flex items-center gap-0.5">
        <input
          value={newTag}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTag(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="add tag..."
          className={cn(
            "text-xs font-mono bg-transparent outline-none text-page-text/50",
            "placeholder:text-page-text/30 w-[8ch] focus:w-[14ch] transition-all",
            "border-b border-transparent focus:border-page-border",
          )}
        />
        {newTag && (
          <button
            className="text-accent/70 hover:text-accent cursor-pointer"
            onClick={handleAddTag}
            title="Add tag"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

interface FrontmatterFieldProps {
  fieldKey: string;
  value: unknown;
  tabId: string;
  onUpdate: (key: string, value: unknown) => void;
  onRemove: (key: string) => void;
  onRenameKey: (oldKey: string, newKey: string) => void;
  onAddTag: (tabId: string, key: string, tagValue: string) => void;
  onRemoveTag: (tabId: string, key: string, index: number) => void;
  onUpdateTag: (tabId: string, key: string, index: number, newValue: string) => void;
}

const FrontmatterField = ({ fieldKey, value, tabId, onUpdate, onRemove, onRenameKey, onAddTag, onRemoveTag, onUpdateTag }: FrontmatterFieldProps) => {
  const [isEditingKey, setIsEditingKey] = useState<boolean>(false);
  const [editingKeyValue, setEditingKeyValue] = useState<string>(fieldKey);

  const isArray = Array.isArray(value);
  const isBoolean = typeof value === 'boolean';
  const isObject = typeof value === 'object' && value !== null && !isArray;

  const handleKeyBlur = () => {
    setIsEditingKey(false);
    if (editingKeyValue && editingKeyValue !== fieldKey) {
      onRenameKey(fieldKey, editingKeyValue);
    } else {
      setEditingKeyValue(fieldKey);
    }
  };

  const handleKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    else if (e.key === 'Escape') { setEditingKeyValue(fieldKey); setIsEditingKey(false); }
  };

  return (
    <div className="flex items-start gap-3 group">
      {/* Key */}
      {isEditingKey ? (
        <Input
          value={editingKeyValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingKeyValue(e.target.value)}
          onBlur={handleKeyBlur}
          onKeyDown={handleKeyKeyDown}
          autoFocus
          className="w-28 shrink-0 h-7 text-xs font-mono text-page-text/70
                     bg-transparent border-page-border"
        />
      ) : (
        <span
          className="w-28 shrink-0 text-xs font-mono text-page-text/50 pt-1.5
                     truncate cursor-pointer hover:text-page-text/70"
          onClick={() => setIsEditingKey(true)}
          title={fieldKey}
        >
          {fieldKey}
        </span>
      )}

      {/* Value */}
      <div className="flex-1 min-w-0">
        {isArray ? (
          <TagEditor
            tags={value as unknown[]}
            fieldKey={fieldKey}
            tabId={tabId}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onUpdateTag={onUpdateTag}
          />
        ) : isBoolean ? (
          <button
            className={cn(
              "mt-1 w-8 h-4 rounded-full transition-colors relative",
              value ? "bg-accent" : "bg-page-border"
            )}
            onClick={() => onUpdate(fieldKey, !value)}
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                value ? "left-4" : "left-0.5"
              )}
            />
          </button>
        ) : isObject ? (
          <pre className="text-xs font-mono text-page-text/60 whitespace-pre-wrap pt-1">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : (
          <Input
            value={String(value ?? '')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(fieldKey, e.target.value)}
            className="h-7 text-sm font-mono bg-transparent border-transparent
                       text-page-text hover:border-page-border focus:border-accent"
          />
        )}
      </div>

      {/* Remove button */}
      <button
        className="mt-1.5 opacity-0 group-hover:opacity-100 p-0.5 text-page-text/30
                   hover:text-error transition-opacity cursor-pointer"
        onClick={() => onRemove(fieldKey)}
        title="Remove property"
      >
        <X size={12} />
      </button>
    </div>
  );
};

interface FrontmatterPropertiesProps {
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  isCollapsed: boolean;
  tabId: string;
  onUpdate: (tabId: string, key: string, value: unknown) => void;
  onAdd: (tabId: string) => void;
  onRemove: (tabId: string, key: string) => void;
  onRenameKey: (tabId: string, oldKey: string, newKey: string) => void;
  onToggleCollapse: (tabId: string) => void;
  onAddTag: (tabId: string, key: string, tagValue: string) => void;
  onRemoveTag: (tabId: string, key: string, index: number) => void;
  onUpdateTag: (tabId: string, key: string, index: number, newValue: string) => void;
}

const FrontmatterProperties = ({
  frontmatter,
  frontmatterRaw,
  isCollapsed,
  tabId,
  onUpdate,
  onAdd,
  onRemove,
  onRenameKey,
  onToggleCollapse,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
}: FrontmatterPropertiesProps) => {
  const { showToast } = useToast();
  const [isEditingRaw, setIsEditingRaw] = useState<boolean>(false);
  const [rawYaml, setRawYaml] = useState<string>('');

  // No frontmatter at all -- don't render
  if (!frontmatter && !frontmatterRaw) return null;

  const count = Object.keys(frontmatter || {}).length;

  const handleEnterRaw = () => {
    const yaml = frontmatter
      ? jsYaml.dump(frontmatter, { sortKeys: false, lineWidth: -1 })
      : (frontmatterRaw || '');
    setRawYaml(yaml);
    setIsEditingRaw(true);
  };

  const handleExitRaw = () => {
    setIsEditingRaw(false);
  };

  const handleRawBlur = () => {
    try {
      const parsed = jsYaml.load(rawYaml) as Record<string, unknown> | null;
      if (typeof parsed === 'object' && parsed !== null) {
        // Apply all parsed keys via onUpdate
        const existingKeys = Object.keys(frontmatter || {});
        const newKeys = Object.keys(parsed);

        // Remove keys that are no longer present
        for (const k of existingKeys) {
          if (!newKeys.includes(k)) onRemove(tabId, k);
        }
        // Update/add new values
        for (const [k, v] of Object.entries(parsed)) {
          onUpdate(tabId, k, v);
        }
      }
      setIsEditingRaw(false);
    } catch (err: unknown) {
      // Keep textarea open on parse error so user can fix the YAML
      const message = err instanceof Error ? err.message : 'parse error';
      showToast('Invalid YAML: ' + message, 'error');
    }
  };

  const headerRow = (label: string) => (
    <div
      className="flex items-center gap-2 w-full px-4 py-2 text-xs font-mono
                 text-page-text/60 bg-page-bg border-b border-page-border"
    >
      <CollapsibleTrigger
        className="flex items-center gap-2 hover:text-page-text/80 cursor-pointer"
      >
        {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        <span>{label}</span>
      </CollapsibleTrigger>
      <button
        className="ml-auto text-[10px] font-mono text-page-text/40 hover:text-accent
                   transition-colors cursor-pointer px-1"
        onClick={() => isEditingRaw ? handleExitRaw() : handleEnterRaw()}
        title={isEditingRaw ? 'Switch to structured view' : 'Edit raw YAML'}
      >
        {isEditingRaw ? 'Structured' : 'Edit Raw'}
      </button>
    </div>
  );

  // Malformed YAML fallback
  if (frontmatterRaw && !frontmatter) {
    return (
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(tabId)}>
        {headerRow('Properties (malformed YAML)')}
        <CollapsibleContent>
          <pre className="px-4 py-3 text-xs font-mono text-error/80 bg-error/5
                          border-b border-page-border whitespace-pre-wrap">
            {frontmatterRaw}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Normal properties view
  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(tabId)}>
      {headerRow(`Properties ${count > 0 ? `(${count})` : ''}`)}
      <CollapsibleContent>
        <div className="px-4 py-3 space-y-1.5 bg-page-bg border-b border-page-border">
          {isEditingRaw ? (
            <textarea
              autoFocus
              value={rawYaml}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRawYaml(e.target.value)}
              onBlur={handleRawBlur}
              className="w-full font-mono text-xs bg-transparent text-page-text
                         border border-page-border rounded p-2 min-h-[80px] resize-y
                         outline-none focus:border-accent"
            />
          ) : (
            <>
              {count > 0 ? (
                Object.entries(frontmatter!).map(([key, value]) => (
                  <FrontmatterField
                    key={key}
                    fieldKey={key}
                    value={value}
                    tabId={tabId}
                    onUpdate={(k: string, v: unknown) => onUpdate(tabId, k, v)}
                    onRemove={(k: string) => onRemove(tabId, k)}
                    onRenameKey={(oldK: string, newK: string) => onRenameKey(tabId, oldK, newK)}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    onUpdateTag={onUpdateTag}
                  />
                ))
              ) : (
                <p className="text-xs font-mono text-page-text/40 py-1">No properties</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-mono text-accent/70 hover:text-accent
                           px-0 h-6"
                onClick={() => onAdd(tabId)}
              >
                <Plus size={12} className="mr-1" />
                Add property
              </Button>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default FrontmatterProperties;
