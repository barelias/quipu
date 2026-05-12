import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Popover } from 'radix-ui';
import { PlusIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { pillStyle } from '../../utils/colors';
import { SELECT_COLORS, type SelectOption } from '../../types';

interface SelectCellProps {
  value: string | null;
  options: SelectOption[];
  onUpdate: (value: string | null) => void;
  /** When provided, the popover shows a search input that doubles as a
   *  "+ Create" affordance for option names that don't match an existing
   *  entry. Pre-existing select columns from older databases still work
   *  unchanged when the parent omits this prop. */
  onAddOption?: (option: SelectOption) => void;
}

function nextColor(usedCount: number): string {
  return SELECT_COLORS[usedCount % SELECT_COLORS.length];
}

const SelectCell: React.FC<SelectCellProps> = ({ value, options, onUpdate, onAddOption }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.value === value);

  // Reset the query whenever the popover closes so reopening starts clean.
  useEffect(() => {
    if (!isOpen) setQuery('');
    else requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!lowerQuery) return options;
    return options.filter(o => o.value.toLowerCase().includes(lowerQuery));
  }, [options, lowerQuery]);

  const exactMatch = useMemo(
    () => options.some(o => o.value.toLowerCase() === lowerQuery),
    [options, lowerQuery],
  );

  const canCreate = !!onAddOption && trimmedQuery.length > 0 && !exactMatch;

  const handleSelect = useCallback((optionValue: string) => {
    onUpdate(optionValue === value ? null : optionValue);
    setIsOpen(false);
  }, [value, onUpdate]);

  const handleCreate = useCallback(() => {
    if (!canCreate || !onAddOption) return;
    const option: SelectOption = { value: trimmedQuery, color: nextColor(options.length) };
    onAddOption(option);
    onUpdate(option.value);
    setIsOpen(false);
  }, [canCreate, onAddOption, trimmedQuery, options.length, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (filteredOptions.length === 1 && filteredOptions[0].value.toLowerCase() === lowerQuery) {
      handleSelect(filteredOptions[0].value);
    } else if (canCreate) {
      handleCreate();
    } else if (filteredOptions.length === 1) {
      handleSelect(filteredOptions[0].value);
    }
  }, [filteredOptions, lowerQuery, canCreate, handleSelect, handleCreate]);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button className="w-full text-left min-h-[20px] flex items-center">
          {selectedOption ? (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={pillStyle(selectedOption.color)}
            >
              {selectedOption.value}
            </span>
          ) : (
            <span className="text-text-tertiary text-sm" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[200px] z-[9999]"
          align="start"
          sideOffset={4}
        >
          {onAddOption && (
            <div className="px-2 pt-1 pb-1.5 border-b border-border/40">
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search or create…"
                className="w-full bg-transparent text-sm outline-none text-text-primary placeholder-text-tertiary"
              />
            </div>
          )}

          {filteredOptions.map(option => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
                'hover:bg-bg-surface transition-colors',
                option.value === value && 'bg-bg-surface',
              )}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: option.color }}
              />
              <span className="text-text-primary">{option.value}</span>
            </button>
          ))}

          {filteredOptions.length === 0 && options.length > 0 && !canCreate && (
            <div className="px-3 py-2 text-xs text-text-tertiary">No matches</div>
          )}

          {options.length === 0 && !canCreate && (
            <div className="px-3 py-2 text-xs text-text-tertiary">
              {onAddOption ? 'Start typing to create the first option' : 'No options defined'}
            </div>
          )}

          {canCreate && (
            <button
              onClick={handleCreate}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-bg-surface transition-colors text-text-secondary"
            >
              <PlusIcon size={12} weight="bold" />
              <span>
                Create <span className="text-text-primary font-medium">"{trimmedQuery}"</span>
              </span>
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default SelectCell;
