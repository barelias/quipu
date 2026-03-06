import { useState, useCallback, useRef, useEffect } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const ExcalidrawViewer = ({ content, filePath, onContentChange }) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const initialDataRef = useRef(null);
  const changeCountRef = useRef(0);
  const debounceRef = useRef(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Parse initial data from file content (only once per file)
  if (!initialDataRef.current && content) {
    try {
      const parsed = JSON.parse(content);
      initialDataRef.current = {
        elements: parsed.elements || [],
        appState: {
          ...parsed.appState,
          collaborators: [],
        },
        files: parsed.files || undefined,
      };
    } catch {
      initialDataRef.current = { elements: [], appState: {} };
    }
  }

  const handleChange = useCallback((elements, appState, files) => {
    // Skip the first 2 onChange calls (Excalidraw initialization)
    if (changeCountRef.current < 2) {
      changeCountRef.current++;
      return;
    }

    // Debounce to avoid excessive state updates
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const json = serializeAsJSON(elements, appState, files, 'local');
      onContentChangeRef.current?.(json);
    }, 300);
  }, []);

  // Reset when file changes
  useEffect(() => {
    initialDataRef.current = null;
    changeCountRef.current = 0;
  }, [filePath]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={initialDataRef.current}
        onChange={handleChange}
        theme="dark"
      />
    </div>
  );
};

export default ExcalidrawViewer;
