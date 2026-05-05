import type { JSONContent } from '@tiptap/react';

export interface Frontmatter {
  [key: string]: unknown;
}

export interface Tab {
  id: string;
  /** Virtual tab type — 'diff' for diff overlay tabs; undefined for file tabs */
  type?: string;
  /**
   * Tab identity.
   *
   * - For file tabs, `path` is the absolute on-disk path.
   * - For synthetic tabs (`type` ∈ `'agent' | 'agent-editor' | 'repo-editor'`),
   *   `path` is `<type>://<id>`. For agents and chats, `<id>` is the
   *   folder-relative slug-path (`folder/slug`, or just `slug` at root) —
   *   the same id derived by the `agentFileStore` from the on-disk file
   *   layout. Renaming or moving an agent changes its id; AgentContext
   *   updates any matching tab's `path` via `renameTabPath` so the tab
   *   keeps pointing at the live file rather than a stale id.
   * - The legacy UUID-based `agent://<uuid>` scheme is gone: persisted
   *   sessions referencing UUIDs are dropped on hydrate by AgentContext
   *   when the id no longer resolves to a loaded agent.
   */
  path: string;
  name: string;
  content: string | JSONContent | null;
  tiptapJSON: JSONContent | null;
  isDirty: boolean;
  isQuipu: boolean;
  isMarkdown: boolean;
  isMedia?: boolean;
  isPdf?: boolean;
  isNotebook?: boolean;
  scrollPosition: number;
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  diskContent: string | null;
  frontmatterCollapsed: boolean;
  hasConflict?: boolean;
  conflictDiskContent?: string | null;
  reloadKey?: number;
}

export interface ActiveFile {
  path: string;
  name: string;
  content: string | JSONContent | null;
  isQuipu: boolean;
}
