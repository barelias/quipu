import type { ExtensionDescriptor } from '@/types/extensions';
import PdfViewer from './PdfViewer.jsx';

const descriptor: ExtensionDescriptor = {
  id: 'pdf-viewer',
  canHandle(tab) { return !!tab?.isPdf; },
  priority: 10,
  component: PdfViewer,
};

export default descriptor;
