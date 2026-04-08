import { SERVER_URL } from '../config.js';
import storageService from './storageService';
import type { KernelStartResult, KernelValidateResult } from '../types/electron-api';

const VENV_STORAGE_KEY = 'notebookVenvPath';

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.kernelStart);
}

export interface KernelSession {
  id: string;
  kernel: { id: string; name: string };
  path: string;
}

export interface KernelImpl {
  validateVenv: (venvPath: string) => Promise<KernelValidateResult>;
  startServer: (venvPath: string, workspaceRoot: string) => Promise<KernelStartResult>;
  stopServer: () => Promise<{ success: boolean }>;
  createSession: (notebookPath: string, kernelName?: string) => Promise<KernelSession>;
  closeSession: (sessionId: string) => Promise<void>;
  interruptKernel: (kernelId: string) => Promise<void>;
  restartKernel: (kernelId: string) => Promise<unknown>;
  getChannelUrl: (kernelId: string) => string | Promise<string>;
}

export interface KernelService extends KernelImpl {
  getVenvPath: () => Promise<unknown>;
  setVenvPath: (path: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// In-flight start serialization — prevents concurrent spawns
// ---------------------------------------------------------------------------
let _startPromise: Promise<KernelStartResult> | null = null;

// ---------------------------------------------------------------------------
// Browser implementation — calls Go proxy endpoints
// ---------------------------------------------------------------------------
const browserKernel: KernelImpl = {
  validateVenv: async (venvPath: string) => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venvPath }),
    });
    return res.json();
  },

  startServer: async (venvPath: string, workspaceRoot: string) => {
    if (_startPromise) return _startPromise;
    _startPromise = fetch(`${SERVER_URL}/api/jupyter/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venvPath, workspaceRoot }),
    })
      .then((r) => r.json() as Promise<KernelStartResult>)
      .finally(() => { _startPromise = null; });
    return _startPromise;
  },

  stopServer: async () => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/stop`, { method: 'DELETE' });
    return res.json();
  },

  createSession: async (notebookPath: string, kernelName: string = 'python3') => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: notebookPath, type: 'notebook', kernel: { name: kernelName } }),
    });
    return res.json(); // { id, kernel: { id, name }, path }
  },

  closeSession: async (sessionId: string) => {
    await fetch(`${SERVER_URL}/api/jupyter/sessions/${sessionId}`, { method: 'DELETE' });
  },

  interruptKernel: async (kernelId: string) => {
    await fetch(`${SERVER_URL}/api/jupyter/kernels/${kernelId}/interrupt`, { method: 'POST' });
  },

  restartKernel: async (kernelId: string) => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/kernels/${kernelId}/restart`, { method: 'POST' });
    return res.json();
  },

  // Browser: frontend connects via Go WebSocket proxy
  getChannelUrl: (kernelId: string) => {
    const wsBase = SERVER_URL.replace(/^http/, 'ws');
    return `${wsBase}/ws/jupyter/kernels/${kernelId}/channels`;
  },
};

// ---------------------------------------------------------------------------
// Electron implementation — calls IPC via window.electronAPI
// ---------------------------------------------------------------------------
const electronKernel: KernelImpl = {
  validateVenv: async (venvPath: string) => {
    return window.electronAPI!.kernelValidate(venvPath);
  },

  startServer: async (venvPath: string, workspaceRoot: string) => {
    if (_startPromise) return _startPromise;
    _startPromise = window.electronAPI!.kernelStart(venvPath, workspaceRoot)
      .finally(() => { _startPromise = null; });
    return _startPromise;
  },

  stopServer: async () => {
    return window.electronAPI!.kernelStop();
  },

  createSession: async (notebookPath: string, kernelName: string = 'python3') => {
    return window.electronAPI!.kernelProxyRest(
      'POST',
      '/api/sessions',
      { path: notebookPath, type: 'notebook', kernel: { name: kernelName } },
    ) as Promise<KernelSession>;
  },

  closeSession: async (sessionId: string) => {
    await window.electronAPI!.kernelProxyRest('DELETE', `/api/sessions/${sessionId}`, null);
  },

  interruptKernel: async (kernelId: string) => {
    await window.electronAPI!.kernelProxyRest('POST', `/api/kernels/${kernelId}/interrupt`, null);
  },

  restartKernel: async (kernelId: string) => {
    return window.electronAPI!.kernelProxyRest('POST', `/api/kernels/${kernelId}/restart`, null);
  },

  // Electron: frontend gets a direct ws:// URL to the local Jupyter server (token included)
  getChannelUrl: async (kernelId: string) => {
    return window.electronAPI!.kernelGetChannelUrl(kernelId);
  },
};

// ---------------------------------------------------------------------------
// Unified API — select runtime at module load
// ---------------------------------------------------------------------------
const _impl: KernelImpl = isElectron() ? electronKernel : browserKernel;

const kernelService: KernelService = {
  // venv storage helpers
  getVenvPath: () => storageService.get(VENV_STORAGE_KEY),
  setVenvPath: (path: string) => storageService.set(VENV_STORAGE_KEY, path),

  // delegates to runtime impl
  validateVenv: (venvPath: string) => _impl.validateVenv(venvPath),
  startServer: (venvPath: string, workspaceRoot: string) => _impl.startServer(venvPath, workspaceRoot),
  stopServer: () => _impl.stopServer(),
  createSession: (notebookPath: string, kernelName?: string) => _impl.createSession(notebookPath, kernelName),
  closeSession: (sessionId: string) => _impl.closeSession(sessionId),
  interruptKernel: (kernelId: string) => _impl.interruptKernel(kernelId),
  restartKernel: (kernelId: string) => _impl.restartKernel(kernelId),
  getChannelUrl: (kernelId: string) => _impl.getChannelUrl(kernelId),
};

export default kernelService;
export { isElectron };
