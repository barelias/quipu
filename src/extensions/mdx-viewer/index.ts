import type { ExtensionDescriptor } from '@/types/extensions';
import { isMdxFile } from '@/utils/fileTypes';
import MdxViewer from './MdxViewer';

const descriptor: ExtensionDescriptor = {
  id: 'mdx-viewer',
  canHandle(tab) {
    return isMdxFile(tab.name);
  },
  priority: 10,
  component: MdxViewer,
  onSave: async (tab) => {
    return typeof tab.content === 'string' ? tab.content : null;
  },
};

export default descriptor;
