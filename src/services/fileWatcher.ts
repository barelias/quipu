import { WS_URL } from '../config.js';

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.watchDirectory);
}

export interface FileWatcherEvent {
  type: string;
  path?: string;
}

export interface FileWatcherService {
  watch: (dirPath: string) => Promise<{ success: boolean } | null>;
  onChanged: (callback: (event: FileWatcherEvent) => void) => () => void;
  unwatch: () => Promise<{ success: boolean } | null>;
}

// Electron: delegates to IPC-based fs.watch in the main process
const electronWatcher: FileWatcherService = {
  watch: (dirPath: string) => {
    return window.electronAPI!.watchDirectory(dirPath);
  },

  onChanged: (callback: (event: FileWatcherEvent) => void) => {
    window.electronAPI!.onDirectoryChanged(callback);
    return () => window.electronAPI!.removeDirectoryListener();
  },

  unwatch: () => {
    // Electron watcher is replaced on next watch() call; no explicit unwatch needed
    return window.electronAPI!.watchDirectory(null);
  },
};

// Browser: connects to Go server's /watch WebSocket endpoint
function createBrowserWatcher(): FileWatcherService {
  let ws: WebSocket | null = null;
  let listeners: Array<(event: FileWatcherEvent) => void> = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentDir: string | null = null;

  function connect(dirPath: string): void {
    cleanup();
    currentDir = dirPath;

    const url = `${WS_URL}/watch?path=${encodeURIComponent(dirPath)}`;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data: FileWatcherEvent = JSON.parse(event.data as string);
        listeners.forEach(cb => cb(data));
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      // Attempt reconnect after 5 seconds if we still have a target dir
      if (currentDir) {
        reconnectTimer = setTimeout(() => connect(currentDir!), 5000);
      }
    };

    ws.onerror = () => {
      // Will trigger onclose which handles reconnect
    };
  }

  function cleanup(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // Prevent reconnect on intentional close
      ws.close();
      ws = null;
    }
  }

  return {
    watch: (dirPath: string) => {
      connect(dirPath);
      return Promise.resolve({ success: true });
    },

    onChanged: (callback: (event: FileWatcherEvent) => void) => {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter(cb => cb !== callback);
      };
    },

    unwatch: () => {
      currentDir = null;
      cleanup();
      listeners = [];
      return Promise.resolve({ success: true });
    },
  };
}

const fileWatcher: FileWatcherService = isElectron() ? electronWatcher : createBrowserWatcher();

export default fileWatcher;
