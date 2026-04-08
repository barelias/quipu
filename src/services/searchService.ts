import { SERVER_URL } from '../config.js';
import type { SearchOptions, SearchResult } from '../types/electron-api';

const GO_SERVER = SERVER_URL;

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.searchFiles);
}

export interface SearchService {
  search: (dirPath: string, query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  listFilesRecursive: (dirPath: string, limit?: number) => Promise<string[]>;
}

const electronSearch: SearchService = {
  search: (dirPath: string, query: string, options: SearchOptions = {}) => window.electronAPI!.searchFiles(dirPath, query, options),
  listFilesRecursive: (dirPath: string, limit: number = 5000) => window.electronAPI!.listFilesRecursive(dirPath, limit),
};

const browserSearch: SearchService = {
  search: async (dirPath: string, query: string, options: SearchOptions = {}) => {
    const params = new URLSearchParams({
      path: dirPath,
      q: query,
      regex: String(options.regex || false),
      caseSensitive: String(options.caseSensitive || false),
    });
    const res = await fetch(`${GO_SERVER}/search?${params}`);
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    return res.json();
  },
  listFilesRecursive: async (dirPath: string, limit: number = 5000) => {
    const res = await fetch(`${GO_SERVER}/files-recursive?path=${encodeURIComponent(dirPath)}&limit=${limit}`);
    if (!res.ok) throw new Error(`File listing failed: ${res.statusText}`);
    return res.json();
  },
};

const searchService: SearchService = isElectron() ? electronSearch : browserSearch;
export default searchService;
