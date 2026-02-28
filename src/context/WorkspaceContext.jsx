import React, { createContext, useContext, useState, useCallback } from 'react';
import fs from '../services/fileSystem';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [workspacePath, setWorkspacePath] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const openFolder = useCallback(async () => {
    // Try native dialog first (Electron)
    const folderPath = await fs.openFolderDialog();
    if (folderPath) {
      selectFolder(folderPath);
    } else {
      // Native dialog failed or unavailable — show in-app picker
      setShowFolderPicker(true);
    }
  }, []);

  const selectFolder = useCallback(async (folderPath) => {
    setShowFolderPicker(false);
    setWorkspacePath(folderPath);
    setActiveFile(null);
    setIsDirty(false);
    setExpandedFolders(new Set());
    try {
      const entries = await fs.readDirectory(folderPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to read directory:', err);
    }
  }, []);

  const cancelFolderPicker = useCallback(() => {
    setShowFolderPicker(false);
  }, []);

  const refreshDirectory = useCallback(async (dirPath) => {
    if (!dirPath) return;
    try {
      const entries = await fs.readDirectory(dirPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to refresh directory:', err);
    }
  }, []);

  const loadSubDirectory = useCallback(async (dirPath) => {
    try {
      return await fs.readDirectory(dirPath);
    } catch (err) {
      console.error('Failed to load subdirectory:', err);
      return [];
    }
  }, []);

  const toggleFolder = useCallback((folderPath) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const openFile = useCallback(async (filePath, fileName) => {
    try {
      const content = await fs.readFile(filePath);
      const isQuipu = fileName.endsWith('.quipu');

      let parsedContent = null;
      if (isQuipu) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'quipu' && parsed.content) {
            parsedContent = parsed.content;
          }
        } catch {
          // Not valid quipu JSON, treat as text
        }
      }

      setActiveFile({
        path: filePath,
        name: fileName,
        content: isQuipu && parsedContent ? parsedContent : content,
        isQuipu: isQuipu && !!parsedContent,
      });
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  const saveFile = useCallback(async (editorInstance) => {
    if (!activeFile || !editorInstance) return;

    let content;
    if (activeFile.isQuipu || activeFile.name.endsWith('.quipu')) {
      content = JSON.stringify({
        type: 'quipu',
        version: 1,
        content: editorInstance.getJSON(),
        metadata: {
          savedAt: new Date().toISOString(),
        },
      }, null, 2);
    } else {
      content = editorInstance.getText();
    }

    try {
      await fs.writeFile(activeFile.path, content);
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [activeFile]);

  const createNewFile = useCallback(async (parentPath, name) => {
    const filePath = parentPath + '/' + name;
    try {
      await fs.createFile(filePath);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  }, [workspacePath, refreshDirectory]);

  const createNewFolder = useCallback(async (parentPath, name) => {
    const folderPath = parentPath + '/' + name;
    try {
      await fs.createFolder(folderPath);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  }, [workspacePath, refreshDirectory]);

  const deleteEntry = useCallback(async (targetPath) => {
    try {
      await fs.deletePath(targetPath);
      if (activeFile && activeFile.path === targetPath) {
        setActiveFile(null);
        setIsDirty(false);
      }
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }, [workspacePath, activeFile, refreshDirectory]);

  const renameEntry = useCallback(async (oldPath, newPath) => {
    try {
      await fs.renamePath(oldPath, newPath);
      if (activeFile && activeFile.path === oldPath) {
        setActiveFile(prev => ({ ...prev, path: newPath, name: newPath.split('/').pop() }));
      }
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  }, [workspacePath, activeFile, refreshDirectory]);

  const value = {
    workspacePath,
    fileTree,
    activeFile,
    isDirty,
    expandedFolders,
    showFolderPicker,
    openFolder,
    selectFolder,
    cancelFolderPicker,
    openFile,
    saveFile,
    setIsDirty,
    toggleFolder,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    refreshDirectory,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
