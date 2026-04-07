import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useToast } from '@/components/Toast';
import type { TerminalTab } from '@/types/editor';

const MAX_TERMINALS = 5;

/** Operations that Terminal.tsx registers on mount so other components can interact with xterm. */
export interface TerminalXtermOps {
  write: (data: string) => void;
  focus: () => void;
  clear: () => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  paste: (text: string) => void;
}

export interface TerminalContextValue {
  // State
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;

  // Tab operations
  createTerminalTab: () => TerminalTab | null;
  closeTerminalTab: (tabId: string) => void;
  switchTerminalTab: (tabId: string) => void;
  setTerminalClaudeRunning: (tabId: string, isRunning: boolean) => void;
  clearAllTerminals: () => void;

  // Xterm operations (registered by Terminal.tsx on mount)
  registerXtermRef: (ops: TerminalXtermOps | null) => void;
  sendToTerminal: (text: string) => void;
  clearTerminal: () => void;
  getTerminalSelection: () => string;
  hasTerminalSelection: () => boolean;
  pasteToTerminal: (text: string) => void;
  focusTerminal: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

interface TerminalProviderProps {
  children: React.ReactNode;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const { showToast } = useToast();

  // --- State ---
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const terminalCounterRef = useRef<number>(0);
  const xtermOpsRef = useRef<TerminalXtermOps | null>(null);

  // --- Leaf callbacks (no deps on other callbacks) ---

  const registerXtermRef = useCallback((ops: TerminalXtermOps | null) => {
    xtermOpsRef.current = ops;
  }, []);

  const switchTerminalTab = useCallback((tabId: string) => {
    setActiveTerminalId(tabId);
  }, []);

  const setTerminalClaudeRunning = useCallback((tabId: string, isRunning: boolean) => {
    setTerminalTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isClaudeRunning: isRunning } : t
    ));
  }, []);

  const clearAllTerminals = useCallback(() => {
    setTerminalTabs([]);
    setActiveTerminalId(null);
  }, []);

  const sendToTerminal = useCallback((text: string) => {
    xtermOpsRef.current?.write(text);
  }, []);

  const clearTerminal = useCallback(() => {
    xtermOpsRef.current?.clear();
  }, []);

  const getTerminalSelection = useCallback((): string => {
    return xtermOpsRef.current?.getSelection() ?? '';
  }, []);

  const hasTerminalSelection = useCallback((): boolean => {
    return xtermOpsRef.current?.hasSelection() ?? false;
  }, []);

  const pasteToTerminal = useCallback((text: string) => {
    xtermOpsRef.current?.paste(text);
  }, []);

  const focusTerminal = useCallback(() => {
    xtermOpsRef.current?.focus();
  }, []);

  // --- Dependent callbacks ---

  const createTerminalTab = useCallback((): TerminalTab | null => {
    if (terminalTabs.length >= MAX_TERMINALS) {
      showToast('Maximum of 5 terminals reached', 'warning');
      return null;
    }
    terminalCounterRef.current += 1;
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      label: `Terminal ${terminalCounterRef.current}`,
      isClaudeRunning: false,
    };
    setTerminalTabs(prev => [...prev, tab]);
    setActiveTerminalId(tab.id);
    return tab;
  }, [terminalTabs.length, showToast]);

  const closeTerminalTab = useCallback((tabId: string) => {
    setTerminalTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTerminalId === tabId && filtered.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newIdx = Math.min(idx, filtered.length - 1);
        setActiveTerminalId(filtered[newIdx].id);
      } else if (filtered.length === 0) {
        setActiveTerminalId(null);
      }
      return filtered;
    });
  }, [activeTerminalId]);

  const value: TerminalContextValue = {
    terminalTabs,
    activeTerminalId,
    createTerminalTab,
    closeTerminalTab,
    switchTerminalTab,
    setTerminalClaudeRunning,
    clearAllTerminals,
    registerXtermRef,
    sendToTerminal,
    clearTerminal,
    getTerminalSelection,
    hasTerminalSelection,
    pasteToTerminal,
    focusTerminal,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}
