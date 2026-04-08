import type { ExtensionDescriptor } from '@/types/extensions';
import { isNotebookFile } from '@/utils/fileTypes';
import NotebookViewer from './NotebookViewer';

const descriptor: ExtensionDescriptor = {
  id: 'notebook-viewer',
  canHandle(tab, activeFile) { return isNotebookFile(activeFile?.name ?? ''); },
  priority: 10,
  component: NotebookViewer,
  commands: [
    {
      id: 'kernel.runAll',
      label: 'Run All Cells',
      handler: () => {
        window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.runAll' }));
      },
    },
    {
      id: 'kernel.interrupt',
      label: 'Interrupt Kernel',
      handler: () => {
        window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.interrupt' }));
      },
    },
    {
      id: 'kernel.restart',
      label: 'Restart Kernel',
      handler: () => {
        window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.restart' }));
      },
    },
  ],
};

export default descriptor;
