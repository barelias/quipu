import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Avoid pulling in the full DatabaseViewer provider chain — Unit 9's
// contract is "valid source -> viewer; invalid source -> error pre". We
// stub the heavy viewer so we can check which branch ran.
vi.mock('@/extensions/database-viewer/DatabaseViewer', () => ({
  default: ({ content, mode }: { content?: string | null; mode?: string }) => (
    <div data-testid="db-viewer" data-mode={mode}>{content?.slice(0, 32) ?? ''}</div>
  ),
}));

import ChatDatabaseBlock from '@/extensions/agent-chat/ChatDatabaseBlock';

const VALID = [
  '{"_schema":{"version":1,"name":"Untitled","columns":[{"id":"a","name":"A","type":"text"}],"views":[]}}',
  '{"_id":"r1","a":"hello"}',
].join('\n');

describe('ChatDatabaseBlock (Unit 9)', () => {
  it('renders a chat-mode DatabaseViewer for valid quipudb source', () => {
    const { getByTestId } = render(<ChatDatabaseBlock source={VALID} />);
    const viewer = getByTestId('db-viewer');
    expect(viewer.getAttribute('data-mode')).toBe('chat');
    expect(viewer.textContent).toContain('_schema');
  });

  it('falls back to an error <pre> on malformed source', () => {
    const { container } = render(<ChatDatabaseBlock source="this is not json" />);
    const pre = container.querySelector('pre.agent-custom-block-error');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toMatch(/quipudb parse error/);
    expect(container.querySelector('[data-testid="db-viewer"]')).toBeNull();
  });

  it('falls back when source is empty', () => {
    const { container } = render(<ChatDatabaseBlock source="" />);
    expect(container.querySelector('pre.agent-custom-block-error')).toBeTruthy();
  });
});
