package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

const engineName = "herdr-codebench-go"
const maxBody = 8 << 20

type engineState struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
	Engine  string `json:"engine"`
	Version string `json:"version"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "herdr-engine:", err)
		os.Exit(1)
	}
}
func run() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	port := flag.Int("port", 47822, "localhost HTTP port (0 chooses an available port)")
	statePath := flag.String("state", filepath.Join(home, ".cache", "herdr-codenav", "engine.json"), "private engine state file")
	configPath := flag.String("config", "", "language server configuration JSON (required)")
	showVersion := flag.Bool("version", false, "print engine version")
	flag.Parse()
	if *showVersion {
		fmt.Printf("%s %s %s/%s\n", engineName, version, runtime.GOOS, runtime.GOARCH)
		return nil
	}
	if *port < 0 || *port > 65535 {
		return errors.New("port must be between 0 and 65535")
	}
	if *configPath == "" {
		return errors.New("--config is required")
	}
	e, err := NewEngine(*configPath, filepath.Dir(*statePath))
	if err != nil {
		return err
	}
	defer e.Close()
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(*port)))
	if err != nil {
		return err
	}
	defer listener.Close()
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return err
	}
	token := hex.EncodeToString(secret)
	state := engineState{os.Getpid(), listener.Addr().(*net.TCPAddr).Port, token, engineName, version}
	if err = writeState(*statePath, state); err != nil {
		return err
	}
	defer removeOwnedState(*statePath, token)
	server := &http.Server{Handler: e.Handler(token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 130 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				if e.reap(now) {
					cancel()
					return
				}
			}
		}
	}()
	go func() {
		<-ctx.Done()
		timeout, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = server.Shutdown(timeout)
	}()
	err = server.Serve(listener)
	cancel()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func writeState(path string, state engineState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".engine-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func removeOwnedState(path, token string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var state engineState
	if json.Unmarshal(b, &state) == nil && state.Token == token && state.PID == os.Getpid() {
		_ = os.Remove(path)
	}
}
func loopbackHost(host string) bool {
	name := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		name = h
	}
	name = strings.Trim(name, "[]")
	if strings.EqualFold(name, "localhost") {
		return true
	}
	ip := net.ParseIP(name)
	return ip != nil && ip.IsLoopback()
}
func envelope(w http.ResponseWriter, status int, result any, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	var body any
	if err != nil {
		body = map[string]any{"ok": false, "error": err.Error()}
	} else {
		body = map[string]any{"ok": true, "result": result}
	}
	_ = json.NewEncoder(w).Encode(body)
}
func (e *Engine) Handler(token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.Header.Values("Origin")) > 0 || !loopbackHost(r.Host) {
			envelope(w, http.StatusForbidden, nil, errors.New("local requests only"))
			return
		}
		supplied := r.Header.Get("X-Codenav-Token")
		if token == "" || subtle.ConstantTimeCompare([]byte(supplied), []byte(token)) != 1 {
			envelope(w, http.StatusUnauthorized, nil, errors.New("invalid engine token"))
			return
		}
		if r.Method != "POST" {
			envelope(w, http.StatusMethodNotAllowed, nil, errors.New("POST required"))
			return
		}
		route := strings.Trim(r.URL.Path, "/")
		if !knownRoute(route) {
			envelope(w, http.StatusNotFound, nil, errors.New("unknown engine endpoint"))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		defer r.Body.Close()
		var req Request
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&req); err != nil {
			status := http.StatusBadRequest
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				status = http.StatusRequestEntityTooLarge
			}
			envelope(w, status, nil, fmt.Errorf("invalid request: %w", err))
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			status := http.StatusBadRequest
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				status = http.StatusRequestEntityTooLarge
			}
			envelope(w, status, nil, errors.New("request must contain one JSON object"))
			return
		}
		if req.Line < 0 || req.Col < 0 {
			envelope(w, http.StatusBadRequest, nil, errors.New("line and col must be nonnegative"))
			return
		}
		e.mu.Lock()
		e.lastRequest = time.Now()
		e.mu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
		defer cancel()
		result, err := e.dispatch(ctx, route, req)
		envelope(w, http.StatusOK, result, err)
	})
}
func knownRoute(route string) bool {
	if databaseRoute(route) {
		return true
	}
	switch route {
	case "health", "status", "project_prepare", "project_status", "setup_status", "setup_start", "document_sync", "document_touch", "document_close", "tokens", "info", "hover", "definition", "references", "symbols", "diagnostics", "workspace_symbols", "related", "spring_markers", "spring_project", "completion", "completion_resolve", "formatting":
		return true
	}
	return false
}
func (e *Engine) status() []any {
	e.mu.Lock()
	all := make([]*LSPServer, 0, len(e.servers))
	for _, s := range e.servers {
		all = append(all, s)
	}
	e.mu.Unlock()
	out := []any{}
	for _, s := range all {
		s.mu.Lock()
		out = append(out, map[string]any{"lang": s.lang, "root": s.Root, "state": s.state, "error": s.err, "busy": lspBusy(s.progress), "command": filepath.Base(s.argv[0])})
		s.mu.Unlock()
	}
	return out
}
func lspBusy(progress map[string]string) []string {
	out := []string{}
	for _, title := range progress {
		out = append(out, title)
	}
	return out
}
func (e *Engine) info(path string) any {
	lang, c := e.language(path)
	library := e.library(path)
	if lang == "" || library {
		return map[string]any{"lang": nil, "library": library}
	}
	root := findRoot(path, c)
	argv, err := e.command(c, root)
	command := ""
	if err == nil {
		command = filepath.Base(argv[0])
	} else {
		names := []string{}
		for _, a := range c.Commands {
			if len(a) > 0 {
				names = append(names, a[0])
			}
		}
		command = strings.Join(names, " or ")
	}
	state := "not started"
	busy := []string{}
	e.mu.Lock()
	s := e.servers[lang+"\x00"+root]
	e.mu.Unlock()
	if s != nil {
		s.mu.Lock()
		state = s.state
		busy = lspBusy(s.progress)
		s.mu.Unlock()
	}
	return map[string]any{"lang": lang, "root": root, "installed": err == nil, "command": command, "state": state, "busy": busy}
}
func (e *Engine) dispatch(ctx context.Context, route string, req Request) (result any, failure error) {
	if databaseRoute(route) {
		if e.database == nil {
			return nil, errors.New("database manager unavailable")
		}
		return e.database.handle(ctx, route, req.Database)
	}
	if result, handled, err := e.libraryRequest(ctx, route, req); handled {
		return result, err
	}
	switch route {
	case "project_prepare":
		return e.prepareProject(req)
	case "project_status":
		return e.projectStatus(req)
	case "document_sync":
		return e.syncDocument(ctx, req)
	case "document_close":
		return e.closeDocument(ctx, req)
	case "document_touch":
		return e.touchDocument(req)
	case "health":
		return map[string]any{"pid": os.Getpid(), "started": e.started.Unix(), "engine": engineName, "version": version}, nil
	case "status":
		return e.status(), nil
	case "setup_status":
		return e.setupStatus(req)
	case "setup_start":
		return e.setupStart(ctx, req)
	case "info":
		if req.Path == "" {
			return nil, errors.New("path is required")
		}
		return e.info(req.Path), nil
	case "tokens":
		text := req.Text
		if text == nil {
			b, err := os.ReadFile(req.Path)
			if err != nil {
				return nil, err
			}
			v := strings.ToValidUTF8(string(b), "�")
			text = &v
		}
		return syntaxTokens(*text, req.Path), nil
	case "related":
		if req.Kind == "super" {
			break
		}
		if req.DocumentOwner != "" || req.Revision != nil {
			return nil, errors.New("buffered related navigation is not supported")
		}
		e.documentMu.Lock()
		path, _ := filepath.Abs(req.Path)
		_, leased := e.documents[path]
		e.documentMu.Unlock()
		// Spring's explicit-text analysis is pure: it never opens or replaces
		// an LSP document. Preserve that contract for a mod-owned source buffer.
		if leased && req.Text == nil {
			return nil, errors.New("document owner is required for an open buffer")
		}
		return related(ctx, e, req)
	case "spring_markers":
		if req.DocumentOwner != "" || req.Revision != nil {
			return nil, errors.New("buffered Spring navigation is not supported; use the existing explicit text contract")
		}
		return springMarkers(req)
	case "spring_project":
		if req.DocumentOwner != "" || req.Revision != nil {
			return nil, errors.New("buffered Spring navigation is not supported; use the existing explicit text contract")
		}
		return springProject(req)
	}
	if (route == "completion" || route == "completion_resolve" || route == "formatting") && (req.DocumentOwner == "" || req.Revision == nil) {
		return nil, errors.New("document owner and revision are required for editor changes")
	}
	srv, uri, snapshot, err := e.openRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	if snapshot != nil {
		defer func() {
			if failure == nil {
				result = struct {
					Value any `json:"value"`
					*documentSnapshot
				}{result, snapshot}
			}
		}()
	}
	params := map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]any{"line": req.Line, "character": req.Col}}
	switch route {
	case "completion", "completion_resolve", "formatting":
		return editorRequest(ctx, srv, uri, snapshot, route, req)
	case "related":
		return superDocumentNavigation(ctx, e, req, srv, uri, snapshot)
	case "hover":
		raw, err := srv.Call(ctx, "textDocument/hover", params)
		if err != nil {
			return nil, err
		}
		var result struct {
			Contents any `json:"contents"`
		}
		if string(raw) != "null" {
			if err = json.Unmarshal(raw, &result); err != nil {
				return nil, err
			}
		}
		return map[string]any{"markdown": lspMarkup(result.Contents)}, nil
	case "definition", "references":
		method := "textDocument/definition"
		if route == "references" {
			method = "textDocument/references"
			params["context"] = map[string]any{"includeDeclaration": true}
		} else {
			switch req.Kind {
			case "type", "typeDefinition":
				method = "textDocument/typeDefinition"
			case "implementation":
				method = "textDocument/implementation"
			}
		}
		raw, err := srv.Call(ctx, method, params)
		var rpcError *RPCError
		unsupportedImplementation := method == "textDocument/implementation" && errors.As(err, &rpcError) && rpcError.Code == -32601
		if err != nil && !unsupportedImplementation {
			return nil, err
		}
		var locs []Location
		if err == nil {
			locs, err = e.Locations(ctx, raw, srv)
			if err != nil {
				return nil, err
			}
		}
		if method == "textDocument/implementation" && len(locs) == 0 {
			fallback := req
			if snapshot != nil {
				fallback.Text = &snapshot.text
			}
			candidates, fallbackErr := sourceImplementations(ctx, fallback)
			if fallbackErr == nil && len(candidates) > 0 {
				locs, err = candidates, nil
			}
			if err != nil {
				return nil, err
			}
		}
		if route == "references" && len(locs) > 500 {
			locs = locs[:500]
		}
		if snapshot != nil {
			return e.bufferPreviews(locs), err
		}
		return withPreviews(locs), err
	case "symbols":
		raw, err := srv.Call(ctx, "textDocument/documentSymbol", map[string]any{"textDocument": map[string]any{"uri": uri}})
		if err != nil {
			return nil, err
		}
		var items []lspSymbol
		if err = json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
		out := []any{}
		flattenLSPSymbols(items, 0, &out)
		return out, nil
	case "diagnostics":
		srv.mu.Lock()
		items := append([]json.RawMessage{}, srv.diagnostics[uri]...)
		busy := lspBusy(srv.progress)
		diagnosticVersion := srv.diagnosticVersions[uri]
		_, seen := srv.diagnostics[uri]
		srv.mu.Unlock()
		confidence := "pending"
		if seen {
			confidence = "unversioned"
			if diagnosticVersion != nil {
				if snapshot != nil && *diagnosticVersion != snapshot.Version {
					items = nil
					confidence = "pending"
				} else {
					confidence = "matched"
				}
			}
		}

		out := []any{}
		for _, raw := range items {
			var d struct {
				Range    lspRange `json:"range"`
				Severity int      `json:"severity"`
				Message  string   `json:"message"`
				Source   string   `json:"source"`
				Code     any      `json:"code"`
			}
			if json.Unmarshal(raw, &d) != nil {
				continue
			}
			if d.Severity == 0 {
				d.Severity = 1
			}
			code := ""
			if d.Code != nil {
				code = fmt.Sprint(d.Code)
			}
			out = append(out, map[string]any{"line": d.Range.Start.Line, "col": d.Range.Start.Character, "end_line": d.Range.End.Line, "end_col": d.Range.End.Character, "severity": d.Severity, "message": d.Message, "source": d.Source, "code": code})
		}
		if snapshot != nil {
			return map[string]any{"items": out, "busy": busy, "diagnostic_version": diagnosticVersion, "version_confidence": confidence}, nil
		}
		return map[string]any{"items": out, "busy": busy}, nil
	case "workspace_symbols":
		raw, err := srv.Call(ctx, "workspace/symbol", map[string]any{"query": req.Query})
		if err != nil {
			return nil, err
		}
		var items []lspSymbol
		if err = json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
		out := []any{}
		if len(items) > 300 {
			items = items[:300]
		}
		for _, s := range items {
			if s.Location.URI == "" {
				continue
			}
			path, err := e.materialize(ctx, s.Location.URI, srv)
			if err != nil {
				return nil, err
			}
			out = append(out, map[string]any{"name": s.Name, "kind": lspKind(s.Kind), "container": s.Container, "path": path, "line": s.Location.Range.Start.Line, "col": s.Location.Range.Start.Character})
		}
		return out, nil
	}
	return nil, errors.New("unknown engine endpoint")
}

type lspPosition struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}
type lspRange struct {
	Start lspPosition `json:"start"`
	End   lspPosition `json:"end"`
}
type lspSymbol struct {
	Name      string    `json:"name"`
	Detail    string    `json:"detail"`
	Container string    `json:"containerName"`
	Kind      int       `json:"kind"`
	Range     lspRange  `json:"range"`
	Selection *lspRange `json:"selectionRange"`
	Location  struct {
		URI   string   `json:"uri"`
		Range lspRange `json:"range"`
	} `json:"location"`
	Children []lspSymbol `json:"children"`
}

func lspKind(kind int) string {
	names := []string{"symbol", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member", "struct", "event", "operator", "type parameter"}
	if kind >= 1 && kind < len(names) {
		return names[kind]
	}
	return "symbol"
}
func flattenLSPSymbols(items []lspSymbol, depth int, out *[]any) {
	for _, s := range items {
		r := s.Range
		if s.Location.URI != "" {
			r = s.Location.Range
		}
		sel := r
		if s.Selection != nil {
			sel = *s.Selection
		}
		detail := s.Detail
		if detail == "" {
			detail = s.Container
		}
		*out = append(*out, map[string]any{"name": s.Name, "detail": detail, "kind": lspKind(s.Kind), "depth": depth, "line": sel.Start.Line, "col": sel.Start.Character, "start": r.Start.Line, "end": r.End.Line})
		flattenLSPSymbols(s.Children, depth+1, out)
	}
}
func lspMarkup(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []any:
		out := []string{}
		for _, i := range x {
			if s := lspMarkup(i); s != "" {
				out = append(out, s)
			}
		}
		return strings.Join(out, "\n\n")
	case map[string]any:
		value, _ := x["value"].(string)
		if lang, ok := x["language"].(string); ok {
			return "```" + lang + "\n" + value + "\n```"
		}
		return value
	}
	return ""
}
