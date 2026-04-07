import type { ExtensionDescriptor } from '@/types/extensions';
import { isMermaidFile } from '@/utils/fileTypes';
import MermaidViewer from './MermaidViewer';

const descriptor: ExtensionDescriptor = {
  id: 'mermaid-viewer',
  canHandle(tab, activeFile) { return isMermaidFile(activeFile?.name ?? ''); },
  priority: 10,
  component: MermaidViewer,
};

export default descriptor;
