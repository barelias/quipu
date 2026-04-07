import { useMemo, useState, useEffect, useRef } from 'react';
import fs from '../../services/fileSystem';
import type { Tab } from '@/types/tab';

interface MediaViewerProps {
  tab: Tab;
}

const MediaViewer = ({ tab }: MediaViewerProps) => {
  const url = useMemo(() => fs.getFileUrl(tab.path), [tab.path]);
  const isImage = /\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(tab.name);
  const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(tab.name);
  const [zoom, setZoom] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(prev => {
        const delta = e.deltaY > 0 ? -10 : 10;
        return Math.min(400, Math.max(10, prev + delta));
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-auto bg-bg-surface p-8"
    >
      {isImage && (
        <img
          src={url}
          alt={tab.name}
          className="object-contain rounded shadow-md"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'center center',
          }}
        />
      )}
      {isVideo && (
        <video
          src={url}
          controls
          className="max-w-full max-h-[80vh] rounded shadow-md"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'center center',
          }}
        />
      )}
    </div>
  );
};

export default MediaViewer;
