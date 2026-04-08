function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.storageGet);
}

export interface StorageService {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

const electronStorage: StorageService = {
  get: (key: string) => window.electronAPI!.storageGet(key),
  set: (key: string, value: unknown) => window.electronAPI!.storageSet(key, value),
};

const browserStorage: StorageService = {
  get: (key: string) => {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(key)!));
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e: unknown) {
      // Degrade silently on QuotaExceededError (localStorage is full)
      if (e instanceof DOMException && e.name === 'QuotaExceededError') return Promise.resolve();
      return Promise.reject(e);
    }
    return Promise.resolve();
  },
};

export const isElectronRuntime = isElectron;

const storageService: StorageService = isElectron() ? electronStorage : browserStorage;
export default storageService;
