package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func revision(n int64) *int64    { return &n }
func textValue(s string) *string { return &s }
func TestSpringRelatedExplicitTextPreservesBufferLease(t *testing.T) {
	e, path := fixtureEngine(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	e.documents = map[string]bufferedDocument{path: {owner: "source-editor", revision: 3, text: "owned unsaved source"}}
	_, err = e.dispatch(context.Background(), "related", Request{Path: path, Root: filepath.Dir(path), Kind: "spring-bean", Text: textValue("explicit analysis source")})
	if err != nil {
		t.Fatal(err)
	}
	if e.documents[path].text != "owned unsaved source" || e.documents[path].revision != 3 {
		t.Fatal("pure analysis changed the buffer lease")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("pure analysis changed disk", err)
	}
	_, err = e.dispatch(context.Background(), "related", Request{Path: path, Kind: "spring-bean"})
	if err == nil || !strings.Contains(err.Error(), "document owner") {
		t.Fatal("implicit disk analysis bypassed the active buffer", err)
	}
}
func documentHTTP(t *testing.T, e *Engine, route string, req Request, wantError string) map[string]any {
	t.Helper()
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	response := requestHTTP(e, "test-secret", route, string(raw), nil)
	var body map[string]any
	if err = json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if wantError != "" {
		if body["ok"] != false || !strings.Contains(body["error"].(string), wantError) {
			t.Fatalf("%s: wanted %q, got %s", route, wantError, response.Body)
		}
		return nil
	}
	if response.Code != 200 || body["ok"] != true {
		t.Fatalf("%s: %s", route, response.Body)
	}
	result, ok := body["result"].(map[string]any)
	if !ok {
		t.Fatalf("%s: result %v", route, body["result"])
	}
	return result
}
func publishFixture(t *testing.T, ctx context.Context, s *LSPServer, path string, version *int, message string) {
	t.Helper()
	params := map[string]any{"uri": toURI(path), "diagnostics": []any{map[string]any{"range": map[string]any{"start": map[string]int{"line": 0, "character": 0}, "end": map[string]int{"line": 0, "character": 1}}, "message": message, "severity": 2}}}
	if version != nil {
		params["version"] = *version
	}
	if _, err := s.Call(ctx, "fixture/publish", params); err != nil {
		t.Fatal(err)
	}
}
func TestBufferedDocumentHTTPAndStdio(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	disk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	req := Request{Path: path, DocumentOwner: "session-a", Revision: revision(0), Text: textValue("package unsaved\n// 😀x")}
	ack := documentHTTP(t, e, "document_sync", req, "")
	if ack["document_owner"] != req.DocumentOwner || ack["revision"] != float64(0) || ack["version"] != float64(1) {
		t.Fatal(ack)
	}
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	state := inspectFixture(t, ctx, srv)
	if state["docs"].(map[string]any)[toURI(path)].(map[string]any)["text"] != *req.Text {
		t.Fatal(state)
	}
	documentHTTP(t, e, "document_sync", req, "")
	state = inspectFixture(t, ctx, srv)
	if state["opens"] != float64(1) || state["changes"] != float64(0) {
		t.Fatal("retry duplicated notification", state)
	}
	semantic := req
	semantic.Text = nil
	hover := documentHTTP(t, e, "hover", semantic, "")
	if hover["revision"] != float64(0) || !strings.Contains(hover["value"].(map[string]any)["markdown"].(string), "package unsaved") {
		t.Fatal(hover)
	}
	for _, route := range []string{"symbols", "definition", "references", "workspace_symbols"} {
		documentHTTP(t, e, route, semantic, "")
	}
	documentHTTP(t, e, "hover", Request{Path: path}, "document owner")
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(cwd, path)
	if err != nil {
		t.Fatal(err)
	}
	documentHTTP(t, e, "hover", Request{Path: relative}, "document owner")
	documentHTTP(t, e, "related", semantic, "not supported")
	bad := req
	bad.DocumentOwner = "other"
	documentHTTP(t, e, "document_sync", bad, "owner conflict")
	documentHTTP(t, e, "hover", bad, "owner conflict")
	documentHTTP(t, e, "document_close", bad, "owner conflict")
	bad = req
	bad.Text = textValue("conflict")
	documentHTTP(t, e, "document_sync", bad, "conflicting")
	bad = semantic
	bad.Text = textValue("not a sync")
	documentHTTP(t, e, "hover", bad, "text conflicts")
	req.Revision = revision(1)
	req.Text = textValue("package unsaved\n// 😀changed")
	ack = documentHTTP(t, e, "document_sync", req, "")
	if ack["version"] != float64(2) {
		t.Fatal(ack)
	}
	state = inspectFixture(t, ctx, srv)
	end := state["change"].(map[string]any)["contentChanges"].([]any)[0].(map[string]any)["range"].(map[string]any)["end"].(map[string]any)
	if end["line"] != float64(1) || end["character"] != float64(6) {
		t.Fatal("UTF16 prior-buffer range", end)
	}
	documentHTTP(t, e, "hover", semantic, "stale")
	bad = req
	bad.Revision = revision(0)
	documentHTTP(t, e, "document_sync", bad, "stale")
	semantic.Revision = revision(1)
	diag := documentHTTP(t, e, "diagnostics", semantic, "")["value"].(map[string]any)
	if len(diag["items"].([]any)) != 0 || diag["version_confidence"] != "pending" {
		t.Fatal("previous diagnostics survived", diag)
	}
	old, current := 1, 2
	publishFixture(t, ctx, srv, path, &old, "old")
	diag = documentHTTP(t, e, "diagnostics", semantic, "")["value"].(map[string]any)
	if len(diag["items"].([]any)) != 0 || diag["version_confidence"] != "pending" {
		t.Fatal("stale diagnostics accepted", diag)
	}
	publishFixture(t, ctx, srv, path, &current, "current")
	diag = documentHTTP(t, e, "diagnostics", semantic, "")["value"].(map[string]any)
	if len(diag["items"].([]any)) != 1 || diag["version_confidence"] != "matched" || diag["diagnostic_version"] != float64(2) {
		t.Fatal(diag)
	}
	publishFixture(t, ctx, srv, path, &old, "late old warning")
	diag = documentHTTP(t, e, "diagnostics", semantic, "")["value"].(map[string]any)
	if diag["version_confidence"] != "matched" || diag["items"].([]any)[0].(map[string]any)["message"] != "current" {
		t.Fatal("late version replaced current diagnostics", diag)
	}
	publishFixture(t, ctx, srv, path, nil, "unversioned")
	diag = documentHTTP(t, e, "diagnostics", semantic, "")["value"].(map[string]any)
	if len(diag["items"].([]any)) != 1 || diag["version_confidence"] != "unversioned" || diag["diagnostic_version"] != nil {
		t.Fatal(diag)
	}
	bad = semantic
	bad.Revision = revision(0)
	documentHTTP(t, e, "document_close", bad, "stale")
	documentHTTP(t, e, "document_close", semantic, "")
	state = inspectFixture(t, ctx, srv)
	if state["closes"] != float64(1) || len(state["docs"].(map[string]any)) != 0 {
		t.Fatal(state)
	}
	documentHTTP(t, e, "document_close", semantic, "")
	documentHTTP(t, e, "document_sync", req, "session is closed")
	legacy := documentHTTP(t, e, "hover", Request{Path: path}, "")
	if _, ok := legacy["value"]; ok {
		t.Fatal("legacy wrapped", legacy)
	}
	if !strings.Contains(legacy["markdown"].(string), string(disk)) {
		t.Fatal(legacy)
	}
	req.DocumentOwner = "session-b"
	req.Revision = revision(0)
	ack = documentHTTP(t, e, "document_sync", req, "")
	if ack["version"].(float64) <= 2 {
		t.Fatal("reused diagnostic version", ack)
	}
	srv.Stop()
	req.Retry = true
	semantic = req
	semantic.Text = nil
	hover = documentHTTP(t, e, "hover", semantic, "")
	if hover["version"] != float64(1) || !strings.Contains(hover["value"].(map[string]any)["markdown"].(string), "😀changed") {
		t.Fatal(hover)
	}
	documentHTTP(t, e, "document_sync", req, "")
	next, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	if next == srv {
		t.Fatal("server did not restart")
	}
	state = inspectFixture(t, ctx, next)
	if state["opens"] != float64(1) || state["changes"] != float64(0) {
		t.Fatal(state)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(disk) {
		t.Fatal("buffer reached disk", string(after), err)
	}
}

func TestBufferedCloseBeforeFirstSyncRetiresOnlyRequestedOwner(t *testing.T) {
	e, path := fixtureEngine(t)
	req := Request{Path: path, DocumentOwner: "closed-before-first-sync", Revision: revision(4)}
	for attempt := 0; attempt < 2; attempt++ {
		closed := documentHTTP(t, e, "document_close", req, "")
		if closed["closed"] != true || closed["document_owner"] != req.DocumentOwner || closed["revision"] != float64(4) {
			t.Fatal("close acknowledgement changed requested identity", closed)
		}
	}
	if len(e.documents) != 0 || len(e.servers) != 0 {
		t.Fatal("closing an unopened lease started a server or retained text")
	}
	// The request was already in flight when the UI closed, but has not yet
	// arrived here. It must fail before starting LSP or reserving its buffer.
	late := req
	late.Text = textValue("package late_first_sync")
	documentHTTP(t, e, "document_sync", late, "session is closed")
	if len(e.documents) != 0 || len(e.servers) != 0 {
		t.Fatal("late first sync resurrected a retired owner")
	}
	// Retirement is scoped to path and owner. A new editor can own the path;
	// repeated cleanup from the old editor cannot close that newer lease.
	newer := Request{Path: path, DocumentOwner: "new-editor", Revision: revision(2), Text: textValue("package new_editor")}
	documentHTTP(t, e, "document_sync", newer, "")
	documentHTTP(t, e, "document_close", req, "")
	stale := newer
	stale.Revision = revision(1)
	documentHTTP(t, e, "document_close", stale, "stale document revision")
	e.documentMu.Lock()
	doc, exists := e.documents[path]
	newerRetired := e.closedDocuments[path][newer.DocumentOwner]
	e.documentMu.Unlock()
	if !exists || doc.owner != newer.DocumentOwner || doc.revision != 2 || newerRetired {
		t.Fatal("duplicate old/stale cleanup changed the newer lease", doc, newerRetired)
	}
	documentHTTP(t, e, "document_close", newer, "")
}
func TestBufferedSemanticDoesNotBlockSyncOrClose(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	req := Request{Path: path, DocumentOwner: "nonblocking", Revision: revision(0), Text: textValue("package hold\n// hold-hover")}
	documentHTTP(t, e, "document_sync", req, "")
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Request{Path: path, DocumentOwner: req.DocumentOwner, Revision: revision(0)})
	response := make(chan string, 1)
	go func() { response <- requestHTTP(e, "test-secret", "hover", string(raw), nil).Body.String() }()
	for deadline := time.Now().Add(2 * time.Second); ; {
		if inspectFixture(t, ctx, srv)["hovers"].(float64) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("hover did not enter fake child")
		}
		time.Sleep(time.Millisecond)
	}
	req.Revision = revision(1)
	req.Text = textValue("package new\n// current")
	synced := make(chan error, 1)
	go func() { _, err := e.dispatch(ctx, "document_sync", req); synced <- err }()
	select {
	case err := <-synced:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("semantic RPC blocked typing sync")
	}
	documentHTTP(t, e, "document_close", Request{Path: path, DocumentOwner: req.DocumentOwner, Revision: revision(0)}, "stale")
	documentHTTP(t, e, "document_close", Request{Path: path, DocumentOwner: req.DocumentOwner, Revision: revision(1)}, "")
	if _, err = srv.Call(ctx, "fixture/releaseHover", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case raw := <-response:
		var body map[string]any
		json.Unmarshal([]byte(raw), &body)
		result := body["result"].(map[string]any)
		if result["revision"] != float64(0) || result["version"] != float64(1) {
			t.Fatal("old RPC mislabeled", result)
		}
	case <-time.After(time.Second):
		t.Fatal("held hover did not finish")
	}
	documentHTTP(t, e, "document_sync", req, "session is closed")
}
func TestBufferedValidationAndOutOfOrder(t *testing.T) {
	e, path := fixtureEngine(t)
	valid := Request{Path: path, DocumentOwner: "validation", Revision: revision(2), Text: textValue("package current")}
	for _, req := range []Request{
		{Path: path, Revision: revision(0), Text: valid.Text}, {Path: path, DocumentOwner: "   ", Revision: revision(0), Text: valid.Text},
		{Path: path, DocumentOwner: "a", Text: valid.Text}, {Path: path, DocumentOwner: "a", Revision: revision(-1), Text: valid.Text},
	} {
		documentHTTP(t, e, "document_sync", req, "required")
	}
	bad := valid
	bad.Path = "relative.go"
	documentHTTP(t, e, "document_sync", bad, "absolute local")
	bad = valid
	bad.Text = nil
	documentHTTP(t, e, "document_sync", bad, "text is required")
	// Claiming a previously disk-opened document still establishes a fresh
	// diagnostic version, even when its initial buffer text is identical.
	disk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	documentHTTP(t, e, "hover", Request{Path: path}, "")
	valid.Text = textValue(string(disk))
	ack := documentHTTP(t, e, "document_sync", valid, "")
	if ack["version"] != float64(2) {
		t.Fatal("lease claim reused disk diagnostics", ack)
	}
	older := valid
	older.Revision = revision(1)
	older.Text = textValue("package obsolete")
	documentHTTP(t, e, "document_sync", older, "stale")
	documentHTTP(t, e, "document_close", older, "stale")
	documentHTTP(t, e, "document_close", valid, "")
	documentHTTP(t, e, "document_sync", older, "session is closed")
	var decoded Request
	if err := json.Unmarshal([]byte(`{"owner":{"line":1,"col":2},"document_owner":"a","revision":0}`), &decoded); err != nil || decoded.Owner == nil || decoded.Owner.Col != 2 || decoded.DocumentOwner != "a" {
		t.Fatal(decoded, err)
	}
}

