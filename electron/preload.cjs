const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Terminal
    createTerminal: () => ipcRenderer.send('terminal-create'),
    onTerminalData: (callback) => ipcRenderer.on('terminal-incoming', (event, data) => callback(data)),
    writeTerminal: (data) => ipcRenderer.send('terminal-write', data),
    resizeTerminal: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),
    removeTerminalListener: () => ipcRenderer.removeAllListeners('terminal-incoming'),

    // File system
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath) => ipcRenderer.invoke('create-file', filePath),
    createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
    renamePath: (oldPath, newPath) => ipcRenderer.invoke('rename-path', oldPath, newPath),
    deletePath: (targetPath) => ipcRenderer.invoke('delete-path', targetPath),
    watchDirectory: (dirPath) => ipcRenderer.invoke('watch-directory', dirPath),
    onDirectoryChanged: (callback) => ipcRenderer.on('directory-changed', (event, data) => callback(data)),
    removeDirectoryListener: () => ipcRenderer.removeAllListeners('directory-changed'),
});
