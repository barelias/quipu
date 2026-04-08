import type { ExtensionDescriptor } from '@/types/extensions';
import { isCodeFile } from '@/utils/fileTypes';
import CodeViewer from './CodeViewer';

const descriptor: ExtensionDescriptor = {
  id: 'code-viewer',
  canHandle(tab, activeFile) {
    return isCodeFile(activeFile?.name ?? '') && !activeFile?.isQuipu;
  },
  priority: 5,
  component: CodeViewer,
  onSave: async (tab) => {
    return typeof tab.content === 'string' ? tab.content : null;
  },
};

export default descriptor;
