/**
 * Extension registry — maps file types to viewer components.
 *
 * Core code imports only from this module, never from individual extensions.
 * Extensions register themselves via registerExtension() at app startup.
 */

import type { ComponentType } from 'react';
import type { ExtensionDescriptor } from '@/types/extensions';
import type { Tab, ActiveFile } from '@/types/tab';

const extensions: ExtensionDescriptor[] = [];

export function registerExtension(descriptor: ExtensionDescriptor): void {
  extensions.push(descriptor);
  extensions.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns the React component that should render the given tab,
 * or null if no extension matches (fall back to Editor).
 */
export function resolveViewer(tab: Tab, activeFile: ActiveFile | null): ComponentType<Record<string, unknown>> | null {
  for (const ext of extensions) {
    if (ext.canHandle(tab, activeFile)) return ext.component;
  }
  return null;
}

export function getRegisteredExtensions(): ExtensionDescriptor[] {
  return [...extensions];
}
