import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';

const ExcalidrawViewer = ({ content, activeTabId, onDirtyChange, onSaveRequest }) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const isInitialLoadRef = useRef(true);
  const sceneDataRef = useRef(null);

  // Parse the initial scene data from the file content
  const initialData = useMemo(() => {
    if (!content) {
      return { elements: [], appState: {}, files: {} };
    }
    try {
      const parsed = JSON.parse(content);
      // Store the full parsed data so we can preserve unknown fields on save
      sceneDataRef.current = parsed;
      return {
        elements: parsed.elements || [],
        appState: {
          ...(parsed.appState || {}),
          // Ensure the component is not in collaboration mode
          isCollaborating: false,
        },
        files: parsed.files || {},
      };
    } catch {
      return { elements: [], appState: {}, files: {} };
    }
  }, [content]);

  // Handle scene changes — mark as dirty
  const handleChange = useCallback((elements, appState, files) => {
    // Skip the initial onChange fired by Excalidraw on mount
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    // Update scene data ref for saving
    const original = sceneDataRef.current || {};
    sceneDataRef.current = {
      ...original,
      type: original.type || 'excalidraw',
      version: original.version || 2,
      source: original.source || 'https://excalidraw.com',
      elements,
      appState: {
        ...appState,
        // Strip ephemeral UI state that shouldn't be persisted
        collaborators: undefined,
        isCollaborating: undefined,
        openPopup: undefined,
      },
      files: files || {},
    };

    onDirtyChange(true);
  }, [onDirtyChange]);

  // Expose save handler: returns the current scene data for the parent to save
  const handleSave = useCallback(() => {
    if (!sceneDataRef.current) return null;
    return sceneDataRef.current;
  }, []);

  // Register the save handler with the parent via the onSaveRequest ref
  useEffect(() => {
    if (onSaveRequest) {
      onSaveRequest.current = handleSave;
    }
  }, [handleSave, onSaveRequest]);

  // Reset initial load flag when switching tabs
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [activeTabId]);

  return (
    <div className="flex-1 w-full h-full overflow-hidden">
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
};

export default ExcalidrawViewer;
