import { useState, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { cn } from '@/lib/utils';
import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from '@phosphor-icons/react';
import fs from '../services/fileSystem';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PdfViewer = ({ filePath, fileName }) => {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);

  const fileUrl = useMemo(() => fs.getFileUrl(filePath), [filePath]);

  const handleLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const handlePrevPage = useCallback(() => {
    setPageNumber(prev => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  }, [numPages]);

  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(3, prev + 0.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(0.4, prev - 0.2));
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 bg-bg-elevated border-b border-border">
        <button
          onClick={handlePrevPage}
          disabled={pageNumber <= 1}
          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 text-text-secondary"
        >
          <CaretLeftIcon size={18} />
        </button>
        <span className="text-sm text-text-secondary">
          {pageNumber} / {numPages || '...'}
        </span>
        <button
          onClick={handleNextPage}
          disabled={pageNumber >= (numPages || 1)}
          className="p-1 rounded hover:bg-white/[0.06] disabled:opacity-30 text-text-secondary"
        >
          <CaretRightIcon size={18} />
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={handleZoomOut}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassMinusIcon size={18} />
        </button>
        <span className="text-xs text-text-tertiary w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"
        >
          <MagnifyingGlassPlusIcon size={18} />
        </button>
      </div>

      {/* PDF content */}
      <div className="flex-1 overflow-auto flex justify-center py-6">
        <Document
          file={fileUrl}
          onLoadSuccess={handleLoadSuccess}
          loading={
            <div className="text-text-tertiary text-sm">Loading PDF...</div>
          }
          error={
            <div className="text-error text-sm">Failed to load PDF</div>
          }
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            className="shadow-lg"
          />
        </Document>
      </div>
    </div>
  );
};

export default PdfViewer;
