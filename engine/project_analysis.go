package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type projectPreparationContext struct{}

const projectFileLimit = 50000
const projectContextLimit = 16
const projectDeadline = 3 * time.Minute
const projectSourceLimit = 2 << 20
const projectCompletedLimit = 12

type projectContext struct {
	Lang   string   `json:"lang"`
	Root   string   `json:"root"`
	State  string   `json:"state"`
	Error  string   `json:"error"`
	Busy   []string `json:"busy"`
	path   string
	server *LSPServer
}
type projectSnapshot struct {
	Root        string           `json:"root"`
	State       string           `json:"state"`
	Error       string           `json:"error"`
	FileCount   int              `json:"file_count"`
	SourceCount int              `json:"source_count"`
	Truncated   bool             `json:"truncated"`
	Contexts    []projectContext `json:"contexts"`
	StartedAt   time.Time        `json:"started_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}
type projectAnalysis struct {
	snapshot projectSnapshot // Engine.projectMu protects all mutable job state.
	cancel   context.CancelFunc
	done     chan struct{}
}

func (e *Engine) projectRoot(root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", errors.New("project root must be a local absolute directory")
	}
	// Keep the same lexical paths as Server/findRoot and editor leases. Resolving
	// symlinks only here would create a second server pool and bypass leases.
	root = filepath.Clean(root)
	info, err := os.Stat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || e.library(root) {
		return "", errors.New("project root must be a local source directory")
	}
	return root, nil
}
func (e *Engine) prepareProject(req Request) (any, error) {
	root, err := e.projectRoot(req.Root)
	if err != nil {
		return nil, err
	}
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	e.mu.Lock()
	closed := e.closed
	e.mu.Unlock()
	if closed {
		return nil, errors.New("engine stopped")
	}
	if e.projects == nil {
		e.projects = map[string]*projectAnalysis{}
	}
	if e.projectSlots == nil {
		e.projectSlots = make(chan struct{}, 2)
	}
	p := e.projects[root]
	if p != nil {
		select {
		case <-p.done:
			if !req.Retry {
				return e.projectSnapshotLocked(p), nil
			}
		default:
			return e.projectSnapshotLocked(p), nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), projectDeadline)
	now := time.Now()
	p = &projectAnalysis{snapshot: projectSnapshot{Root: root, State: "scanning", Contexts: []projectContext{}, StartedAt: now, UpdatedAt: now}, cancel: cancel, done: make(chan struct{})}
	e.projects[root] = p
	go e.runProject(ctx, p, req.Retry)
	return e.projectSnapshotLocked(p), nil
}
func (e *Engine) projectStatus(req Request) (any, error) {
	root, err := e.projectRoot(req.Root)
	if err != nil {
		return nil, err
	}
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	if p := e.projects[root]; p != nil {
		return e.projectSnapshotLocked(p), nil
	}
	return projectSnapshot{Root: root, State: "error", Error: "project has not been prepared", Contexts: []projectContext{}}, nil
}
func (e *Engine) projectSnapshotLocked(p *projectAnalysis) projectSnapshot {
	out := p.snapshot
	out.Contexts = append([]projectContext{}, out.Contexts...)
	failures, ready, deferred, preparing := 0, 0, 0, 0
	for i := range out.Contexts {
		c := &out.Contexts[i]
		c.Busy = []string{}
		srv := c.server
		if c.State == "ready" || c.State == "deferred" {
			e.mu.Lock()
			srv = e.servers[c.Lang+"\x00"+c.Root]
			failure := e.failed[c.Lang+"\x00"+c.Root]
			e.mu.Unlock()
			if srv == nil {
				c.State, c.Error = "deferred", ""
				if failure != "" {
					c.State, c.Error = "error", failure
				}
			} else {
				// A foreground open can prepare a previously deferred context.
				c.State, c.Error = "ready", ""
			}
		}
		if srv != nil {
			srv.mu.Lock()
			c.Busy = lspBusy(srv.progress)
			if srv.state == "stopped" {
				c.State = "error"
				c.Error = srv.err
				if c.Error == "" {
					c.Error = "language server stopped"
				}
			} else if c.State == "ready" && srv.state != "ready" {
				c.State, c.Error = "preparing", ""
			}
			srv.mu.Unlock()
			sort.Strings(c.Busy)
		}
		c.server = nil
		if c.State == "error" {
			failures++
		}
		if c.State == "ready" {
			ready++
		}
		if c.State == "deferred" {
			deferred++
		}
		if c.State == "preparing" {
			preparing++
		}
	}
	if out.State != "scanning" && out.State != "preparing" {
		out.State = "ready"
		if deferred > 0 {
			out.State = "deferred"
			if ready > 0 {
				out.State = "partial"
			}
		}
		if failures > 0 || out.Truncated || out.Error != "" {
			out.State = "partial"
			if ready == 0 && deferred == 0 {
				out.State = "error"
			}
		}
		if preparing > 0 {
			out.State = "preparing"
		}
	}
	return out
}

// Completed metadata is small and bounded; it never owns an LSP server or its
// potentially large document text. Running jobs are never evicted.
func (e *Engine) finishProject(p *projectAnalysis) {
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	for i := range p.snapshot.Contexts {
		p.snapshot.Contexts[i].server = nil
	}
	close(p.done)
	completed := []string{}
	for root, job := range e.projects {
		select {
		case <-job.done:
			completed = append(completed, root)
		default:
		}
	}
	sort.Slice(completed, func(i, j int) bool {
		return e.projects[completed[i]].snapshot.UpdatedAt.Before(e.projects[completed[j]].snapshot.UpdatedAt)
	})
	for len(completed) > projectCompletedLimit {
		delete(e.projects, completed[0])
		completed = completed[1:]
	}
}
func (e *Engine) closeProjects() {
	e.projectMu.Lock()
	jobs := make([]*projectAnalysis, 0, len(e.projects))
	for _, p := range e.projects {
		p.cancel()
		jobs = append(jobs, p)
	}
	e.projectMu.Unlock()
	for _, p := range jobs {
		<-p.done
	}
}

var projectSkipDirectories = map[string]bool{
	".git": true, ".hg": true, ".svn": true, "node_modules": true, "vendor": true,
	"dist": true, "build": true, "target": true, "out": true, ".next": true, ".nuxt": true,
	".venv": true, "venv": true, "__pycache__": true, ".gradle": true, ".idea": true,
	".cache": true, ".tox": true, "coverage": true, "Pods": true, ".dart_tool": true,
	".claude": true, ".codex": true, ".agents": true, ".worktrees": true,
}

// Limits apply to files, visited entries (including empty directories), and
// language/root contexts. WalkDir does not follow source directory symlinks.
func (e *Engine) scanProject(ctx context.Context, p *projectAnalysis, fileLimit, contextLimit int) error {
	contexts := []projectContext{}
	seen := map[string]bool{}
	roots := map[string]string{}
	files, sources, entries := 0, 0, 0
	truncated := false
	err := filepath.WalkDir(p.snapshot.Root, func(path string, d fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() && path != p.snapshot.Root && (projectSkipDirectories[d.Name()] || isWithin(path, e.cache)) {
			return filepath.SkipDir
		}
		entries++
		if entries > fileLimit*2+1 {
			truncated = true
			return fs.SkipAll
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		if files >= fileLimit {
			truncated = true
			return fs.SkipAll
		}
		files++
		lang, cfg := e.language(path)
		if lang == "" {
			return nil
		}
		sources++
		directoryKey := lang + "\x00" + filepath.Dir(path)
		root, found := roots[directoryKey]
		if !found {
			root = findRoot(path, cfg)
			roots[directoryKey] = root
		}
		key := lang + "\x00" + root
		if !seen[key] {
			seen[key] = true
			if len(contexts) < contextLimit {
				contexts = append(contexts, projectContext{Lang: lang, Root: root, State: "preparing", Busy: []string{}, path: path})
			} else {
				truncated = true
			}
		}
		return nil
	})
	e.projectMu.Lock()
	p.snapshot.FileCount, p.snapshot.SourceCount, p.snapshot.Truncated = files, sources, truncated
	p.snapshot.Contexts = contexts
	p.snapshot.UpdatedAt = time.Now()
	e.projectMu.Unlock()
	return err
}
func (e *Engine) runProject(ctx context.Context, p *projectAnalysis, retry bool) {
	defer e.finishProject(p)
	defer p.cancel()
	err := e.scanProject(ctx, p, projectFileLimit, projectContextLimit)
	e.projectMu.Lock()
	if err != nil {
		p.snapshot.Error = err.Error()
		p.snapshot.State = "error"
		p.snapshot.UpdatedAt = time.Now()
		e.projectMu.Unlock()
		return
	}
	p.snapshot.State = "preparing"
	count := len(p.snapshot.Contexts)
	e.projectMu.Unlock()
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			select {
			case e.projectSlots <- struct{}{}:
				defer func() { <-e.projectSlots }()
			case <-ctx.Done():
				e.projectContextResult(p, index, nil, ctx.Err())
				return
			}
			e.projectMu.Lock()
			path := p.snapshot.Contexts[index].path
			e.projectMu.Unlock()
			jobCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()
			jobCtx = context.WithValue(jobCtx, projectPreparationContext{}, true)
			srv, err := e.Server(jobCtx, path, retry)
			if err == nil {
				e.projectMu.Lock()
				p.snapshot.Contexts[index].server = srv
				p.snapshot.UpdatedAt = time.Now()
				e.projectMu.Unlock()
				err = e.warmProjectSource(jobCtx, srv, path)
			}
			if err == nil && projectWorkspaceSymbols(srv) {
				_, err = srv.Call(jobCtx, "workspace/symbol", map[string]any{"query": ""})
			}
			e.projectContextResult(p, index, srv, err)
		}(i)
	}
	wg.Wait()
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	p.snapshot.State = "ready"
	if ctx.Err() != nil {
		p.snapshot.Error = ctx.Err().Error()
	}
	p.snapshot.UpdatedAt = time.Now()
}
func (e *Engine) projectContextResult(p *projectAnalysis, index int, srv *LSPServer, err error) {
	e.projectMu.Lock()
	defer e.projectMu.Unlock()
	c := &p.snapshot.Contexts[index]
	c.server = srv
	c.State = "ready"
	c.Error = ""
	if err != nil {
		c.State = "error"
		c.Error = err.Error()
		if errors.Is(err, errServerCapacity) {
			c.State, c.Error = "deferred", ""
		}
	}
	p.snapshot.UpdatedAt = time.Now()
}
func projectWorkspaceSymbols(s *LSPServer) bool {
	s.mu.Lock()
	raw := append(json.RawMessage(nil), s.capabilities["workspaceSymbolProvider"]...)
	s.mu.Unlock()
	return len(raw) > 0 && string(raw) != "false" && string(raw) != "null"
}

// One representative document is enough to trigger lazy servers. Preserve any
// editor lease (including one waiting to attach to a restarted server) and any
// already synchronized text. Keep the normal document version ledger intact.
func (e *Engine) warmProjectSource(ctx context.Context, s *LSPServer, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// Disk work must not hold either foreground synchronization mutex.
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, projectSourceLimit+1))
	if err != nil {
		return err
	}
	if len(data) > projectSourceLimit {
		return fmt.Errorf("representative source exceeds %d bytes", projectSourceLimit)
	}
	text := strings.ToValidUTF8(string(data), "�")
	if err := ctx.Err(); err != nil {
		return err
	}
	// Background warming yields to active foreground synchronization. Check the
	// lease and document again atomically after reading; an editor may have
	// claimed the source while disk I/O was in flight.
	if !e.documentMu.TryLock() {
		return nil
	}
	defer e.documentMu.Unlock()
	if _, leased := e.documents[path]; leased {
		return nil
	}
	if !s.docMu.TryLock() {
		return nil
	}
	defer s.docMu.Unlock()
	uri := toURI(path)
	if _, exists := s.docs[uri]; exists {
		return nil
	}
	openClose, _ := s.syncOptions()
	if !openClose {
		return nil
	}
	version := s.documentVersions[uri] + 1
	notifyCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err = s.Notify(notifyCtx, "textDocument/didOpen", map[string]any{"textDocument": map[string]any{"uri": uri, "languageId": languageID(path, s.lang), "version": version, "text": text}}); err != nil {
		// A timed-out acknowledgement cannot prove whether didOpen was written.
		// Match syncText: retire the transport instead of guessing its ledger.
		s.fail(fmt.Errorf("project document synchronization: %w", err))
		return err
	}
	if s.documentVersions == nil {
		s.documentVersions = map[string]int{}
	}
	s.docs[uri] = document{text: text, version: version}
	s.documentVersions[uri] = version
	return nil
}
