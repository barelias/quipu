import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import SelectCell from '@/extensions/database-viewer/components/cells/SelectCell';
import MultiSelectCell from '@/extensions/database-viewer/components/cells/MultiSelectCell';
import type { SelectOption } from '@/extensions/database-viewer/types';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'Todo', color: '#6366f1' },
  { value: 'Done', color: '#22c55e' },
];

describe('SelectCell — create option on the fly', () => {
  it('shows the search input only when onAddOption is supplied', () => {
    const withoutAdd = render(
      <SelectCell value={null} options={STATUS_OPTIONS} onUpdate={vi.fn()} />,
    );
    fireEvent.click(withoutAdd.container.querySelector('button')!);
    expect(screen.queryByPlaceholderText(/Search or create/i)).toBeNull();
    withoutAdd.unmount();

    const withAdd = render(
      <SelectCell value={null} options={STATUS_OPTIONS} onUpdate={vi.fn()} onAddOption={vi.fn()} />,
    );
    fireEvent.click(withAdd.container.querySelector('button')!);
    expect(screen.getByPlaceholderText(/Search or create/i)).toBeTruthy();
  });

  it('filters existing options as the user types', () => {
    const { container } = render(
      <SelectCell
        value={null}
        options={STATUS_OPTIONS}
        onUpdate={vi.fn()}
        onAddOption={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'do' } });
    expect(screen.queryByText('Todo')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'done' } });
    expect(screen.queryByText('Todo')).toBeNull();
    expect(screen.queryByText('Done')).toBeTruthy();
  });

  it('shows the "+ Create" affordance only when query has no exact match', () => {
    const { container } = render(
      <SelectCell
        value={null}
        options={STATUS_OPTIONS}
        onUpdate={vi.fn()}
        onAddOption={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i);

    // Exact match: no create button
    fireEvent.change(input, { target: { value: 'Done' } });
    expect(screen.queryByText(/Create/i)).toBeNull();

    // Non-match: create appears
    fireEvent.change(input, { target: { value: 'In Progress' } });
    expect(screen.queryByText(/Create/i)).toBeTruthy();
    expect(screen.queryByText(/"In Progress"/)).toBeTruthy();
  });

  it('clicking create calls onAddOption with a fresh color, then onUpdate selects it', () => {
    const onAddOption = vi.fn();
    const onUpdate = vi.fn();
    const { container } = render(
      <SelectCell
        value={null}
        options={STATUS_OPTIONS}
        onUpdate={onUpdate}
        onAddOption={onAddOption}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i);
    fireEvent.change(input, { target: { value: 'In Progress' } });
    fireEvent.click(screen.getByText(/Create/i).closest('button')!);

    expect(onAddOption).toHaveBeenCalledTimes(1);
    expect(onAddOption.mock.calls[0][0]).toMatchObject({ value: 'In Progress' });
    expect(typeof onAddOption.mock.calls[0][0].color).toBe('string');
    expect(onUpdate).toHaveBeenCalledWith('In Progress');
  });

  it('Enter on a unique non-matching query creates the option', () => {
    const onAddOption = vi.fn();
    const onUpdate = vi.fn();
    const { container } = render(
      <SelectCell
        value={null}
        options={STATUS_OPTIONS}
        onUpdate={onUpdate}
        onAddOption={onAddOption}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i);
    fireEvent.change(input, { target: { value: 'Blocked' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAddOption).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('Blocked');
  });

  it('trims whitespace and rejects whitespace-only queries', () => {
    const onAddOption = vi.fn();
    const onUpdate = vi.fn();
    const { container } = render(
      <SelectCell
        value={null}
        options={STATUS_OPTIONS}
        onUpdate={onUpdate}
        onAddOption={onAddOption}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i);

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByText(/Create/i)).toBeNull();

    fireEvent.change(input, { target: { value: '  Trimmed  ' } });
    fireEvent.click(screen.getByText(/Create/i).closest('button')!);
    expect(onAddOption).toHaveBeenCalledWith(expect.objectContaining({ value: 'Trimmed' }));
  });
});

describe('MultiSelectCell — create option on the fly', () => {
  it('creates a new option and adds it to the current selection', () => {
    const onAddOption = vi.fn();
    const onUpdate = vi.fn();
    const { container } = render(
      <MultiSelectCell
        value={['Todo']}
        options={STATUS_OPTIONS}
        onUpdate={onUpdate}
        onAddOption={onAddOption}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    const input = screen.getByPlaceholderText(/Search or create/i);
    fireEvent.change(input, { target: { value: 'In Progress' } });
    fireEvent.click(screen.getByText(/Create/i).closest('button')!);

    expect(onAddOption).toHaveBeenCalledTimes(1);
    expect(onAddOption.mock.calls[0][0].value).toBe('In Progress');
    // Existing selection preserved; new value appended.
    expect(onUpdate).toHaveBeenCalledWith(['Todo', 'In Progress']);
  });
});
