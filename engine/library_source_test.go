package main

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestLibraryLSPHelper(t *testing.T) {
	if os.Getenv("HERDR_LIBRARY_LSP") != "1" {
		return
	}
	reader := bufio.NewReader(os.Stdin)
	opens := map[string]int{}
	opened := map[string]bool{}
	project := ""
	for {
		data, err := readFrame(reader)
		if err != nil {
			os.Exit(0)
		}
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params struct {
				Root     string `json:"rootUri"`
				Document struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			} `json:"params"`
		}
		if json.Unmarshal(data, &req) != nil {
			os.Exit(2)
		}
		var result any
		switch req.Method {
		case "initialize":
			project = req.Params.Root
			result = map[string]any{"capabilities": map[string]any{"textDocumentSync": 1}}
		case "textDocument/didOpen":
			opens[req.Params.Document.URI]++
			opened[req.Params.Document.URI] = true
			continue
		case "textDocument/didChange":
			continue
		case "textDocument/didClose":
			delete(opened, req.Params.Document.URI)
			continue
		case "textDocument/hover":
			if strings.HasPrefix(req.Params.Document.URI, "file:") && !opened[req.Params.Document.URI] {
				result = nil
			} else {
				result = map[string]any{"contents": req.Params.Document.URI + "|" + project + fmt.Sprint("|opens=", opens[req.Params.Document.URI])}
			}
		case "textDocument/definition", "textDocument/references":
			if strings.HasPrefix(req.Params.Document.URI, "file:") && !opened[req.Params.Document.URI] {
				result = []any{}
			} else {
				result = []any{map[string]any{"uri": req.Params.Document.URI, "range": map[string]any{"start": map[string]int{"line": 0, "character": 1}, "end": map[string]int{"line": 0, "character": 3}}}}
			}
		case "textDocument/documentSymbol":
			result = []any{map[string]any{"name": req.Params.Document.URI, "kind": 5}}
		case "java/classFileContents":
			result = "class Library {}"
		case "shutdown":
			result = nil
		case "exit":
			os.Exit(0)
		default:
			continue
		}
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
		fmt.Fprintf(os.Stdout, "Content-Length: %d\r\n\r\n%s", len(body), body)
	}
}

func libraryFixture(t *testing.T) (*Engine, *LSPServer, string) {
	t.Helper()
	e, path := fixtureEngine(t)
	cfg := e.config["go"]
	cfg.Commands = [][]string{{os.Args[0], "-test.run=^TestLibraryLSPHelper$"}}
	cfg.Env = map[string]string{"HERDR_LIBRARY_LSP": "1"}
	e.config["go"] = cfg
	data, _ := json.Marshal(e.config)
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "config.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	srv, err := e.Server(fixtureContext(t), path, false)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.materialize(fixtureContext(t), "jdt://contents/Library.class", srv)
	if err != nil {
		t.Fatal(err)
	}
	return e, srv, source
}
func libraryCall(t *testing.T, e *Engine, route, source string) any {
	t.Helper()
	value, handled, err := e.libraryRequest(fixtureContext(t), route, Request{Path: source})
	if !handled || err != nil {
		t.Fatalf("%s: handled=%v err=%v", route, handled, err)
	}
	return value
}
func TestLibraryOriginalURIReadOnlyAndRestart(t *testing.T) {
	e, srv, source := libraryFixture(t)
	ctx := fixtureContext(t)
	expected := "jdt://contents/Library.class|" + toURI(srv.Root) + "|opens=0"
	if got := libraryCall(t, e, "hover", source).(map[string]any)["markdown"]; got != expected {
		t.Fatalf("hover %v", got)
	}
	for _, route := range []string{"definition", "references"} {
		locations := libraryCall(t, e, route, source).([]Location)
		if len(locations) != 1 || locations[0].Path != source || !locations[0].External || locations[0].Text != "class Library {}" {
			t.Fatalf("%s: %#v", route, locations)
		}
	}
	symbols := libraryCall(t, e, "symbols", source).([]any)
	if len(symbols) != 1 || symbols[0].(map[string]any)["name"] != "jdt://contents/Library.class" {
		t.Fatal(symbols)
	}
	info := libraryCall(t, e, "info", source).(map[string]any)
	if info["lang"] != "go" || info["semantic"] != true || info["root"] != srv.Root {
		t.Fatal(info)
	}
	diagnostic := libraryCall(t, e, "diagnostics", source).(map[string]any)
	if diagnostic["supported"] != false || diagnostic["scope"] != "external_source" {
		t.Fatal(diagnostic)
	}
	text := "attempted write"
	revision := int64(1)
	for _, route := range []string{"document_sync", "document_touch", "document_close", "completion", "completion_resolve", "formatting", "related"} {
		_, handled, err := e.libraryRequest(ctx, route, Request{Path: source, Text: &text, DocumentOwner: "editor", Revision: &revision})
		if !handled || err == nil {
			t.Fatalf("accepted mutation %s", route)
		}
	}
	if _, err := e.syncDocument(ctx, Request{Path: source, Text: &text, DocumentOwner: "editor", Revision: &revision}); err == nil {
		t.Fatal("direct sync accepted")
	}
	if len(e.documents) != 0 {
		t.Fatal("rejected source created a buffer lease")
	}
	if _, handled, err := e.libraryRequest(ctx, "tokens", Request{Path: source}); handled || err != nil {
		t.Fatal("tokens intercepted")
	}
	if _, handled, err := e.libraryRequest(ctx, "hover", Request{Path: source, Text: &text}); !handled || err == nil {
		t.Fatal("cached text override accepted")
	}
	e.Close()
	restarted, err := NewEngine(filepath.Join(srv.Root, "config.json"), e.cache)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if got := libraryCall(t, restarted, "hover", source).(map[string]any)["markdown"]; got != expected {
		t.Fatalf("restart hover %v", got)
	}
}

