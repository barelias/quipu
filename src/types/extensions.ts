import type { ComponentType } from 'react';
import type { Tab, ActiveFile } from './tab';
import type { Editor } from '@tiptap/react';

export interface ExtensionCommand {
  id: string;
  label: string;
  handler: (...args: unknown[]) => void;
}

export interface ExtensionDescriptor {
  id: string;
  canHandle: (tab: Tab, activeFile: ActiveFile | null) => boolean;
  priority: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  commands?: ExtensionCommand[];
  onSave?: (tab: Tab, editorInstance: Editor | null) => Promise<string | null>;
  onSnapshot?: (tab: Tab, editorInstance: Editor | null) => unknown;
}
