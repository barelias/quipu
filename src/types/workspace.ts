export interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeEntry[];
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: string;
}

export type ToastType = 'error' | 'warning' | 'success' | 'info';
