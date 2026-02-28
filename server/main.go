package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for dev
	},
}

type WindowSize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// File system types
type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type WriteFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CreateFolderRequest struct {
	Path string `json:"path"`
}

type RenameRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

// CORS middleware
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// GET /files?path=<dir>
func handleListFiles(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	// Resolve to absolute path
	absPath, err := filepath.Abs(dirPath)
	if err != nil {
		jsonError(w, "invalid path", http.StatusBadRequest)
		return
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var files []FileEntry
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		files = append(files, FileEntry{
			Name:        e.Name(),
			Path:        filepath.Join(absPath, e.Name()),
			IsDirectory: e.IsDir(),
		})
	}

	// Sort: directories first, then alphabetical
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDirectory != files[j].IsDirectory {
			return files[i].IsDirectory
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	jsonResponse(w, files)
}

// GET /file?path=<file>
func handleReadFile(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(content)
}

// POST /file  { path, content }
func handleWriteFile(w http.ResponseWriter, r *http.Request) {
	var req WriteFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(req.Path, []byte(req.Content), 0644); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// DELETE /file?path=<path>
func handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		jsonError(w, "path parameter required", http.StatusBadRequest)
		return
	}

	info, err := os.Stat(targetPath)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if info.IsDir() {
		err = os.RemoveAll(targetPath)
	} else {
		err = os.Remove(targetPath)
	}

	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// POST /folder  { path }
func handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var req CreateFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(req.Path, 0755); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

// PUT /rename  { oldPath, newPath }
func handleRename(w http.ResponseWriter, r *http.Request) {
	var req RenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := os.Rename(req.OldPath, req.NewPath); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true})
}

func handleTerminal(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("upgrade:", err)
		return
	}
	defer c.Close()

	// Determine shell
	shell := "bash"
	if runtime.GOOS == "windows" {
		shell = "powershell.exe"
	}

	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// Start with a reasonable default size, but resize will handle the rest
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 30, Cols: 80})
	if err != nil {
		log.Print("pty start:", err)
		c.WriteMessage(websocket.TextMessage, []byte("Error starting PTY: "+err.Error()))
		return
	}
	defer func() { _ = ptmx.Close() }() // Best effort close

	// Resize logic
	go func() {
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				// Normal close
				return
			}

			// Check if it's a resize message (JSON) or raw input
			// Simple protocol: If starts with '{', try to parse as resize
			if len(message) > 0 && message[0] == '{' {
				var size WindowSize
				if err := json.Unmarshal(message, &size); err == nil {
					if err := pty.Setsize(ptmx, &pty.Winsize{Rows: uint16(size.Rows), Cols: uint16(size.Cols), X: 0, Y: 0}); err != nil {
						// Log but continue, resizing might fail if pty closed
					}
					continue
				}
			}

			// Otherwise treat as input
			if _, err := ptmx.Write(message); err != nil {
				return
			}
		}
	}()

	// Copy PTY output to WebSocket
	buf := make([]byte, 1024)
	for {
		n, err := ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Println("read from pty:", err)
			}
			break
		}
		if err = c.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
			log.Println("write to ws:", err)
			break
		}
	}
}

func main() {
	var addr = flag.String("addr", "localhost:3000", "http service address")
	flag.Parse()
	log.SetFlags(0)

	// File system endpoints
	http.HandleFunc("/files", corsMiddleware(handleListFiles))
	http.HandleFunc("/file", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			handleReadFile(w, r)
		case "POST":
			handleWriteFile(w, r)
		case "DELETE":
			handleDeleteFile(w, r)
		default:
			jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	http.HandleFunc("/folder", corsMiddleware(handleCreateFolder))
	http.HandleFunc("/rename", corsMiddleware(handleRename))
	http.HandleFunc("/homedir", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "/"
		}
		jsonResponse(w, map[string]string{"path": home})
	}))

	// Terminal endpoint
	http.HandleFunc("/term", handleTerminal)

	log.Printf("Listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
