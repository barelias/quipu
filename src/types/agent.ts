export interface AgentBinding {
  id: string;
  source: 'workspace' | 'repo';
  /** repo id when source === 'repo'; undefined when source === 'workspace' */
  repoId?: string;
  /** path relative to the binding source root */
  subpath: string;
  /** prose telling the agent why this context matters */
  documentation: string;
}

export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'auto' | 'plan';

export type AgentKind = 'agent' | 'chat';

export interface Agent {
  id: string;
  name: string;
  /**
   * Filesystem slug used to derive the on-disk filename for this agent
   * (e.g. `frame-responder` -> `frame-responder.json`). Required as of
   * Unit 6: AgentContext computes the canonical id from `folder + '/' + slug`
   * and routes saves through `agentFileStore`, which uses this directly
   * for the on-disk filename. Mutators auto-derive a slug from the
   * agent's name when one isn't explicitly supplied — no callsite should
   * need to slugify by hand.
   */
  slug: string;
  /** 'agent' = full configuration, opens editor on create. 'chat' = lightweight, opens chat directly. */
  kind: AgentKind;
  systemPrompt: string;
  model: string;
  bindings: AgentBinding[];
  permissionMode: AgentPermissionMode;
  /** Optional grouping folder shown in the Agents panel. */
  folder?: string;
  /**
   * Optional whitelist of tools the agent is allowed to use. Empty = rely on
   * permissionMode. Entries are Claude Code tool specifiers, e.g. "Read",
   * "Bash(git *)", "Edit".
   */
  allowedTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'error' | 'permission-request';

export type AgentPermissionStatus = 'pending' | 'allowed' | 'denied';

export interface AgentImageAttachment {
  id: string;
  /** image/png, image/jpeg, image/webp, image/gif */
  mediaType: string;
  /** Raw base64 payload (no data:URL prefix). */
  base64: string;
  /** Optional display name for the attachment chip. */
  name?: string;
}

export interface AgentPermissionRequest {
  /** Tool use id from Claude's stream-json — used to correlate the response. */
  toolUseId: string;
  toolName: string;
  /** Action verb shown bold (e.g. "Read", "Edit", "Bash"). */
  action: string;
  /** Short path display. */
  path?: string;
  /** Freeform detail (e.g. command). */
  detail?: string;
  /** Original raw input for diff/question rendering. */
  input?: Record<string, unknown>;
  status: AgentPermissionStatus;
  decidedAt?: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  /** Action verb shown bold (e.g. "Read", "Edit", "Bash"). */
  action: string;
  /** Short path display — relative when possible, filename when too long. */
  path?: string;
  /** Freeform detail (e.g. a bash command or grep pattern). */
  detail?: string;
  /** Original raw input for expandable/diff renderings. */
  input?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  body: string;
  createdAt: string;
  /** partial while streaming, final when complete */
  streaming?: boolean;
  /** Tool uses the assistant invoked during this turn (assistant role only). */
  toolCalls?: AgentToolCall[];
  /** Populated when role === 'permission-request'. */
  permissionRequest?: AgentPermissionRequest;
  /** Images the user attached to their turn (user role). */
  attachments?: AgentImageAttachment[];
}

export interface AgentSession {
  agentId: string;
  /** Claude session id returned by the CLI; used for --resume on subsequent turns */
  claudeSessionId?: string;
  messages: AgentMessage[];
  updatedAt: string;
}

export interface Repo {
  id: string;
  name: string;
  /**
   * Filesystem slug used to derive the on-disk filename for this repo
   * (e.g. `quipu` -> `quipu.json`). Optional during the file-store
   * transition (Units 1-6): the file store always populates it on load,
   * but legacy in-memory callsites may construct a Repo without one.
   * Unit 7 promotes this to required and folds it into the canonical id.
   */
  slug?: string;
  url: string;
  folder?: string;
  localClonePath?: string;
  createdAt: string;
  updatedAt: string;
}
