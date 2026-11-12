package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func waitProject(t *testing.T, e *Engine, root string) projectSnapshot {
	t.Helper()
	root, rootErr := e.projectRoot(root)
	if rootErr != nil {
		t.Fatal(rootErr)
	}
	e.projectMu.Lock()
	p := e.projects[root]
	e.projectMu.Unlock()
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
		t.Fatal("project did not finish")
	}
	result, err := e.projectStatus(Request{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	return result.(projectSnapshot)
}
func TestProjectPreparationCoalescesAndWarmsOneSource(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	root, _ = e.projectRoot(root)
	for i := 0; i < 8; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("other%d.go", i)), []byte("package fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.prepareProject(Request{Root: root}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	status := waitProject(t, e, root)
	if status.State != "ready" || len(status.Contexts) != 1 || status.SourceCount != 9 {
		t.Fatalf("unexpected status: %+v", status)
	}
	s, err := e.Server(context.Background(), path, false)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.capabilities["workspaceSymbolProvider"] = json.RawMessage("true")
	s.mu.Unlock()
	e.projectMu.Lock()
	first := e.projects[root]
	e.projectMu.Unlock()
	_, _ = e.prepareProject(Request{Root: root})
	e.projectMu.Lock()
	same := e.projects[root] == first
	e.projectMu.Unlock()
	if !same {
		t.Fatal("completed preparation was restarted without retry")
	}
	if _, err = e.prepareProject(Request{Root: root, Retry: true}); err != nil {
		t.Fatal(err)
	}
	if got := waitProject(t, e, root); got.State != "ready" {
		t.Fatalf("retry: %+v", got)
	}
	raw, err := s.Call(context.Background(), "fixture/inspect", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var inspection struct {
		Opens   int `json:"opens"`
		Changes int `json:"changes"`
	}
	if err = json.Unmarshal(raw, &inspection); err != nil {
		t.Fatal(err)
	}
	if inspection.Opens != 1 || inspection.Changes != 0 {
		t.Fatalf("warmup opened/changed more than representative: %+v", inspection)
	}
	s.mu.Lock()
	s.progress["project-test"] = "Preparing dependencies"
	s.mu.Unlock()
	result, _ := e.projectStatus(Request{Root: root})
	if !strings.Contains(strings.Join(result.(projectSnapshot).Contexts[0].Busy, " "), "Preparing dependencies") {
		t.Fatal("live server progress missing")
	}
}
func TestProjectWarmupPreservesActiveAndPendingLeases(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := context.Background()
	s, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.syncText(ctx, path, "unsaved foreground", "editor-owner"); err != nil {
		t.Fatal(err)
	}
	if err = e.warmProjectSource(ctx, s, path); err != nil {
		t.Fatal(err)
	}
	s.docMu.Lock()
	doc := s.docs[toURI(path)]
	s.docMu.Unlock()
	if doc.text != "unsaved foreground" || doc.owner != "editor-owner" {
		t.Fatalf("foreground overwritten: %+v", doc)
	}
	pending := filepath.Join(filepath.Dir(path), "pending.go")
	if err = os.WriteFile(pending, []byte("disk"), 0600); err != nil {
		t.Fatal(err)
	}
	e.documentMu.Lock()
	e.documents = map[string]bufferedDocument{pending: {owner: "pending-editor", text: "unsaved"}}
	e.documentMu.Unlock()
	if err = e.warmProjectSource(ctx, s, pending); err != nil {
		t.Fatal(err)
	}
	s.docMu.Lock()
	_, opened := s.docs[toURI(pending)]
	s.docMu.Unlock()
	if opened {
		t.Fatal("pending lease opened with disk text")
	}
}
func TestProjectScanBoundsAndSkips(t *testing.T) {
	root := t.TempDir()
	e := &Engine{config: map[string]ServerConfig{"go": {Extensions: []string{"go"}, Markers: []string{"go.mod"}}}, cache: filepath.Join(root, "cache")}
	for _, name := range []string{"node_modules", "vendor", ".git", "cache", ".claude", ".codex", ".agents", ".worktrees"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name, "ignored.go"), []byte("package hidden"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 6; i++ {
		dir := filepath.Join(root, fmt.Sprint(i))
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"go.mod", "source.go"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	p := &projectAnalysis{snapshot: projectSnapshot{Root: root}}
	if err := e.scanProject(context.Background(), p, 100, 2); err != nil {
		t.Fatal(err)
	}
	if p.snapshot.FileCount != 12 || p.snapshot.SourceCount != 6 || len(p.snapshot.Contexts) != 2 || !p.snapshot.Truncated {
		t.Fatalf("scan limit/skip failed: %+v", p.snapshot)
	}
	if err := e.scanProject(context.Background(), p, 3, 16); err != nil {
		t.Fatal(err)
	}
	if p.snapshot.FileCount != 3 || !p.snapshot.Truncated {
		t.Fatalf("file limit failed: %+v", p.snapshot)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.scanProject(ctx, p, 100, 16); err != context.Canceled {
		t.Fatalf("scan cancellation: %v", err)
	}
}

func TestProjectPreparationSkipsAgentWorktrees(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	for _, metadata := range []string{".claude", ".codex", ".agents", ".worktrees"} {
		dir := filepath.Join(root, metadata, "worktrees", "branch")
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"go.mod", "duplicate.go"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("module duplicate"), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := e.prepareProject(Request{Root: root}); err != nil {
		t.Fatal(err)
	}
	got := waitProject(t, e, root)
	if got.State != "ready" || got.SourceCount != 1 || len(got.Contexts) != 1 || got.Contexts[0].Root != root {
		t.Fatalf("agent checkout was included in project preparation: %+v", got)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.servers) != 1 {
		t.Fatalf("agent checkout consumed server pool: %d servers", len(e.servers))
	}
}
func TestProjectCancellationAndConcurrencyBound(t *testing.T) {
	e, path := fixtureEngine(t)
	cfg := e.config["go"]
	cfg.Env["HERDR_TEST_INITIALIZE_PAUSE"] = "1"
	e.config["go"] = cfg
	root := filepath.Dir(path)
	for i := 0; i < 6; i++ {
		dir := filepath.Join(root, fmt.Sprintf("project%d", i))
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"go.mod", "source.go"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := e.prepareProject(Request{Root: dir}); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(time.Second)
	for len(e.projectSlots) < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(e.projectSlots) != 2 || cap(e.projectSlots) != 2 {
		t.Fatal("expected two admitted background preparations")
	}
	started := time.Now()
	e.closeProjects()
	if time.Since(started) > time.Second {
		t.Fatal("cancelled jobs did not stop promptly")
	}
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	for _, p := range e.projects {
		select {
		case <-p.done:
		default:
			t.Fatal("job survives closeProjects")
		}
		if got := e.projectSnapshotLocked(p); got.State == "ready" {
			t.Fatalf("cancelled job claimed ready: %+v", got)
		}
	}
}
func TestProjectValidationAndNoConfiguredSources(t *testing.T) {
	e, path := fixtureEngine(t)
	if _, err := e.prepareProject(Request{Root: "relative"}); err == nil {
		t.Fatal("relative root accepted")
	}
	if _, err := e.prepareProject(Request{Root: path}); err == nil {
		t.Fatal("file root accepted")
	}
	root := t.TempDir()
	status, err := e.projectStatus(Request{Root: root})
	if err != nil || status.(projectSnapshot).State != "error" {
		t.Fatalf("unknown: %v %v", status, err)
	}
	if _, err = e.prepareProject(Request{Root: root}); err != nil {
		t.Fatal(err)
	}
	if got := waitProject(t, e, root); got.State != "ready" || len(got.Contexts) != 0 {
		t.Fatalf("empty project: %+v", got)
	}
	e.Close()
	if _, err = e.prepareProject(Request{Root: root}); err == nil {
		t.Fatal("closed engine accepted preparation")
	}
}

func TestProjectPreparationDoesNotEvictForegroundPool(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	var foreground []*LSPServer
	for i := 0; i < 4; i++ {
		dir := filepath.Join(root, fmt.Sprintf("root%d", i))
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"go.mod", "source.go"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if i < 3 {
			s, err := e.Server(context.Background(), filepath.Join(dir, "source.go"), false)
			if err != nil {
				t.Fatal(err)
			}
			foreground = append(foreground, s)
		} else {
			if _, err := e.prepareProject(Request{Root: dir}); err != nil {
				t.Fatal(err)
			}
			got := waitProject(t, e, dir)
			if got.State != "deferred" || len(got.Contexts) != 1 || got.Contexts[0].State != "deferred" || got.Contexts[0].Error != "" {
				t.Fatalf("capacity should defer without a server failure: %+v", got)
			}
			for _, s := range foreground {
				if s.stopped() {
					t.Fatal("background preparation evicted foreground server")
				}
			}
			if _, err := e.Server(context.Background(), filepath.Join(dir, "source.go"), false); err != nil {
				t.Fatal(err)
			}
			result, _ := e.projectStatus(Request{Root: dir})
			if opened := result.(projectSnapshot); opened.State != "ready" || opened.Contexts[0].State != "ready" || opened.Contexts[0].Error != "" {
				t.Fatalf("foreground readiness did not replace deferral: %+v", opened)
			}
		}
	}
	// Foreground admission can retire one idle server, never background warmup.
	for _, s := range foreground[1:] {
		if s.stopped() {
			t.Fatal("background preparation evicted foreground server")
		}
	}
}

func TestProjectWarmupYieldsToForegroundAndBoundsNotification(t *testing.T) {
	e, path := fixtureEngine(t)
	s := &LSPServer{lang: "go", docs: map[string]document{}, documentVersions: map[string]int{}, capabilities: map[string]json.RawMessage{"textDocumentSync": json.RawMessage("1")}, outgoing: make(chan outbound), done: make(chan struct{})}
	for _, lock := range []*sync.Mutex{&e.documentMu, &s.docMu} {
		lock.Lock()
		returned := make(chan error, 1)
		go func() { returned <- e.warmProjectSource(context.Background(), s, path) }()
		select {
		case err := <-returned:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(150 * time.Millisecond):
			lock.Unlock()
			t.Fatal("background warmup waited for foreground mutex")
		}
		lock.Unlock()
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.warmProjectSource(ctx, s, path); err != context.Canceled {
		t.Fatalf("cancelled warmup: %v", err)
	}
	// No transport reader: even an otherwise unbounded caller must relinquish
	// the foreground mutexes after the one-second notification budget.
	transport, err := e.Server(context.Background(), path, false)
	if err != nil {
		t.Fatal(err)
	}
	s.proc, s.stdin, s.stdout = transport.proc, transport.stdin, transport.stdout
	started := time.Now()
	if err := e.warmProjectSource(context.Background(), s, path); err != context.DeadlineExceeded {
		t.Fatalf("backpressure: %v", err)
	}
	if elapsed := time.Since(started); elapsed > 1500*time.Millisecond {
		t.Fatalf("notification exceeded budget: %v", elapsed)
	}
	if !s.stopped() || len(s.docs) != 0 {
		t.Fatal("ambiguous warmup timeout left a usable server or guessed document ledger")
	}
	if !e.documentMu.TryLock() {
		t.Fatal("engine document lock leaked")
	}
	e.documentMu.Unlock()
	if !s.docMu.TryLock() {
		t.Fatal("server document lock leaked")
	}
	s.docMu.Unlock()
	ctx, cancel = context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	s = &LSPServer{lang: "go", docs: map[string]document{}, documentVersions: map[string]int{}, capabilities: map[string]json.RawMessage{"textDocumentSync": json.RawMessage("1")}, outgoing: make(chan outbound), done: make(chan struct{}), proc: transport.proc, stdin: transport.stdin, stdout: transport.stdout}
	started = time.Now()
	if err := e.warmProjectSource(ctx, s, path); err != context.DeadlineExceeded {
		t.Fatalf("parent deadline: %v", err)
	}
	if time.Since(started) > 150*time.Millisecond {
		t.Fatal("parent cancellation did not interrupt warmup")
	}
}

func TestProjectReportsBusyDuringWorkspaceWarmup(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	ready := make(chan struct{})
	close(ready)
	s := &LSPServer{Root: root, lang: "go", state: "ready", ready: ready, done: make(chan struct{}), outgoing: make(chan outbound), pending: map[int64]chan rpcReply{}, capabilities: map[string]json.RawMessage{"workspaceSymbolProvider": json.RawMessage("true")}, progress: map[string]string{"warm": "Preparing workspace"}}
	e.mu.Lock()
	e.servers["go\x00"+root] = s
	e.mu.Unlock()
	t.Cleanup(func() { e.closeProjects(); e.mu.Lock(); delete(e.servers, "go\x00"+root); e.mu.Unlock() })
	entered := make(chan struct{})
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			case message := <-s.outgoing:
				message.ack <- nil
				var body struct {
					Method string `json:"method"`
				}
				_ = json.Unmarshal(message.body, &body)
				if body.Method == "workspace/symbol" {
					close(entered)
				}
			}
		}
	}()
	// This transport deliberately withholds the workspace response.
	if _, err := e.prepareProject(Request{Root: root}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("workspace warmup was not requested")
	}
	result, err := e.projectStatus(Request{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	status := result.(projectSnapshot)
	if status.State != "preparing" || len(status.Contexts) != 1 || status.Contexts[0].State != "preparing" || len(status.Contexts[0].Busy) != 1 {
		t.Fatalf("pending workspace progress missing: %+v", status)
	}
	e.closeProjects()
	// The minimal in-memory transport has no process to stop.
	e.mu.Lock()
	delete(e.servers, "go\x00"+root)
	e.mu.Unlock()
}

func TestProjectCompletedCacheBoundPreservesRunningJobs(t *testing.T) {
	e := &Engine{projects: map[string]*projectAnalysis{}, cache: t.TempDir()}
	running := &projectAnalysis{snapshot: projectSnapshot{State: "preparing"}, done: make(chan struct{})}
	e.projects["running"] = running
	roots := []string{}
	for i := 0; i < projectCompletedLimit+3; i++ {
		root := t.TempDir()
		roots = append(roots, root)
		if _, err := e.prepareProject(Request{Root: root}); err != nil {
			t.Fatal(err)
		}
		if got := waitProject(t, e, root); got.State != "ready" {
			t.Fatalf("empty project preparation: %+v", got)
		}
	}
	e.projectMu.Lock()
	if len(e.projects) != projectCompletedLimit+1 || e.projects["running"] != running {
		t.Fatalf("completed cache grew or running job evicted: %d", len(e.projects))
	}
	_, oldestRetained := e.projects[roots[0]]
	e.projectMu.Unlock()
	if oldestRetained {
		t.Fatal("oldest completed metadata retained beyond bound")
	}
	if result, err := e.projectStatus(Request{Root: roots[0]}); err != nil || result.(projectSnapshot).State != "error" {
		t.Fatalf("evicted metadata status: %v %v", result, err)
	}
}

func TestProjectCompletionReleasesServerAndStatusUsesCurrentPool(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	if _, err := e.prepareProject(Request{Root: root}); err != nil {
		t.Fatal(err)
	}
	status := waitProject(t, e, root)
	if status.State != "ready" {
		t.Fatalf("prepare: %+v", status)
	}
	e.projectMu.Lock()
	p := e.projects[root]
	for _, c := range p.snapshot.Contexts {
		if c.server != nil {
			t.Fatal("completed snapshot retains server documents")
		}
	}
	e.projectMu.Unlock()
	key := status.Contexts[0].Lang + "\x00" + status.Contexts[0].Root
	e.mu.Lock()
	previous := e.servers[key]
	delete(e.servers, key)
	e.mu.Unlock()
	defer previous.Stop()
	result, err := e.projectStatus(Request{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	missing := result.(projectSnapshot)
	if missing.State != "deferred" || missing.Contexts[0].State != "deferred" || missing.Contexts[0].Error != "" {
		t.Fatalf("evicted server falsely ready: %+v", missing)
	}
	replacement := &LSPServer{state: "ready", progress: map[string]string{"fresh": "Current server progress"}}
	e.mu.Lock()
	e.servers[key] = replacement
	e.mu.Unlock()
	t.Cleanup(func() { e.mu.Lock(); delete(e.servers, key); e.mu.Unlock() })
	result, err = e.projectStatus(Request{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	fresh := result.(projectSnapshot)
	if fresh.State != "ready" || len(fresh.Contexts[0].Busy) != 1 || fresh.Contexts[0].Busy[0] != "Current server progress" {
		t.Fatalf("status did not resolve current pool: %+v", fresh)
	}
	e.projectMu.Lock()
	retained := p.snapshot.Contexts[0].server
	e.projectMu.Unlock()
	if retained != nil {
		t.Fatal("status query reattached pooled server to completed cache")
	}
}

func projectPoolPaths(t *testing.T, root string, count int) []string {
	t.Helper()
	paths := []string{}
	for i := 0; i < count; i++ {
		dir := filepath.Join(root, fmt.Sprintf("pool%d", i))
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"go.mod", "source.go"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		paths = append(paths, filepath.Join(dir, "source.go"))
	}
	return paths
}

func TestPoolProtectsLeasesAndPendingRequests(t *testing.T) {
	e, path := fixtureEngine(t)
	paths := projectPoolPaths(t, filepath.Dir(path), 4)
	servers := []*LSPServer{}
	for _, path := range paths[:3] {
		s, err := e.Server(context.Background(), path, false)
		if err != nil {
			t.Fatal(err)
		}
		servers = append(servers, s)
	}
	// Both attached and not-yet-attached editor leases protect their context.
	e.documentMu.Lock()
	e.documents = map[string]bufferedDocument{
		paths[0]: {owner: "attached", server: servers[0], touched: time.Now()},
		paths[1]: {owner: "pending", touched: time.Now()},
	}
	e.documentMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	returned := make(chan error, 1)
	go func() { _, err := servers[2].Call(ctx, "fixture/hang", nil); returned <- err }()
	deadline := time.Now().Add(time.Second)
	for {
		servers[2].mu.Lock()
		pending := len(servers[2].pending)
		servers[2].mu.Unlock()
		if pending > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("RPC did not become pending")
		}
		time.Sleep(time.Millisecond)
	}
	// Concurrent admissions and stale-idle reaping must all preserve active work.
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.Server(context.Background(), paths[3], false); !errors.Is(err, errServerCapacity) {
				t.Errorf("protected pool admission: %v", err)
			}
		}()
	}
	wg.Wait()
	e.reap(time.Now().Add(11 * time.Minute))
	for _, s := range servers {
		if s.stopped() {
			t.Fatal("active context was retired")
		}
	}
	select {
	case err := <-returned:
		t.Fatalf("pending RPC was interrupted: %v", err)
	default:
	}
	cancel()
	select {
	case err := <-returned:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled RPC did not release its slot")
	}
	if _, err := e.Server(context.Background(), paths[3], false); err != nil {
		t.Fatal(err)
	}
	if !servers[2].stopped() || servers[0].stopped() || servers[1].stopped() {
		t.Fatal("foreground did not replace only the now-idle context")
	}
	if _, err := servers[2].Call(context.Background(), "fixture/echo", nil); !errors.Is(err, errServerCapacity) {
		t.Fatalf("late unleased request did not receive scheduling result: %v", err)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.servers) != languageServerLimit || len(e.failed) != 0 {
		t.Fatalf("capacity changed pool bound or recorded failure: %d, %v", len(e.servers), e.failed)
	}
}

func TestPoolReclaimsStoppedContextWithoutEvictingLiveServers(t *testing.T) {
	e, path := fixtureEngine(t)
	paths := projectPoolPaths(t, filepath.Dir(path), 4)
	servers := []*LSPServer{}
	for _, path := range paths[:3] {
		s, err := e.Server(context.Background(), path, false)
		if err != nil {
			t.Fatal(err)
		}
		servers = append(servers, s)
	}
	servers[0].fail(errors.New("fixture crashed"))
	if _, err := e.Server(context.Background(), paths[3], false); err != nil {
		t.Fatal(err)
	}
	if servers[1].stopped() || servers[2].stopped() {
		t.Fatal("live server evicted while a stopped context occupied capacity")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.servers) != languageServerLimit || e.failed["go\x00"+filepath.Dir(paths[0])] != "fixture crashed" {
		t.Fatalf("stopped context lost failure or capacity: %d %v", len(e.servers), e.failed)
	}
}

func TestProjectDeferredResolvesStartingReadyAndFailure(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	if _, err := e.prepareProject(Request{Root: root}); err != nil {
		t.Fatal(err)
	}
	if got := waitProject(t, e, root); got.State != "ready" {
		t.Fatal(got)
	}
	e.projectMu.Lock()
	p := e.projects[root]
	p.snapshot.Contexts[0].State = "deferred"
	e.projectMu.Unlock()
	e.mu.Lock()
	s := e.servers["go\x00"+root]
	e.mu.Unlock()
	s.mu.Lock()
	s.state = "starting"
	s.mu.Unlock()
	result, _ := e.projectStatus(Request{Root: root})
	if got := result.(projectSnapshot); got.State != "preparing" || got.Contexts[0].State != "preparing" {
		t.Fatalf("foreground startup missing: %+v", got)
	}
	s.mu.Lock()
	s.state = "ready"
	s.mu.Unlock()
	result, _ = e.projectStatus(Request{Root: root})
	if got := result.(projectSnapshot); got.State != "ready" || got.Contexts[0].Error != "" {
		t.Fatalf("foreground recovery missing: %+v", got)
	}
	s.fail(errors.New("fixture transport failure"))
	result, _ = e.projectStatus(Request{Root: root})
	if got := result.(projectSnapshot); got.State != "error" || got.Contexts[0].Error != "fixture transport failure" {
		t.Fatalf("real failure was hidden as deferral: %+v", got)
	}
	if _, err := e.Server(context.Background(), path, false); err == nil {
		t.Fatal("failed server restarted without retry")
	}
	result, _ = e.projectStatus(Request{Root: root})
	if got := result.(projectSnapshot); got.State != "error" || got.Contexts[0].Error == "" {
		t.Fatalf("removed failed server lost its error: %+v", got)
	}
	if _, err := e.Server(context.Background(), path, true); err != nil {
		t.Fatal(err)
	}
	result, _ = e.projectStatus(Request{Root: root})
	if got := result.(projectSnapshot); got.State != "ready" {
		t.Fatalf("retried live server did not recover: %+v", got)
	}
}
