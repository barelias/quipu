import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import './FileExplorer.css';

function FileIcon({ name, isDirectory, isExpanded }) {
  if (isDirectory) {
    return <span className={`file-icon dir-arrow ${isExpanded ? 'dir-arrow-open' : ''}`} />;
  }
  if (name.endsWith('.quipu')) {
    return <span className="file-icon file-icon-quipu">Q</span>;
  }
  return <span className="file-icon file-icon-file" />;
}

function FileTreeItem({ entry, depth = 0 }) {
  const {
    activeFile,
    expandedFolders,
    toggleFolder,
    openFile,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
  } = useWorkspace();

  const [children, setChildren] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isCreating, setIsCreating] = useState(null); // 'file' | 'folder' | null
  const [createValue, setCreateValue] = useState('');
  const renameRef = useRef(null);
  const createRef = useRef(null);

  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFile && activeFile.path === entry.path;

  useEffect(() => {
    if (entry.isDirectory && isExpanded) {
      loadSubDirectory(entry.path).then(setChildren);
    }
  }, [entry.path, entry.isDirectory, isExpanded, loadSubDirectory]);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (isCreating && createRef.current) {
      createRef.current.focus();
    }
  }, [isCreating]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      toggleFolder(entry.path);
    } else {
      openFile(entry.path, entry.name);
    }
  }, [entry, toggleFolder, openFile]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [contextMenu, closeContextMenu]);

  const handleRenameStart = useCallback(() => {
    setRenameValue(entry.name);
    setIsRenaming(true);
    closeContextMenu();
  }, [entry.name, closeContextMenu]);

  const handleRenameSubmit = useCallback(() => {
    if (renameValue && renameValue !== entry.name) {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      renameEntry(entry.path, parentPath + '/' + renameValue);
    }
    setIsRenaming(false);
  }, [renameValue, entry, renameEntry]);

  const handleDelete = useCallback(() => {
    closeContextMenu();
    if (window.confirm(`Delete "${entry.name}"?`)) {
      deleteEntry(entry.path);
    }
  }, [entry, deleteEntry, closeContextMenu]);

  const handleNewFile = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('file');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleNewFolder = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('folder');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleCreateSubmit = useCallback(() => {
    if (createValue) {
      if (isCreating === 'file') {
        createNewFile(entry.path, createValue);
      } else {
        createNewFolder(entry.path, createValue);
      }
    }
    setIsCreating(null);
    setCreateValue('');
  }, [createValue, isCreating, entry.path, createNewFile, createNewFolder]);

  return (
    <div className="tree-item-wrapper">
      <div
        className={`tree-item ${isActive ? 'tree-item-active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} isExpanded={isExpanded} />
        {isRenaming ? (
          <input
            ref={renameRef}
            className="tree-item-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-item-name">{entry.name}</span>
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {entry.isDirectory && (
            <>
              <div className="context-menu-item" onClick={handleNewFile}>New File</div>
              <div className="context-menu-item" onClick={handleNewFolder}>New Folder</div>
              <div className="context-menu-separator" />
            </>
          )}
          <div className="context-menu-item" onClick={handleRenameStart}>Rename</div>
          <div className="context-menu-item context-menu-danger" onClick={handleDelete}>Delete</div>
        </div>
      )}

      {entry.isDirectory && isExpanded && (
        <div className="tree-children">
          {isCreating && (
            <div className="tree-item" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
              <span className={`file-icon ${isCreating === 'folder' ? 'dir-arrow' : 'file-icon-file'}`} />
              <input
                ref={createRef}
                className="tree-item-input"
                value={createValue}
                placeholder={isCreating === 'file' ? 'filename' : 'folder name'}
                onChange={(e) => setCreateValue(e.target.value)}
                onBlur={handleCreateSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSubmit();
                  if (e.key === 'Escape') { setIsCreating(null); setCreateValue(''); }
                }}
              />
            </div>
          )}
          {children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer() {
  const { workspacePath, fileTree, openFolder } = useWorkspace();

  return (
    <div className="file-explorer">
      <div className="explorer-header">
        <span className="explorer-title">EXPLORER</span>
      </div>

      {!workspacePath ? (
        <div className="explorer-empty">
          <p>No folder opened</p>
          <button className="open-folder-btn" onClick={openFolder}>
            Open Folder
          </button>
        </div>
      ) : (
        <div className="explorer-tree">
          <div className="explorer-workspace-header" onClick={openFolder}>
            <span className="workspace-name">{workspacePath.split('/').pop()}</span>
          </div>
          <div className="tree-scroll">
            {fileTree.map((entry) => (
              <FileTreeItem key={entry.path} entry={entry} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
