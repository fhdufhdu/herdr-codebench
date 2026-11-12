package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// A genuine child process exercises both directions of the stdio transport.
func TestLSPHelper(t *testing.T) {
	if os.Getenv("HERDR_ENGINE_TEST_LSP") != "1" {
		return
	}
	var writer sync.Mutex
	send := func(v any) {
		b, _ := json.Marshal(v)
		writer.Lock()
		defer writer.Unlock()
		fmt.Fprintf(os.Stdout, "Content-Length: %d\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n", len(b))
		os.Stdout.Write(b)
	}
	result := func(id json.RawMessage, v any) { send(map[string]any{"jsonrpc": "2.0", "id": id, "result": v}) }
	docs := map[string]any{}
	opens, changes, cancels, closes, hovers := 0, 0, 0, 0, 0
	var heldHovers []func()
	var heldSymbols []func()
	symbolRequests := 0
	responses := map[string]any{}
	var lastChange any
	r := bufio.NewReader(os.Stdin)
	for {
		b, err := readFrame(r)
		if err != nil {
			os.Exit(0)
		}
		var m struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result any             `json:"result"`
		}
		if json.Unmarshal(b, &m) != nil {
			os.Exit(2)
		}
		switch m.Method {
		case "initialize":
			if os.Getenv("HERDR_TEST_INITIALIZE_PAUSE") == "1" {
				time.Sleep(200 * time.Millisecond)
			}
			result(m.ID, map[string]any{"capabilities": map[string]any{"positionEncoding": "utf-16", "textDocumentSync": map[string]any{"openClose": true, "change": 2}, "completionProvider": map[string]any{"resolveProvider": true, "triggerCharacters": []string{"."}}, "documentFormattingProvider": true}})
			send(map[string]any{"jsonrpc": "2.0", "id": "cfg", "method": "workspace/configuration", "params": map[string]any{"items": []any{map[string]any{"section": "testing.answer"}}}})
			send(map[string]any{"jsonrpc": "2.0", "id": "folders", "method": "workspace/workspaceFolders", "params": map[string]any{}})
		case "initialized":
			send(map[string]any{"jsonrpc": "2.0", "method": "$/progress", "params": map[string]any{"token": "test", "value": map[string]any{"kind": "begin", "title": "Indexing"}}})
		case "textDocument/completion":
			result(m.ID, map[string]any{"isIncomplete": false, "items": []any{map[string]any{"label": "completed", "insertText": "completed", "data": map[string]any{"fixture": true}}, map[string]any{"label": "snippet", "insertTextFormat": 2, "insertText": "${1:unsupported}"}}})
		case "completionItem/resolve":
			var item map[string]any
			_ = json.Unmarshal(m.Params, &item)
			item["additionalTextEdits"] = []any{map[string]any{"range": map[string]any{"start": map[string]int{"line": 0, "character": 0}, "end": map[string]int{"line": 0, "character": 0}}, "newText": "// resolved import\n"}}
			result(m.ID, item)
		case "textDocument/formatting":
			result(m.ID, []any{map[string]any{"range": map[string]any{"start": map[string]int{"line": 0, "character": 0}, "end": map[string]int{"line": 0, "character": 0}}, "newText": "// formatted\n"}})
		case "textDocument/didOpen":
			var p map[string]any
			json.Unmarshal(m.Params, &p)
			d := p["textDocument"].(map[string]any)
			docs[d["uri"].(string)] = d
			opens++
			send(map[string]any{"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": map[string]any{"uri": d["uri"], "diagnostics": []any{map[string]any{"range": map[string]any{"start": map[string]any{"line": 0, "character": 0}, "end": map[string]any{"line": 0, "character": 2}}, "severity": 2, "message": "fixture warning", "source": "fixture", "code": 7}}}})
		case "textDocument/didChange":
			json.Unmarshal(m.Params, &lastChange)
			changes++
			p := lastChange.(map[string]any)
			d := p["textDocument"].(map[string]any)
			d["text"] = p["contentChanges"].([]any)[0].(map[string]any)["text"]
			docs[d["uri"].(string)] = d
		case "textDocument/didClose":
			var p struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			}
			json.Unmarshal(m.Params, &p)
			delete(docs, p.TextDocument.URI)
			closes++
		case "fixture/publish":
			var p any
			json.Unmarshal(m.Params, &p)
			send(map[string]any{"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": p})
			result(m.ID, true)
		case "fixture/releaseHover":
			for _, reply := range heldHovers {
				reply()
			}
			heldHovers = nil
			result(m.ID, true)
		case "fixture/releaseSymbols":
			for _, reply := range heldSymbols {
				reply()
			}
			heldSymbols = nil
			result(m.ID, true)
		case "$/cancelRequest":
			cancels++
		case "fixture/inspect":
			result(m.ID, map[string]any{"opens": opens, "changes": changes, "cancels": cancels, "closes": closes, "hovers": hovers, "symbol_requests": symbolRequests, "docs": docs, "change": lastChange, "responses": responses, "env": os.Getenv("HERDR_TEST_CONFIG"), "java": os.Getenv("JAVA_TOOL_OPTIONS"), "javaHome": os.Getenv("JAVA_HOME")})
		case "fixture/echo":
			id := append(json.RawMessage(nil), m.ID...)
			p := append(json.RawMessage(nil), m.Params...)
			go func() { time.Sleep(time.Duration(len(p)%5) * time.Millisecond); result(id, p) }()
		case "fixture/hang": // Cancellation must reach this process, not merely the HTTP layer.
		case "fixture/crash":
			os.Exit(4)
		case "textDocument/hover":
			hovers++
			var p struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			}
			json.Unmarshal(m.Params, &p)
			text := ""
			if d, ok := docs[p.TextDocument.URI].(map[string]any); ok {
				text, _ = d["text"].(string)
			}
			id := append(json.RawMessage(nil), m.ID...)
			reply := func() {
				result(id, map[string]any{"contents": map[string]any{"kind": "markdown", "value": "**Fixture**\n" + text}})
			}
			if strings.Contains(text, "hold-hover") {
				heldHovers = append(heldHovers, reply)
			} else {
				reply()
			}
		case "textDocument/definition", "textDocument/references":
			var p struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
				Position struct {
					Line      int `json:"line"`
					Character int `json:"character"`
				} `json:"position"`
			}
			json.Unmarshal(m.Params, &p)
			text := ""
			if d, ok := docs[p.TextDocument.URI].(map[string]any); ok {
				text, _ = d["text"].(string)
			}
			if strings.Contains(text, "fixture-super") && strings.Contains(text, "Parent") && p.Position.Character == utf16Len(text[:strings.Index(text, "Parent")]) {
				source, _ := fromURI(p.TextDocument.URI)
				target := filepath.Join(filepath.Dir(source), "Parent.go")
				if strings.Contains(text, "fixture-super-cross-root") {
					target = filepath.Join(filepath.Dir(source), "other", "Parent.go")
				}
				result(m.ID, []any{superTestLocation(target, 0, 6)})
			} else if strings.Contains(text, "fixture-preview") {
				result(m.ID, []any{map[string]any{"uri": p.TextDocument.URI, "range": map[string]any{"start": map[string]int{"line": 0, "character": 0}, "end": map[string]int{"line": 0, "character": 7}}}})
			} else {
				result(m.ID, []any{})
			}
		case "textDocument/documentSymbol":
			var p struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			}
			json.Unmarshal(m.Params, &p)
			text := ""
			if d, ok := docs[p.TextDocument.URI].(map[string]any); ok {
				text, _ = d["text"].(string)
			}
			symbolRequests++
			id := append(json.RawMessage(nil), m.ID...)
			reply := func() { result(id, []any{}) }
			if strings.Contains(text, "hold-super") {
				heldSymbols = append(heldSymbols, reply)
			} else {
				reply()
			}
		case "workspace/symbol":
			result(m.ID, []any{})
		case "java/classFileContents":
			result(m.ID, "package lib;\npublic class Library {}\n")
		case "shutdown":
			result(m.ID, nil)
		case "exit":
			os.Exit(0)
		case "":
			if len(m.ID) > 0 {
				responses[string(m.ID)] = m.Result
			}
		default:
			if len(m.ID) > 0 {
				send(map[string]any{"jsonrpc": "2.0", "id": m.ID, "error": map[string]any{"code": -32601, "message": "unsupported fixture method"}})
			}
		}
	}
}
func fixtureEngine(t *testing.T) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]ServerConfig{"go": {Extensions: []string{"go"}, Markers: []string{"go.mod"}, Commands: [][]string{{exe, "-test.run=^TestLSPHelper$"}}, Init: map[string]any{"testing": map[string]any{"answer": "{root}"}}, Env: map[string]string{"HERDR_ENGINE_TEST_LSP": "1", "HERDR_TEST_CONFIG": "{cache}|{root}|{root_hash}"}}}
	b, _ := json.Marshal(config)
	cfg := filepath.Join(dir, "config.json")
	if err = os.WriteFile(cfg, b, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "sample.go")
	if err = os.WriteFile(path, []byte("package main\n// 😀x"), 0600); err != nil {
		t.Fatal(err)
	}
	e, err := NewEngine(cfg, filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return e, path
}
func fixtureContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func inspectFixture(t *testing.T, ctx context.Context, s *LSPServer) map[string]any {
	t.Helper()
	raw, err := s.Call(ctx, "fixture/inspect", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}
func TestFrameBoundaries(t *testing.T) {
	body := []byte(`{"value":"😀"}`)
	wire := fmt.Sprintf("content-length: %d\r\nContent-Type: utf-8\r\n\r\n%s", len(body), body)
	r := bufio.NewReader(io.MultiReader(strings.NewReader(wire[:11]), strings.NewReader(wire[11:])))
	got, err := readFrame(r)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("%s, %v", got, err)
	}
	for _, bad := range []string{"\r\n", strings.Repeat("X", 16384), "Content-Length: -1\r\n\r\n", "Content-Length: 33554433\r\n\r\n", "Content-Length: 1\r\nContent-Length: 1\r\n\r\na", "Content-Length: 5\r\n\r\nabc"} {
		if _, err = readFrame(bufio.NewReader(strings.NewReader(bad))); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}
func TestDocumentSyncCapabilities(t *testing.T) {
	for _, tc := range []struct {
		raw                 string
		opens, changes      int
		hasRange, wantError bool
	}{
		{`1`, 1, 1, false, false}, {`2`, 1, 1, true, false},
		{`{"openClose":false,"change":1}`, 0, 1, false, false},
		{`{"openClose":true,"change":0}`, 1, 0, false, true},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			e, path := fixtureEngine(t)
			ctx := fixtureContext(t)
			s, err := e.Server(ctx, path, false)
			if err != nil {
				t.Fatal(err)
			}
			s.mu.Lock()
			s.capabilities["textDocumentSync"] = json.RawMessage(tc.raw)
			s.mu.Unlock()
			if _, err = s.Open(ctx, path); err != nil {
				t.Fatal(err)
			}
			os.WriteFile(path, []byte("package changed"), 0600)
			_, err = s.Open(ctx, path)
			if tc.wantError {
				if err == nil || !s.stopped() {
					t.Fatal("unsupported synchronization must restart", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			state := inspectFixture(t, ctx, s)
			if state["opens"] != float64(tc.opens) || state["changes"] != float64(tc.changes) {
				t.Fatal(state)
			}
			change := state["change"].(map[string]any)["contentChanges"].([]any)[0].(map[string]any)
			_, has := change["range"]
			if has != tc.hasRange {
				t.Fatal(change)
			}
		})
	}
}
func TestLSPProcessLifecycle(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	if info := e.info(path).(map[string]any); info["state"] != "not started" || len(e.status()) != 0 {
		t.Fatal("info started a process")
	}
	s, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	same, err := e.Server(ctx, path, false)
	if err != nil || same != s {
		t.Fatal("server cache not reused", err)
	}
	uri, err := s.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	for deadline := time.Now().Add(3 * time.Second); ; {
		state = inspectFixture(t, ctx, s)
		if len(state["responses"].(map[string]any)) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("server requests unanswered", state)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if state["opens"] != float64(1) || state["changes"] != float64(0) {
		t.Fatal(state)
	}
	responses := state["responses"].(map[string]any)
	if !reflect.DeepEqual(responses[`"cfg"`], []any{s.Root}) {
		t.Fatal("configuration response", responses)
	}
	folders := responses[`"folders"`].([]any)
	if folders[0].(map[string]any)["uri"] != toURI(s.Root) {
		t.Fatal(responses)
	}
	if !strings.Contains(state["env"].(string), e.cache+"|"+s.Root+"|") {
		t.Fatal("config expansion", state)
	}
	if !strings.Contains(state["java"].(string), "java.awt.headless") {
		t.Fatal("JVM options")
	}
	if err = os.WriteFile(path, []byte("package main\n// 😀changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	state = inspectFixture(t, ctx, s)
	if state["changes"] != float64(1) {
		t.Fatal(state)
	}
	change := state["change"].(map[string]any)
	v := change["contentChanges"].([]any)[0].(map[string]any)["range"].(map[string]any)["end"].(map[string]any)
	if v["line"] != float64(1) || v["character"] != float64(6) {
		t.Fatalf("wrong UTF16 end: %v", v)
	}
	diagnostics, err := e.dispatch(ctx, "diagnostics", Request{Path: path})
	if err != nil {
		t.Fatal(err)
	}
	if len(diagnostics.(map[string]any)["items"].([]any)) != 1 {
		t.Fatal(diagnostics)
	}
	if len(e.status()[0].(map[string]any)["busy"].([]string)) != 1 {
		t.Fatal("progress missing")
	}
	s.mu.Lock()
	if len(s.diagnostics[uri]) != 1 {
		t.Error("diagnostics missing")
	}
	s.mu.Unlock()
	s.Stop()
	if !s.stopped() {
		t.Fatal("server not stopped")
	}
	if _, err = e.Server(ctx, path, false); err == nil {
		t.Fatal("failed server restarted without explicit retry")
	}
	restarted, err := e.Server(ctx, path, true)
	if err != nil || restarted == s {
		t.Fatal("retry failed", err)
	}
}
func TestConcurrentRPCAndCancellation(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	s, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			raw, err := s.Call(ctx, "fixture/echo", map[string]any{"number": i})
			if err != nil {
				t.Error(err)
				return
			}
			var got struct {
				Number int `json:"number"`
			}
			if json.Unmarshal(raw, &got) != nil || got.Number != i {
				t.Errorf("response crossed: %s expected %d", raw, i)
			}
		}(i)
	}
	wg.Wait()
	timeout, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	if _, err = s.Call(timeout, "fixture/hang", nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("no timeout: %v", err)
	}
	for deadline := time.Now().Add(time.Second); ; {
		if inspectFixture(t, ctx, s)["cancels"].(float64) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancellation notification missing")
		}
		time.Sleep(time.Millisecond)
	}
	_, err = s.Call(ctx, "fixture/unknown", nil)
	var rpcErr *RPCError
	if !errors.As(err, &rpcErr) || rpcErr.Code != -32601 {
		t.Fatalf("RPC error lost: %v", err)
	}
}
func TestServerRuntimeEnvironment(t *testing.T) {
	for _, tc := range []struct{ name, inherited, configured, want string }{
		{"launcher chooses runtime", "", "", ""},
		{"explicit runtime preserved", "/fixture/user-jdk", "", "/fixture/user-jdk"},
		{"server runtime override", "/fixture/user-jdk", "/fixture/server-jdk", "/fixture/server-jdk"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JAVA_HOME", tc.inherited)
			e, path := fixtureEngine(t)
			if tc.configured != "" {
				cfg := e.config["go"]
				cfg.Env["JAVA_HOME"] = tc.configured
				e.config["go"] = cfg
			}
			ctx := fixtureContext(t)
			s, err := e.Server(ctx, path, false)
			if err != nil {
				t.Fatal(err)
			}
			if got := inspectFixture(t, ctx, s)["javaHome"]; got != tc.want {
				t.Fatalf("JAVA_HOME=%v want%q", got, tc.want)
			}
		})
	}
}
func TestEngineEvictionAndIdle(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	first, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		dir := filepath.Join(filepath.Dir(path), fmt.Sprintf("project%d", i))
		os.Mkdir(dir, 0700)
		os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module fixture"), 0600)
		p := filepath.Join(dir, "x.go")
		os.WriteFile(p, []byte("package fixture"), 0600)
		if _, err = e.Server(ctx, p, false); err != nil {
			t.Fatal(err)
		}
	}
	if len(e.status()) != 3 {
		t.Fatal("server cap failed")
	}
	select {
	case <-first.done:
	case <-time.After(4 * time.Second):
		t.Fatal("evicted process remains alive")
	}
	e.mu.Lock()
	for _, s := range e.servers {
		s.mu.Lock()
		s.used = time.Now().Add(-11 * time.Minute)
		s.mu.Unlock()
	}
	e.lastRequest = time.Now().Add(-61 * time.Minute)
	e.mu.Unlock()
	if !e.reap(time.Now()) || len(e.status()) != 0 {
		t.Fatal("idle reap failed")
	}
}
func requestHTTP(e *Engine, token, route, body string, edit func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "http://127.0.0.1:47822/"+route, strings.NewReader(body))
	r.Header.Set("X-Codenav-Token", token)
	if edit != nil {
		edit(r)
	}
	w := httptest.NewRecorder()
	e.Handler("test-secret").ServeHTTP(w, r)
	return w
}
func TestHTTPAuthBoundsAndShapes(t *testing.T) {
	e, path := fixtureEngine(t)
	cases := []struct {
		token, route, body string
		edit               func(*http.Request)
		status             int
	}{
		{"", "health", "{}", nil, 401}, {"wrong", "health", "{}", nil, 401}, {"test-secret", "health", "{}", func(r *http.Request) { r.Header.Set("Origin", "http://localhost") }, 403}, {"test-secret", "health", "{}", func(r *http.Request) { r.Host = "attacker.test" }, 403}, {"test-secret", "missing", "{}", nil, 404}, {"test-secret", "health", "{}", func(r *http.Request) { r.Method = "GET" }, 405}, {"test-secret", "health", "{", nil, 400}, {"test-secret", "health", "{}{}", nil, 400}, {"test-secret", "health", `{"line":-1}`, nil, 400}, {"test-secret", "tokens", `{"text":"` + strings.Repeat("a", maxBody) + `"}`, nil, 413},
	}
	for _, c := range cases {
		if w := requestHTTP(e, c.token, c.route, c.body, c.edit); w.Code != c.status {
			t.Fatalf("%s: got%d want%d %s", c.route, w.Code, c.status, w.Body)
		}
	}
	for route, want := range map[string]string{"status": "[]", "tokens": "null"} {
		body := `{"path":"unknown.extension","text":"hello"}`
		w := requestHTTP(e, "test-secret", route, body, nil)
		var got struct {
			OK     bool            `json:"ok"`
			Result json.RawMessage `json:"result"`
		}
		json.Unmarshal(w.Body.Bytes(), &got)
		if w.Code != 200 || !got.OK || string(got.Result) != want {
			t.Fatal(w.Code, w.Body)
		}
	}
	w := requestHTTP(e, "test-secret", "health", "{}", nil)
	var health map[string]any
	json.Unmarshal(w.Body.Bytes(), &health)
	h := health["result"].(map[string]any)
	if h["engine"] != engineName || h["version"] != version {
		t.Fatal(health)
	}
	b, _ := json.Marshal(Request{Path: path})
	w = requestHTTP(e, "test-secret", "hover", string(b), nil)
	if !strings.Contains(w.Body.String(), "**Fixture**") {
		t.Fatal(w.Body)
	}
}
func TestConfigLanguagesRootsAndLocalOverlay(t *testing.T) {
	b, err := os.ReadFile("../mods/codenav/bridge/servers.json")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	cfg := filepath.Join(dir, "base.json")
	os.WriteFile(cfg, b, 0600)
	os.WriteFile(filepath.Join(dir, "servers.json"), []byte(`{"java":{"env":{"FIXTURE":"yes"}}}`), 0600)
	e, err := NewEngine(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	for file, want := range map[string]string{"x.go": "go", "x.rs": "rust", "x.swift": "swift", "x.java": "java", "x.kt": "kotlin", "x.kts": "kotlin", "x.tsx": "typescript", "x.cjs": "typescript", "x.py": "python"} {
		got, _ := e.language(file)
		if got != want {
			t.Errorf("%s=%s want%s", file, got, want)
		}
	}
	if len(e.config["java"].Commands) == 0 || e.config["java"].Env["FIXTURE"] != "yes" {
		t.Fatal("overlay replaced entire entry")
	}
	if languageID("x.jsx", "typescript") != "javascriptreact" {
		t.Fatal("JSX language")
	}
	os.Mkdir(filepath.Join(dir, ".git"), 0700)
	os.WriteFile(filepath.Join(dir, "pom.xml"), nil, 0600)
	nested := filepath.Join(dir, "sub")
	os.Mkdir(nested, 0700)
	os.WriteFile(filepath.Join(nested, "pom.xml"), nil, 0600)
	if findRoot(filepath.Join(nested, "x.java"), e.config["java"]) != dir {
		t.Fatal("topmost root")
	}
	c := e.config["java"]
	c.Root = "nearest"
	if findRoot(filepath.Join(nested, "x.java"), c) != nested {
		t.Fatal("nearest root")
	}
}
func TestURIsMaterializationAndState(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	special := filepath.Join(filepath.Dir(path), "a space #😀.go")
	uri := toURI(special)
	if got, err := fromURI(uri); err != nil || got != special {
		t.Fatal(got, err, uri)
	}
	file := filepath.Join(filepath.Dir(path), "source.jar")
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	entry, _ := z.Create("pkg/Class.java")
	entry.Write([]byte("package pkg;\nclass Class {}\n"))
	z.Close()
	f.Close()
	jarURI := "jar:" + toURI(file) + "!/pkg/Class.java"
	source, err := e.materialize(ctx, jarURI, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !e.library(source) {
		t.Fatal("library not marked")
	}
	info, _ := os.Stat(source)
	if runtime.GOOS != "windows" && info.Mode().Perm()&0222 != 0 {
		t.Fatal("library writable")
	}
	if _, err = e.materialize(ctx, "jar:"+toURI(file)+"!/../escape.java", nil); err == nil {
		t.Fatal("archive traversal accepted")
	}
	s, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	jdt, err := e.materialize(ctx, "jdt://contents/Library.class", s)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(jdt)
	if !strings.Contains(string(got), "class Library") {
		t.Fatal(string(got))
	}
	s.Stop()
	if _, err = e.materialize(ctx, "jdt://contents/Library.class", s); err != nil {
		t.Fatal("cached class requires server", err)
	}
	raw, _ := json.Marshal(map[string]any{"targetUri": toURI(path), "targetSelectionRange": map[string]any{"start": map[string]any{"line": 1, "character": 3}, "end": map[string]any{"line": 1, "character": 6}}})
	locs, err := e.Locations(ctx, raw, nil)
	if err != nil || len(locs) != 1 || locs[0].Col != 3 {
		t.Fatal(locs, err)
	}
	if withPreviews(locs)[0].Text != "// 😀x" {
		t.Fatal(locs)
	}
	statePath := filepath.Join(e.cache, "engine.json")
	if err = writeState(statePath, engineState{os.Getpid(), 1234, "secret", engineName, version}); err != nil {
		t.Fatal(err)
	}
	info, _ = os.Stat(statePath)
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal("state permissions")
	}
	removeOwnedState(statePath, "other")
	if _, err = os.Stat(statePath); err != nil {
		t.Fatal("removed other owner")
	}
	removeOwnedState(statePath, "secret")
	if _, err = os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatal("state not removed")
	}
}
func TestTokenSpansUTF16AndHTTP(t *testing.T) {
	for path, text := range map[string]string{"x.go": "package main\n// 😀\nvar x = `a\nb`\n", "x.kt": "@Service\nclass 😀 {}", "x.http": "### 😀 test\nGET {{host}}/x HTTP/1.1\nAccept: application/json\n\n{\"key\": \"😀\", \"ok\": true}\n> {%\nclient.test(\"ok\");\n%}"} {
		got := syntaxTokens(text, path)
		var lines tokenLines
		switch value := got.(type) {
		case tokenLines:
			lines = value
		default:
			t.Fatal("missing lexer", path)
		}
		source := strings.Split(text, "\n")
		if len(lines) != len(source) {
			t.Fatalf("%s lines %d/%d", path, len(lines), len(source))
		}
		for i, spans := range lines {
			length := 0
			for _, span := range spans {
				length += span[0].(int)
			}
			if length != utf16Len(source[i]) {
				t.Fatalf("%s line%d spans=%v length%d want%d", path, i, spans, length, utf16Len(source[i]))
			}
		}
	}
	if syntaxTokens("hello", "x.unknown") != nil {
		t.Fatal("unknown syntax should be null")
	}
	tokens := syntaxTokens("// 😀", "x.go").(tokenLines)
	if tokens[0][0][1] != "comment" || tokens[0][0][0] != 5 {
		t.Fatal(tokens)
	}
}
