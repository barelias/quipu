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
};

export default descriptor;
