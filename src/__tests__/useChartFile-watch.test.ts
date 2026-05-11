import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/services/fileSystem', () => ({
  default: { readFile: vi.fn() },
}));

import fs from '@/services/fileSystem';
import { useChartFile } from '@/extensions/mdx-runtime/charts/dataLoader';
import { ChartFileContext } from '@/extensions/mdx-runtime/charts/ChartFileContext';

const mockedFs = fs as unknown as { readFile: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.dataset.workspacePath = '/ws';
  // Place a data-workspace-path element where getWorkspacePath() looks for it.
  const root = document.createElement('div');
  root.setAttribute('data-workspace-path', '/ws');
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function watchingWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ChartFileContext.Provider, { value: { watch: true } }, children);
}

describe('useChartFile (Unit 4 — watching variant)', () => {
  it('does NOT re-read on file change events when watching is off (default)', async () => {
    mockedFs.readFile.mockResolvedValue('a,b\n1,2\n');
    const { result } = renderHook(() => useChartFile('data.csv'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('quipu:file-changed', { detail: { path: '/ws/data.csv' } }));
    });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);
  });

  it('re-reads on a matching file change event when watching is on', async () => {
    mockedFs.readFile.mockResolvedValue('a,b\n1,2\n');
    const { result } = renderHook(() => useChartFile('data.csv'), { wrapper: watchingWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('quipu:file-changed', { detail: { path: '/ws/data.csv' } }));
    });
    act(() => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(mockedFs.readFile).toHaveBeenCalledTimes(2));
  });

  it('ignores file change events for unrelated paths', async () => {
    mockedFs.readFile.mockResolvedValue('a,b\n1,2\n');
    const { result } = renderHook(() => useChartFile('data.csv'), { wrapper: watchingWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      window.dispatchEvent(new CustomEvent('quipu:file-changed', { detail: { path: '/ws/something-else.csv' } }));
    });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of events to a single reload via the debounce window', async () => {
    mockedFs.readFile.mockResolvedValue('a,b\n1,2\n');
    const { result } = renderHook(() => useChartFile('data.csv'), { wrapper: watchingWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new CustomEvent('quipu:file-changed', { detail: { path: '/ws/data.csv' } }));
      }
    });
    act(() => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(mockedFs.readFile).toHaveBeenCalledTimes(2));
  });

  it('unsubscribes on unmount', async () => {
    mockedFs.readFile.mockResolvedValue('a,b\n1,2\n');
    const { result, unmount } = renderHook(() => useChartFile('data.csv'), { wrapper: watchingWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent('quipu:file-changed', { detail: { path: '/ws/data.csv' } }));
    });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockedFs.readFile).toHaveBeenCalledTimes(1);
  });
});
