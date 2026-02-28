const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const pty = require('node-pty');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // electron-squirrel-startup not available outside of Squirrel installer context
}

let mainWindow;
let ptyProcess;

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        titleBarStyle: 'hiddenInset', // Mac style, looks premium
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        backgroundColor: '#ffffff', // Start white, can change
    });

    // Load the index.html of the app.
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        // Open the DevTools.
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
    createWindow();

    // Setup File System IPC
    ipcMain.handle('open-folder-dialog', async () => {
        // Try native dialog first
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            if (result.canceled) return null;
        } catch (e) {
            // Native dialog failed (common on WSL), fall through
        }
        // Return null — the renderer will use its built-in folder picker
        return null;
    });

    ipcMain.handle('get-home-dir', async () => {
        return os.homedir();
    });

    ipcMain.handle('read-directory', async (event, dirPath) => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries
            .filter(e => !e.name.startsWith('.'))
            .map(e => ({
                name: e.name,
                path: path.join(dirPath, e.name),
                isDirectory: e.isDirectory(),
            }))
            .sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    });

    ipcMain.handle('read-file', async (event, filePath) => {
        return fs.promises.readFile(filePath, 'utf-8');
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
    });

    ipcMain.handle('create-file', async (event, filePath) => {
        await fs.promises.writeFile(filePath, '', 'utf-8');
        return { success: true };
    });

    ipcMain.handle('create-folder', async (event, folderPath) => {
        await fs.promises.mkdir(folderPath, { recursive: true });
        return { success: true };
    });

    ipcMain.handle('rename-path', async (event, oldPath, newPath) => {
        await fs.promises.rename(oldPath, newPath);
        return { success: true };
    });

    ipcMain.handle('delete-path', async (event, targetPath) => {
        const stat = await fs.promises.stat(targetPath);
        if (stat.isDirectory()) {
            await fs.promises.rm(targetPath, { recursive: true });
        } else {
            await fs.promises.unlink(targetPath);
        }
        return { success: true };
    });

    // Search files using ripgrep with grep fallback
    ipcMain.handle('search-files', async (event, dirPath, query, options = {}) => {
        const maxResults = 500;
        const isRegex = options.regex || false;
        const isCaseSensitive = options.caseSensitive || false;

        const parseOutput = (stdout) => {
            const lines = stdout.split('\n').filter(l => l.trim());
            const results = [];
            let truncated = false;

            for (const line of lines) {
                if (results.length >= maxResults) {
                    truncated = true;
                    break;
                }
                // Format: file:line:text
                const firstColon = line.indexOf(':');
                if (firstColon < 0) continue;
                const rest = line.slice(firstColon + 1);
                const secondColon = rest.indexOf(':');
                if (secondColon < 0) continue;

                const filePath = line.slice(0, firstColon);
                const lineNum = parseInt(rest.slice(0, secondColon), 10);
                const text = rest.slice(secondColon + 1);

                if (isNaN(lineNum)) continue;

                const relPath = path.relative(dirPath, filePath);
                results.push({ file: relPath, line: lineNum, text: text.trimEnd() });
            }

            return { results, truncated };
        };

        // Try ripgrep first
        try {
            const result = await new Promise((resolve, reject) => {
                const args = [
                    '--no-heading', '--line-number', '--color', 'never',
                    '--max-count', String(maxResults),
                ];
                if (!isCaseSensitive) args.push('--ignore-case');
                if (!isRegex) args.push('--fixed-strings');
                ['node_modules', '.git', 'build', 'dist'].forEach(d => {
                    args.push('--glob', '!' + d);
                });
                args.push(query, dirPath);

                execFile('rg', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                    if (err && err.code === 1) {
                        // No matches
                        resolve({ results: [], truncated: false });
                    } else if (err) {
                        reject(err);
                    } else {
                        resolve(parseOutput(stdout));
                    }
                });
            });
            return result;
        } catch {
            // Fallback to grep
        }

        // Grep fallback
        return new Promise((resolve, reject) => {
            const args = ['-rn', '--color=never'];
            if (!isCaseSensitive) args.push('-i');
            if (!isRegex) args.push('-F');
            ['node_modules', '.git', 'build', 'dist'].forEach(d => {
                args.push('--exclude-dir=' + d);
            });
            args.push(query, dirPath);

            execFile('grep', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err && err.code === 1) {
                    resolve({ results: [], truncated: false });
                } else if (err) {
                    reject(err);
                } else {
                    resolve(parseOutput(stdout));
                }
            });
        });
    });

    // List all files recursively
    ipcMain.handle('list-files-recursive', async (event, dirPath, limit = 5000) => {
        const excludeDirs = new Set(['node_modules', '.git', 'build', 'dist']);
        const files = [];
        let truncated = false;

        const walk = async (dir) => {
            if (truncated) return;
            let entries;
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (truncated) break;

                // Skip hidden entries and excluded dirs
                if (entry.name.startsWith('.')) continue;
                if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;

                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    if (files.length >= limit) {
                        truncated = true;
                        break;
                    }
                    files.push({
                        path: path.relative(dirPath, fullPath),
                        name: entry.name,
                    });
                }
            }
        };

        await walk(dirPath);
        return { files, truncated };
    });

    let watcher = null;
    ipcMain.handle('watch-directory', async (event, dirPath) => {
        if (watcher) {
            watcher.close();
            watcher = null;
        }
        if (!dirPath) return { success: true };
        try {
            watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('directory-changed', { eventType, filename });
                }
            });
        } catch (err) {
            // fs.watch with recursive may not be supported everywhere
            console.warn('Directory watch failed:', err.message);
        }
        return { success: true };
    });

    // Setup Terminal IPC
    ipcMain.on('terminal-create', (event, options) => {
        const shell = process.env[os.platform() === 'win32' ? 'COMSPEC' : 'SHELL'];

        if (ptyProcess) {
            ptyProcess.kill();
        }

        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: process.env.HOME,
            env: process.env
        });

        ptyProcess.on('data', function (data) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('terminal-incoming', data);
            }
        });
    });

    ipcMain.on('terminal-write', (event, data) => {
        if (ptyProcess) {
            ptyProcess.write(data);
        }
    });

    ipcMain.on('terminal-resize', (event, { cols, rows }) => {
        if (ptyProcess) {
            ptyProcess.resize(cols, rows);
        }
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