func TestLibraryMetadataValidationAndConcurrentReads(t *testing.T) {
	e, srv, source := libraryFixture(t)
	ctx := fixtureContext(t)
	var wg sync.WaitGroup
	failures := make(chan error, 40)
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			path, err := e.materialize(ctx, "jdt://contents/Library.class", srv)
			if err != nil {
				failures <- err
				return
			}
			if path != source {
				failures <- fmt.Errorf("path changed")
			}
			_, handled, err := e.libraryRequest(ctx, "hover", Request{Path: path})
			if !handled || err != nil {
				failures <- fmt.Errorf("read: %v", err)
			}
		}()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if err := os.Chmod(source, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.libraryRequest(ctx, "hover", Request{Path: source}); err == nil {
		t.Fatal("changed cache accepted")
	}
	other := filepath.Join(filepath.Dir(source), "Other.java")
	os.WriteFile(other, []byte("class Library {}"), 0444)
	metadata := filepath.Join(e.cache, "source-metadata")
	original, _ := os.ReadFile(filepath.Join(metadata, libraryHash(source)+".json"))
	os.WriteFile(filepath.Join(metadata, libraryHash(other)+".json"), original, 0600)
	if _, _, err := e.libraryRequest(ctx, "hover", Request{Path: other}); err == nil {
		t.Fatal("mismatched metadata accepted")
	}
	missing := filepath.Join(e.cache, "sources", "unknown", "Class.java")
	info := libraryCall(t, e, "info", missing).(map[string]any)
	if info["semantic"] != false {
		t.Fatal(info)
	}
	if _, _, err := e.libraryRequest(ctx, "hover", Request{Path: missing}); err == nil {
		t.Fatal("missing mapping accepted")
	}
}
func TestLibrarySourceCacheRejectsSymlinkEscape(t *testing.T) {
	e, _, source := libraryFixture(t)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "Fixture.java"), []byte("fixture"), 0600)
	link := filepath.Join(filepath.Dir(source), "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip(err)
	}
	if _, err := e.readLibrarySource(filepath.Join(link, "Fixture.java")); err == nil {
		t.Fatal("read escaped cache")
	}
	if err := e.writeLibrarySource(filepath.Join(link, "New.java"), []byte("write")); err == nil {
		t.Fatal("write escaped cache")
	}
	if _, err := os.Stat(filepath.Join(outside, "New.java")); !os.IsNotExist(err) {
		t.Fatal("outside source created")
	}
}

func TestLibraryJarAssociationUsesServerLanguageAndRoot(t *testing.T) {
	e, srv, _ := libraryFixture(t)
	archive := filepath.Join(srv.Root, "fixture.jar")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("lib/Example.java")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte("class Example {}")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	uri := "jar:" + toURI(archive) + "!/lib/Example.java"
	first, err := e.materialize(fixtureContext(t), uri, srv)
	if err != nil {
		t.Fatal(err)
	}
	otherRoot := t.TempDir()
	second, err := e.materialize(fixtureContext(t), uri, &LSPServer{lang: srv.lang, Root: otherRoot})
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("different project server associations shared a cache path")
	}
	firstInfo := libraryCall(t, e, "info", first).(map[string]any)
	secondInfo := libraryCall(t, e, "info", second).(map[string]any)
	if firstInfo["lang"] != "go" || firstInfo["root"] != srv.Root || secondInfo["root"] != otherRoot {
		t.Fatal(firstInfo, secondInfo)
	}
	expected := uri + "|" + toURI(srv.Root) + "|opens=0"
	if got := libraryCall(t, e, "hover", first).(map[string]any)["markdown"]; got != expected {
		t.Fatal(got)
	}
}

