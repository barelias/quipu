import '@testing-library/jest-dom';

// Mock crypto.randomUUID
if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  let counter = 0;
  globalThis.crypto.randomUUID = () => `test-uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`;
}

// Mock window.electronAPI as undefined (browser mode)
delete (window as unknown as Record<string, unknown>).electronAPI;

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, val: string): void => { store[key] = String(val); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { Object.keys(store).forEach(k => delete store[k]); },
  },
});
