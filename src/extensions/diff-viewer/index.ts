import type { ExtensionDescriptor } from '@/types/extensions';
import DiffViewer from './DiffViewer';

const descriptor: ExtensionDescriptor = {
  id: 'diff-viewer',
  canHandle(tab) { return !!(tab as unknown as Record<string, unknown>)?._isDiff; },
  priority: 100,
  component: DiffViewer,
};

export default descriptor;
