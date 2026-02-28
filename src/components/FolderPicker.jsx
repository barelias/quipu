import React, { useState, useEffect, useCallback } from 'react';
import fs from '../services/fileSystem';
import './FolderPicker.css';

export default function FolderPicker({ onSelect, onCancel }) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pathInput, setPathInput] = useState('');

  const loadDirectory = useCallback(async (dirPath) => {
    setLoading(true);
    try {
      const items = await fs.readDirectory(dirPath);
      // Only show directories in folder picker
      setEntries(items.filter(e => e.isDirectory));
      setCurrentPath(dirPath);
      setPathInput(dirPath);
    } catch (err) {
      console.error('Failed to load directory:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const home = await fs.getHomeDir();
      loadDirectory(home);
    })();
  }, [loadDirectory]);

  const goUp = useCallback(() => {
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    loadDirectory(parent);
  }, [currentPath, loadDirectory]);

  const handlePathSubmit = useCallback((e) => {
    e.preventDefault();
    if (pathInput.trim()) {
      loadDirectory(pathInput.trim());
    }
  }, [pathInput, loadDirectory]);

  return (
    <div className="folder-picker-overlay" onClick={onCancel}>
      <div className="folder-picker" onClick={(e) => e.stopPropagation()}>
        <div className="fp-header">
          <span className="fp-title">Open Folder</span>
          <button className="fp-close" onClick={onCancel}>&times;</button>
        </div>

        <form className="fp-path-bar" onSubmit={handlePathSubmit}>
          <input
            className="fp-path-input"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="fp-go-btn">Go</button>
        </form>

        <div className="fp-entries">
          <div className="fp-entry fp-entry-up" onClick={goUp}>
            <span className="fp-icon">..</span>
            <span className="fp-name">(parent directory)</span>
          </div>
          {loading ? (
            <div className="fp-loading">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="fp-empty">No subfolders</div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.path}
                className="fp-entry"
                onDoubleClick={() => loadDirectory(entry.path)}
              >
                <span className="fp-icon">{'\u25B8'}</span>
                <span className="fp-name">{entry.name}</span>
              </div>
            ))
          )}
        </div>

        <div className="fp-footer">
          <span className="fp-current">{currentPath}</span>
          <div className="fp-actions">
            <button className="fp-cancel" onClick={onCancel}>Cancel</button>
            <button className="fp-select" onClick={() => onSelect(currentPath)}>
              Select Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
