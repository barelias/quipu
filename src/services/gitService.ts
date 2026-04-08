import { SERVER_URL } from '../config.js';

const GO_SERVER = SERVER_URL;

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.gitStatus);
}

export interface GitService {
  status: (dirPath: string) => Promise<unknown>;
  diff: (dirPath: string, file: string, staged: boolean) => Promise<string>;
  stage: (dirPath: string, files: string[]) => Promise<unknown>;
  unstage: (dirPath: string, files: string[]) => Promise<unknown>;
  commit: (dirPath: string, message: string) => Promise<unknown>;
  push: (dirPath: string) => Promise<unknown>;
  pull: (dirPath: string) => Promise<unknown>;
  branches: (dirPath: string) => Promise<unknown>;
  checkout: (dirPath: string, branch: string) => Promise<unknown>;
  log: (dirPath: string) => Promise<unknown>;
}

const electronGit: GitService = {
  status: (dirPath: string) => window.electronAPI!.gitStatus(dirPath),
  diff: (dirPath: string, file: string, staged: boolean) => window.electronAPI!.gitDiff(dirPath, file, staged),
  stage: (dirPath: string, files: string[]) => window.electronAPI!.gitStage(dirPath, files),
  unstage: (dirPath: string, files: string[]) => window.electronAPI!.gitUnstage(dirPath, files),
  commit: (dirPath: string, message: string) => window.electronAPI!.gitCommit(dirPath, message),
  push: (dirPath: string) => window.electronAPI!.gitPush(dirPath),
  pull: (dirPath: string) => window.electronAPI!.gitPull(dirPath),
  branches: (dirPath: string) => window.electronAPI!.gitBranches(dirPath),
  checkout: (dirPath: string, branch: string) => window.electronAPI!.gitCheckout(dirPath, branch),
  log: (dirPath: string) => window.electronAPI!.gitLog(dirPath),
};

const browserGit: GitService = {
  status: async () => {
    const res = await fetch(`${GO_SERVER}/git/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  diff: async (_dirPath: string, file: string, staged: boolean = false) => {
    const params = new URLSearchParams();
    if (file) params.set('file', file);
    if (staged) params.set('staged', 'true');
    const res = await fetch(`${GO_SERVER}/git/diff?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  stage: async (_dirPath: string, files: string[]) => {
    const res = await fetch(`${GO_SERVER}/git/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  unstage: async (_dirPath: string, files: string[]) => {
    const res = await fetch(`${GO_SERVER}/git/unstage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  commit: async (_dirPath: string, message: string) => {
    const res = await fetch(`${GO_SERVER}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  push: async () => {
    const res = await fetch(`${GO_SERVER}/git/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  pull: async () => {
    const res = await fetch(`${GO_SERVER}/git/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  branches: async () => {
    const res = await fetch(`${GO_SERVER}/git/branches`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  checkout: async (_dirPath: string, branch: string) => {
    const res = await fetch(`${GO_SERVER}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  log: async () => {
    const res = await fetch(`${GO_SERVER}/git/log`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

const gitService: GitService = isElectron() ? electronGit : browserGit;
export default gitService;
