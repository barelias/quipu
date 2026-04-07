import type { ExtensionDescriptor } from '@/types/extensions';
import MediaViewer from './MediaViewer';

const descriptor: ExtensionDescriptor = {
  id: 'media-viewer',
  canHandle(tab) { return !!tab?.isMedia; },
  priority: 10,
  component: MediaViewer,
};

export default descriptor;
