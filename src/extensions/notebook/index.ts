import type { ExtensionDescriptor } from '@/types/extensions';
import { isNotebookFile } from '@/utils/fileTypes';
import NotebookViewer from './NotebookViewer';

const descriptor: ExtensionDescriptor = {
  id: 'notebook-viewer',
  canHandle(tab, activeFile) { return isNotebookFile(activeFile?.name ?? ''); },
  priority: 10,
  component: NotebookViewer,
};

export default descriptor;
