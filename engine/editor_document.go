package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Leases hold unsaved text only in this engine's memory. Engine.documentMu
// protects the lease and its ordered synchronization, never an LSP RPC wait.
type bufferedDocument struct {
	owner    string
	revision int64
	text     string
	server   *LSPServer
	version  int
	touched  time.Time
}

// Active editors renew every ten seconds. A crashed window cannot leave an
// immortal owner behind; a live, renewed owner is never replaced.
const documentLeaseTTL = time.Minute

func (e *Engine) retireDocumentOwner(path, owner string) {
	if e.closedDocuments == nil {
		e.closedDocuments = map[string]map[string]bool{}
	}
	if e.closedDocuments[path] == nil {
		e.closedDocuments[path] = map[string]bool{}
	}
	e.closedDocuments[path][owner] = true
}

func (e *Engine) touchDocument(req Request) (any, error) {
	path, err := validateDocument(req)
	if err != nil {
		return nil, err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	doc, err := e.matchingDocument(path, req)
	if err != nil {
		return nil, err
	}
	doc.touched = time.Now()
	e.documents[path] = doc
	return map[string]any{"touched": true, "path": path, "document_owner": doc.owner, "revision": doc.revision}, nil
}

type documentSnapshot struct {
	Path     string `json:"path"`
	Owner    string `json:"document_owner"`
	Revision int64  `json:"revision"`
	Version  int    `json:"version"`
	text     string
}

// Legacy super navigation can open/read additional source documents after its
// primary request starts. Check those paths too, including pending leases whose
// server has not yet been rehydrated. Do not hold this lock during RPC calls.
func (e *Engine) legacyOpen(ctx context.Context, srv *LSPServer, path string) (string, error) {
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if _, leased := e.documents[abs]; leased {
		return "", errors.New("document owner is required for an open buffer")
	}
	return srv.Open(ctx, path)
}
func (e *Engine) legacyRead(path string) ([]byte, error) {
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if _, leased := e.documents[abs]; leased {
		return nil, errors.New("document owner is required for an open buffer")
	}
	return os.ReadFile(path)
}

// Preview text for buffered navigation comes from active target buffers when
// available. This is a current text snapshot, not proof that the server analyzed
// that target revision; only the source request has revision metadata.
func (e *Engine) bufferPreviews(locs []Location) []Location {
	texts := map[string]string{}
	e.documentMu.Lock()
	for _, loc := range locs {
		path, err := filepath.Abs(loc.Path)
		if err != nil {
			continue
		}
		if doc, ok := e.documents[path]; ok {
			texts[loc.Path] = doc.text
		}
	}
	e.documentMu.Unlock()
	return withPreviewTexts(locs, texts)
}
func withPreviewTexts(locs []Location, texts map[string]string) []Location {
	return withPreviewsFrom(locs, func(path string) ([]byte, error) {
		if text, ok := texts[path]; ok {
			return []byte(text), nil
		}
		return os.ReadFile(path)
	})
}

func documentPath(path string) (string, error) {
	if path == "" || !filepath.IsAbs(path) {
		return "", errors.New("absolute local document path is required")
	}
	return filepath.Clean(path), nil
}
func validateDocument(req Request) (string, error) {
	path, err := documentPath(req.Path)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(req.DocumentOwner) == "" || req.Revision == nil || *req.Revision < 0 {
		return "", errors.New("document_owner and nonnegative revision are required")
	}
	return path, nil
}
func (e *Engine) matchingDocument(path string, req Request) (bufferedDocument, error) {
	doc, ok := e.documents[path]
	if !ok {
		return doc, errors.New("document is not open")
	}
	if doc.owner != req.DocumentOwner {
		return doc, errors.New("document owner conflict")
	}
	if req.Revision == nil || doc.revision != *req.Revision {
		return doc, errors.New("stale document revision")
	}
	return doc, nil
}
func (e *Engine) syncDocument(ctx context.Context, req Request) (any, error) {
	if e.library(req.Path) {
		return nil, errors.New("library source is read-only")
	}
	path, err := validateDocument(req)
	if err != nil {
		return nil, err
	}
	if req.Text == nil || !utf8.ValidString(*req.Text) {
		return nil, errors.New("valid document text is required")
	}
	e.documentMu.Lock()
	if e.closedDocuments[path][req.DocumentOwner] {
		e.documentMu.Unlock()
		return nil, errors.New("document owner session is closed; use a new document_owner")
	}
	if e.documents == nil {
		e.documents = map[string]bufferedDocument{}
	}
	doc, exists := e.documents[path]
	if exists && doc.owner != req.DocumentOwner {
		if doc.touched.IsZero() || time.Since(doc.touched) < documentLeaseTTL {
			e.documentMu.Unlock()
			return nil, errors.New("document owner conflict")
		}
		if doc.server != nil {
			if err := doc.server.closeDocument(ctx, path, doc.owner); err != nil {
				e.documentMu.Unlock()
				return nil, err
			}
		}
		e.retireDocumentOwner(path, doc.owner)
		delete(e.documents, path)
		doc = bufferedDocument{}
		exists = false
	}
	if exists && (*req.Revision < doc.revision || *req.Revision == doc.revision && *req.Text != doc.text) {
		e.documentMu.Unlock()
		return nil, errors.New("stale or conflicting document revision")
	}
	// Retain accepted text even if server startup/transport fails. The identical
	// sync can be retried; saved-file requests must not replace this text.
	doc.owner = req.DocumentOwner
	doc.revision = *req.Revision
	doc.text = *req.Text
	doc.touched = time.Now()
	e.documents[path] = doc
	e.documentMu.Unlock()
	srv, err := e.Server(ctx, path, req.Retry)
	if err != nil {
		return nil, err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	doc, err = e.matchingDocument(path, req)
	if err != nil {
		return nil, err
	}
	_, version, err := srv.syncText(ctx, path, doc.text, doc.owner)
	if err != nil {
		return nil, err
	}
	doc.server = srv
	doc.version = version
	e.documents[path] = doc
	return documentSnapshot{Path: path, Owner: doc.owner, Revision: doc.revision, Version: version}, nil
}
func (e *Engine) closeDocument(ctx context.Context, req Request) (any, error) {
	path, err := validateDocument(req)
	if err != nil {
		return nil, err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	// Cleanup may have succeeded while its acknowledgement was lost or another
	// close was in flight. A retired owner cannot hold the current lease: never
	// compare its duplicate cleanup against the newer editor's owner/revision.
	if e.closedDocuments[path][req.DocumentOwner] {
		return map[string]any{"closed": true, "path": path, "document_owner": req.DocumentOwner, "revision": *req.Revision}, nil
	}
	if _, exists := e.documents[path]; exists {
		doc, err := e.matchingDocument(path, req)
		if err != nil {
			return nil, err
		}
		if doc.server != nil {
			if err = doc.server.closeDocument(ctx, path, doc.owner); err != nil {
				return nil, err
			}
		}
		delete(e.documents, path)
	}
	// A final UI close can reach us before its first sync request. Retire that
	// exact owner even without an open lease, so the delayed sync cannot claim
	// the path after cleanup. Existing leases still require matching owner and
	// revision above; another editor's document is never closed or retired.
	e.retireDocumentOwner(path, req.DocumentOwner)
	return map[string]any{"closed": true, "path": path, "document_owner": req.DocumentOwner, "revision": *req.Revision}, nil
}

// Prepare the current snapshot without holding its lock while the semantic
// request runs. A later edit can proceed; the caller discards old revisions.
func (e *Engine) openRequest(ctx context.Context, req Request) (*LSPServer, string, *documentSnapshot, error) {
	if req.DocumentOwner != "" || req.Revision != nil {
		path, err := validateDocument(req)
		if err != nil {
			return nil, "", nil, err
		}
		req.Path = path
	} else if req.Path != "" {
		// Legacy relative paths must not evade an absolute-path buffer lease,
		// including while its language server is being restarted.
		path, err := filepath.Abs(req.Path)
		if err != nil {
			return nil, "", nil, err
		}
		req.Path = path
	}
	// Do not start an unnecessary server for an already rejected lease request.
	e.documentMu.Lock()
	_, leased := e.documents[filepath.Clean(req.Path)]
	var validation error
	if req.DocumentOwner != "" || req.Revision != nil {
		_, validation = e.matchingDocument(req.Path, req)
	} else if leased {
		validation = errors.New("document owner is required for an open buffer")
	}
	e.documentMu.Unlock()
	if validation != nil {
		return nil, "", nil, validation
	}
	srv, err := e.Server(ctx, req.Path, req.Retry)
	if err != nil {
		return nil, "", nil, err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	if req.DocumentOwner == "" {
		if _, ok := e.documents[filepath.Clean(req.Path)]; ok {
			return nil, "", nil, errors.New("document owner is required for an open buffer")
		}
		uri, err := srv.Open(ctx, req.Path)
		return srv, uri, nil, err
	}
	doc, err := e.matchingDocument(req.Path, req)
	if err != nil {
		return nil, "", nil, err
	}
	if req.Text != nil && *req.Text != doc.text {
		return nil, "", nil, errors.New("semantic text conflicts with open document")
	}
	uri, version, err := srv.syncText(ctx, req.Path, doc.text, doc.owner)
	if err != nil {
		return nil, "", nil, err
	}
	doc.server = srv
	doc.version = version
	e.documents[req.Path] = doc
	return srv, uri, &documentSnapshot{Path: req.Path, Owner: doc.owner, Revision: doc.revision, Version: version, text: doc.text}, nil
}