func TestLibraryFileTargetsKeepOriginalProjectServer(t *testing.T) {
	e, srv, _ := libraryFixture(t)
	ctx := fixtureContext(t)
	outside := filepath.Join(t.TempDir(), "lib.es5.d.ts")
	dependency := filepath.Join(srv.Root, "node_modules", "fixture", "index.d.ts")
	local := filepath.Join(srv.Root, "src", "local.ts")
	for _, path := range []string{outside, dependency, local} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("declare class Fixture {}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{outside, dependency} {
		t.Run(filepath.Base(path), func(t *testing.T) {
			uri := toURI(path)
			cached, err := e.materialize(ctx, uri, srv)
			if err != nil {
				t.Fatal(err)
			}
			if cached == path || !e.library(cached) {
				t.Fatal("external file was not cached", cached)
			}
			info := libraryCall(t, e, "info", cached).(map[string]any)
			if info["lang"] != "go" || info["root"] != srv.Root || info["semantic"] != true {
				t.Fatal(info)
			}
			expected := uri + "|" + toURI(srv.Root) + "|opens=1"
			if got := libraryCall(t, e, "hover", cached).(map[string]any)["markdown"]; got != expected {
				t.Fatal(got)
			}
			for _, route := range []string{"definition", "references"} {
				locations := libraryCall(t, e, route, cached).([]Location)
				if len(locations) != 1 || locations[0].Path != cached || !locations[0].External {
					t.Fatal(locations)
				}
			}
			if err := os.WriteFile(path, []byte("declare class UpdatedFixture {}"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, _, err := e.libraryRequest(ctx, "hover", Request{Path: cached}); !errors.Is(err, errLibraryFileChanged) {
				t.Fatal("stale source routed", err)
			}
			staleInfo := libraryCall(t, e, "info", cached).(map[string]any)
			if staleInfo["semantic"] != false || staleInfo["reason"] != errLibraryFileChanged.Error() {
				t.Fatal(staleInfo)
			}
			updated, err := e.materialize(ctx, uri, srv)
			if err != nil || updated == cached {
				t.Fatal("updated source reused stale cache", updated, err)
			}
			if got := libraryCall(t, e, "hover", updated).(map[string]any)["markdown"]; got != expected {
				t.Fatal(got)
			}
			text := "mutation"
			revision := int64(1)
			if _, err := e.syncDocument(ctx, Request{Path: updated, DocumentOwner: "editor", Revision: &revision, Text: &text}); err == nil {
				t.Fatal("cached file became editable")
			}
			if original, err := e.materialize(ctx, uri, nil); err != nil || original != path {
				t.Fatal("nil-server behavior changed", original, err)
			}
		})
	}
	if got, err := e.materialize(ctx, toURI(local), srv); err != nil || got != local {
		t.Fatal("project file was copied", got, err)
	}
	if _, err := e.materialize(ctx, "file:relative.ts", srv); err == nil {
		t.Fatal("relative file URI accepted")
	}
	if _, err := e.materialize(ctx, "file://remote.example/library.ts", srv); err == nil {
		t.Fatal("remote file URI accepted")
	}
	oversized := filepath.Join(t.TempDir(), "large.d.ts")
	f, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(maxFrame + 1); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()
	if _, err := e.materialize(ctx, toURI(oversized), srv); err == nil {
		t.Fatal("oversized library accepted")
	}
	if len(e.servers) != 1 {
		t.Fatal("external file started an independent server", len(e.servers))
	}
	srv.docMu.Lock()
	defer srv.docMu.Unlock()
	for uri := range srv.docs {
		path, err := fromURI(uri)
		if err != nil || e.library(path) {
			t.Fatal("cached source opened as an LSP document", uri)
		}
	}
}

func TestLibraryFileOriginalBufferLeaseIsNeverOverwritten(t *testing.T) {
	e, srv, _ := libraryFixture(t)
	ctx := fixtureContext(t)
	path := filepath.Join(srv.Root, "node_modules", "fixture", "index.go")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("package fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	cached, err := e.materialize(ctx, toURI(path), srv)
	if err != nil {
		t.Fatal(err)
	}
	libraryCall(t, e, "hover", cached)
	origin, err := e.libraryOrigin(cached)
	if err != nil {
		t.Fatal(err)
	}
	version, err := e.openLibraryOriginal(ctx, origin, srv)
	if err != nil {
		t.Fatal(err)
	}
	revision := int64(1)
	text := "package unsaved"
	req := Request{Path: path, DocumentOwner: "library-original-editor", Revision: &revision, Text: &text}
	if _, err = e.syncDocument(ctx, req); err != nil {
		t.Fatal(err)
	}
	if _, _, err = e.libraryRequest(ctx, "hover", Request{Path: cached}); err == nil || !strings.Contains(err.Error(), "editor buffer") {
		t.Fatal("library overwrote active original buffer", err)
	}
	if err = e.verifyLibraryOriginal(origin, srv, version); err == nil {
		t.Fatal("late editor lease was accepted")
	}
	srv.docMu.Lock()
	doc := srv.docs[toURI(path)]
	srv.docMu.Unlock()
	if doc.text != text || doc.owner != req.DocumentOwner {
		t.Fatal("original editor document changed", doc)
	}
	if _, err = e.closeDocument(ctx, req); err != nil {
		t.Fatal(err)
	}
	if err = e.verifyLibraryOriginal(origin, srv, version); err == nil {
		t.Fatal("closed/replaced original version accepted")
	}
	got := libraryCall(t, e, "hover", cached).(map[string]any)["markdown"]
	if got != toURI(path)+"|"+toURI(srv.Root)+"|opens=2" {
		t.Fatal("original was not reopened after editor close", got)
	}
	if len(e.documents) != 0 {
		t.Fatal("library navigation acquired an editor lease")
	}
}
