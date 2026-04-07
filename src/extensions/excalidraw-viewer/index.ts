import type { ExtensionDescriptor } from '@/types/extensions';
import { isExcalidrawFile } from '@/utils/fileTypes';
import ExcalidrawViewer from './ExcalidrawViewer';

const descriptor: ExtensionDescriptor = {
  id: 'excalidraw-viewer',
  canHandle(tab, activeFile) { return isExcalidrawFile(activeFile?.name ?? ''); },
  priority: 10,
  component: ExcalidrawViewer,
};

export default descriptor;
