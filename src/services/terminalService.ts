import { WS_URL } from '../config.js';
import type { TerminalDataEvent } from '../types/electron-api';

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.createTerminal);
}

export interface TerminalService {
  create: (cwd?: string) => Promise<{ terminalId: string; ws?: WebSocket }>;
  write: (terminalId: string, data: string) => void;
  resize: (terminalId: string, cols: number, rows: number) => void;
  kill: (terminalId: string) => Promise<void>;
  onData: (callback: (event: TerminalDataEvent) => void) => (() => void) | void;
  removeDataListener: (callback: (event: TerminalDataEvent) => void) => void;
}

const electronTerminal: TerminalService = {
  create: async (cwd?: string) => {
    return await window.electronAPI!.createTerminal(cwd ? { cwd } : undefined);
    // Returns { terminalId }
  },
  write: (terminalId: string, data: string) => {
    window.electronAPI!.writeTerminal(terminalId, data);
  },
  resize: (terminalId: string, cols: number, rows: number) => {
    window.electronAPI!.resizeTerminal(terminalId, cols, rows);
  },
  kill: async (terminalId: string) => {
    return await window.electronAPI!.killTerminal(terminalId);
  },
  onData: (callback: (event: TerminalDataEvent) => void) => {
    // Electron sends { terminalId, data } for all terminals on one channel
    return window.electronAPI!.onTerminalData(callback);
  },
  removeDataListener: (callback: (event: TerminalDataEvent) => void) => {
    window.electronAPI!.removeTerminalDataListener(callback);
  },
};

// Browser mode: each terminal gets its own WebSocket
// We track active WebSocket connections in a Map
const browserSockets = new Map<string, WebSocket>();

const browserTerminal: TerminalService = {
  create: async (cwd?: string) => {
    const terminalId = crypto.randomUUID();
    const wsUrl = cwd
      ? `${WS_URL}/term?cwd=${encodeURIComponent(cwd)}`
      : `${WS_URL}/term`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    browserSockets.set(terminalId, ws);
    return { terminalId, ws };
  },
  write: (terminalId: string, data: string) => {
    const ws = browserSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  },
  resize: (terminalId: string, cols: number, rows: number) => {
    const ws = browserSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ cols, rows }));
    }
  },
  kill: async (terminalId: string) => {
    const ws = browserSockets.get(terminalId);
    if (ws) {
      ws.close();
      browserSockets.delete(terminalId);
    }
  },
  // Browser mode: data listeners are per-WebSocket, set up inside the component
  onData: () => () => {},
  removeDataListener: () => {},
};

const terminalService: TerminalService = isElectron() ? electronTerminal : browserTerminal;
export { isElectron };
export default terminalService;