// A close during initialization retires the lease before the older sync
// continuation gets a chance to synchronize its text into the new child.
func TestBufferedCloseDuringStartup(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	cfg := e.config["go"]
	cfg.Env["HERDR_TEST_INITIALIZE_PAUSE"] = "1"
	e.config["go"] = cfg
	req := Request{Path: path, DocumentOwner: "closing-during-startup", Revision: revision(0), Text: textValue("package unsaved")}
	completed := make(chan error, 1)
	go func() { _, err := e.dispatch(ctx, "document_sync", req); completed <- err }()
	for deadline := time.Now().Add(time.Second); ; {
		e.documentMu.Lock()
		_, accepted := e.documents[path]
		e.documentMu.Unlock()
		if accepted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("sync did not reserve its lease")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := e.legacyOpen(ctx, nil, path); err == nil || !strings.Contains(err.Error(), "document owner") {
		t.Fatal("legacy secondary open bypassed pending lease", err)
	}
	if _, err := e.legacyRead(path); err == nil || !strings.Contains(err.Error(), "document owner") {
		t.Fatal("legacy secondary read bypassed pending lease", err)
	}
	documentHTTP(t, e, "document_close", Request{Path: path, DocumentOwner: req.DocumentOwner, Revision: revision(0)}, "")
	select {
	case err := <-completed:
		if err == nil || !strings.Contains(err.Error(), "not open") {
			t.Fatal("closed lease resurrected", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sync did not finish initialization")
	}
	documentHTTP(t, e, "document_sync", req, "session is closed")
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	if len(e.documents) != 0 {
		t.Fatal("closed buffer was retained", e.documents)
	}
}

func TestBufferedUnsupportedSyncRetainsLease(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	srv.mu.Lock()
	srv.capabilities["textDocumentSync"] = json.RawMessage(`{"openClose":false,"change":1}`)
	srv.mu.Unlock()
	req := Request{Path: path, DocumentOwner: "unsupported", Revision: revision(0), Text: textValue("package unsaved")}
	documentHTTP(t, e, "document_sync", req, "does not support opening buffered")
	documentHTTP(t, e, "hover", Request{Path: path}, "document owner")
	if len(inspectFixture(t, ctx, srv)["docs"].(map[string]any)) != 0 {
		t.Fatal("acknowledged unsupported buffer")
	}
	documentHTTP(t, e, "document_close", req, "")
}

func TestBufferedNavigationPreviews(t *testing.T) {
	e, path := fixtureEngine(t)
	text := "package unsaved // fixture-preview\n"
	req := Request{Path: path, DocumentOwner: "preview-source", Revision: revision(0), Text: &text}
	documentHTTP(t, e, "document_sync", req, "")
	semantic := req
	semantic.Text = nil
	for _, route := range []string{"definition", "references"} {
		result := documentHTTP(t, e, route, semantic, "")
		if result["revision"] != float64(0) || result["document_owner"] != req.DocumentOwner || result["version"] != float64(1) {
			t.Fatal("preview changed source snapshot", result)
		}
		items := result["value"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["text"] != "package unsaved // fixture-preview" {
			t.Fatal(route, items)
		}
	}
	target := filepath.Join(filepath.Dir(path), "target.go")
	if err := os.WriteFile(target, []byte("package saved_target\n"), 0600); err != nil {
		t.Fatal(err)
	}
	targetText := "package other_owner_buffer\n"
	documentHTTP(t, e, "document_sync", Request{Path: target, DocumentOwner: "preview-target-other-owner", Revision: revision(3), Text: &targetText}, "")
	current := e.bufferPreviews([]Location{{Path: target, Line: 0}})
	if current[0].Text != "package other_owner_buffer" {
		t.Fatal("target owner buffer not used", current)
	}
	legacy := withPreviews([]Location{{Path: target, Line: 0}})
	if legacy[0].Text != "package saved_target" {
		t.Fatal("legacy preview stopped using disk", legacy)
	}
	documentHTTP(t, e, "document_close", Request{Path: target, DocumentOwner: "preview-target-other-owner", Revision: revision(3)}, "")
	closed := e.bufferPreviews([]Location{{Path: target, Line: 0}})
	if closed[0].Text != "package saved_target" {
		t.Fatal("closed buffer preview survived lease", closed)
	}
	bytes, err := os.ReadFile(target)
	if err != nil || string(bytes) != "package saved_target\n" {
		t.Fatal("preview mutated disk", string(bytes), err)
	}
}

func TestBufferedSuperNavigation(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	sourceDisk := "class Child extends DiskParent {}\n"
	if err := os.WriteFile(path, []byte(sourceDisk), 0600); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(filepath.Dir(path), "Parent.go")
	parentDisk := "class Parent {\n public int diskOnly() { return 1; }\n}\n"
	if err := os.WriteFile(parent, []byte(parentDisk), 0600); err != nil {
		t.Fatal(err)
	}
	source := "/* 😀 */ class Child extends Parent {} // fixture-super\n"
	parentText := "class Parent {\n public String answer() { return \"unsaved-parent\"; }\n}\n"
	documentHTTP(t, e, "document_sync", Request{Path: path, DocumentOwner: "super-source", Revision: revision(0), Text: &source}, "")
	documentHTTP(t, e, "document_sync", Request{Path: parent, DocumentOwner: "other-parent-owner", Revision: revision(4), Text: &parentText}, "")
	owner := superTestPoint(source, "Child")
	req := Request{Path: path, DocumentOwner: "super-source", Revision: revision(0), Kind: "super", Name: "answer", Owner: &owner}
	result := documentHTTP(t, e, "related", req, "")
	if result["document_owner"] != "super-source" || result["revision"] != float64(0) || result["version"] != float64(1) {
		t.Fatal("super lost source snapshot", result)
	}
	items := result["value"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["path"] != parent || items[0].(map[string]any)["line"] != float64(1) || !strings.Contains(items[0].(map[string]any)["text"].(string), "unsaved-parent") {
		t.Fatal("super read disk header or parent", result)
	}
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	state := inspectFixture(t, ctx, srv)
	if state["docs"].(map[string]any)[toURI(parent)].(map[string]any)["text"] != parentText {
		t.Fatal("secondary buffer was not synced", state)
	}
	bad := req
	bad.DocumentOwner = "not-owner"
	documentHTTP(t, e, "related", bad, "owner conflict")
	bad = req
	bad.Revision = revision(1)
	documentHTTP(t, e, "related", bad, "stale")
	documentHTTP(t, e, "related", Request{Path: path, Kind: "super", Owner: &owner}, "document owner")
	// Change the unsaved primary header to remove its parent without saving.
	noParent := "/* 😀 */ class Child {} // fixture-super\n"
	documentHTTP(t, e, "document_sync", Request{Path: path, DocumentOwner: req.DocumentOwner, Revision: revision(1), Text: &noParent}, "")
	req.Revision = revision(1)
	result = documentHTTP(t, e, "related", req, "")
	if len(result["value"].([]any)) != 0 {
		t.Fatal("changed buffer header ignored", result)
	}
	sourceBytes, _ := os.ReadFile(path)
	parentBytes, _ := os.ReadFile(parent)
	if string(sourceBytes) != sourceDisk || string(parentBytes) != parentDisk {
		t.Fatal("super saved a buffer")
	}
	// Releasing both leases restores the original unwrapped legacy contract.
	documentHTTP(t, e, "document_close", req, "")
	documentHTTP(t, e, "document_close", Request{Path: parent, DocumentOwner: "other-parent-owner", Revision: revision(4)}, "")
	legacy, err := e.dispatch(ctx, "related", Request{Path: path, Kind: "super", Owner: &owner})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := legacy.([]Location); !ok {
		t.Fatalf("legacy super wrapped: %#v", legacy)
	}
}

func TestBufferedSuperRejectsChangedTargetWithoutBlockingSync(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	parent := filepath.Join(filepath.Dir(path), "Parent.go")
	if err := os.WriteFile(parent, []byte("class Parent {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source := "class Child extends Parent {} // fixture-super\n"
	parentText := "class Parent {\n public int answer() { return 1; } // hold-super\n}\n"
	documentHTTP(t, e, "document_sync", Request{Path: path, DocumentOwner: "held-super", Revision: revision(0), Text: &source}, "")
	target := Request{Path: parent, DocumentOwner: "changing-target", Revision: revision(0), Text: &parentText}
	documentHTTP(t, e, "document_sync", target, "")
	owner := superTestPoint(source, "Child")
	req := Request{Path: path, DocumentOwner: "held-super", Revision: revision(0), Kind: "super", Name: "answer", Owner: &owner}
	raw, _ := json.Marshal(req)
	pending := make(chan string, 1)
	go func() { pending <- requestHTTP(e, "test-secret", "related", string(raw), nil).Body.String() }()
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(2 * time.Second); ; {
		if inspectFixture(t, ctx, srv)["symbol_requests"].(float64) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("super symbols did not enter child")
		}
		time.Sleep(time.Millisecond)
	}
	changed := "class Parent {\n public int other() { return 2; }\n}\n"
	target.Revision = revision(1)
	target.Text = &changed
	updated := make(chan error, 1)
	go func() { _, err := e.dispatch(ctx, "document_sync", target); updated <- err }()
	select {
	case err := <-updated:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("super RPC blocked target typing")
	}
	if _, err = srv.Call(ctx, "fixture/releaseSymbols", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-pending:
		var body map[string]any
		json.Unmarshal([]byte(response), &body)
		if body["ok"] != false || !strings.Contains(body["error"].(string), "stale target") {
			t.Fatal("mixed target revision accepted", response)
		}
	case <-time.After(time.Second):
		t.Fatal("super request did not finish")
	}
}

func TestBufferedSuperRejectsCrossRootTarget(t *testing.T) {
	e, path := fixtureEngine(t)
	other := filepath.Join(filepath.Dir(path), "other")
	if err := os.Mkdir(other, 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(other, "go.mod"), []byte("module other"), 0600)
	parent := filepath.Join(other, "Parent.go")
	os.WriteFile(parent, []byte("class Parent {}\n"), 0600)
	source := "class Child extends Parent {} // fixture-super-cross-root\n"
	parentText := "class Parent { public int answer() { return 1; } }\n"
	documentHTTP(t, e, "document_sync", Request{Path: path, DocumentOwner: "cross-source", Revision: revision(0), Text: &source}, "")
	documentHTTP(t, e, "document_sync", Request{Path: parent, DocumentOwner: "cross-target", Revision: revision(0), Text: &parentText}, "")
	owner := superTestPoint(source, "Child")
	documentHTTP(t, e, "related", Request{Path: path, DocumentOwner: "cross-source", Revision: revision(0), Kind: "super", Name: "answer", Owner: &owner}, "another language server/root")
}

func TestDocumentLeaseRenewalAndExpiredOwnerHandoff(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	old := Request{Path: path, DocumentOwner: "old-window", Revision: revision(2), Text: textValue("package owned\n")}
	documentHTTP(t, e, "document_sync", old, "")
	doc := e.documents[path]
	doc.touched = time.Now().Add(-2 * documentLeaseTTL)
	e.documents[path] = doc
	touch := old
	touch.Text = nil
	documentHTTP(t, e, "document_touch", touch, "")
	next := old
	next.DocumentOwner = "new-window"
	next.Revision = revision(0)
	next.Text = textValue("package newbuffer\n")
	documentHTTP(t, e, "document_sync", next, "document owner conflict")
	wrong := touch
	wrong.Revision = revision(1)
	documentHTTP(t, e, "document_touch", wrong, "stale document revision")
	wrong = touch
	wrong.DocumentOwner = "stranger"
	documentHTTP(t, e, "document_touch", wrong, "document owner conflict")
	doc = e.documents[path]
	doc.touched = time.Now().Add(-2 * documentLeaseTTL)
	e.documents[path] = doc
	documentHTTP(t, e, "document_sync", next, "")
	if e.documents[path].owner != "new-window" || e.documents[path].text != *next.Text {
		t.Fatal("expired handoff lost new buffer")
	}
	documentHTTP(t, e, "document_sync", old, "session is closed")
	documentHTTP(t, e, "document_close", old, "")
	srv, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	state := inspectFixture(t, ctx, srv)
	if state["docs"].(map[string]any)[toURI(path)].(map[string]any)["text"] != *next.Text {
		t.Fatal("retired owner changed server buffer")
	}
}
