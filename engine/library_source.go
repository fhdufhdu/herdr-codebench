package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type libraryOrigin struct {
	URI    string `json:"uri"`
	Lang   string `json:"lang"`
	Root   string `json:"root"`
	Path   string `json:"path"`
	Digest string `json:"digest"`
}

var errLibraryFileChanged = errors.New("library file changed; reopen its definition")

func libraryHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func (e *Engine) libraryDirectory(uri string, s *LSPServer) string {
	key := uri
	if s != nil {
		key += "\x00" + s.lang + "\x00" + s.Root
	}
	return filepath.Join(e.cache, "sources", libraryHash(key))
}

func externalLibraryFile(path, root string) bool {
	if !isWithin(path, root) {
		return true
	}
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		if part == "node_modules" {
			return true
		}
	}
	return false
}

// File targets returned by the original server are already trusted navigation
// destinations. Bound their reads before copying them into the immutable cache.
func readLibraryFileTarget(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > maxFrame {
		return nil, errors.New("invalid library source file")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxFrame+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxFrame {
		return nil, errors.New("library source too large")
	}
	return data, nil
}

func (e *Engine) materializeLibraryFile(uri string, s *LSPServer) (string, error) {
	path, err := fromURI(uri)
	if err != nil || s == nil {
		return path, err
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("absolute local library source path is required")
	}
	path = filepath.Clean(path)
	if e.library(path) || !externalLibraryFile(path, s.Root) {
		return path, nil
	}
	data, err := readLibraryFileTarget(path)
	if err != nil {
		return "", err
	}
	target := filepath.Join(e.libraryDirectory(uri, s), libraryHash(string(data)), filepath.Base(path))
	e.libraryMu.Lock()
	defer e.libraryMu.Unlock()
	if err = e.writeLibrarySource(target, data); err != nil {
		return "", err
	}
	return target, e.rememberLibrary(target, uri, s)
}

// Root-relative operations prevent a swapped symlink from escaping the private
// source cache, including between validation and opening a file.
func (e *Engine) libraryFS(dir string) (*os.Root, error) {
	if err := os.MkdirAll(e.cache, 0700); err != nil {
		return nil, err
	}
	cache, err := os.OpenRoot(e.cache)
	if err != nil {
		return nil, err
	}
	defer cache.Close()
	if err = cache.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := cache.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe library cache directory")
	}
	return cache.OpenRoot(dir)
}
func (e *Engine) readLibrarySource(path string) ([]byte, error) {
	root, err := e.libraryFS("sources")
	if err != nil {
		return nil, err
	}
	defer root.Close()
	rel, err := filepath.Rel(filepath.Join(e.cache, "sources"), path)
	if err != nil || rel == "." || !filepath.IsLocal(rel) {
		return nil, errors.New("unsafe library source path")
	}
	file, err := root.Open(rel)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > maxFrame {
		return nil, errors.New("invalid library source file")
	}
	return io.ReadAll(io.LimitReader(file, maxFrame+1))
}
func (e *Engine) writeLibrarySource(path string, data []byte) error {
	root, err := e.libraryFS("sources")
	if err != nil {
		return err
	}
	defer root.Close()
	rel, err := filepath.Rel(filepath.Join(e.cache, "sources"), path)
	if err != nil || !filepath.IsLocal(rel) {
		return errors.New("unsafe library source path")
	}
	if _, err = e.readLibrarySource(path); err == nil {
		return nil
	}
	if err = root.MkdirAll(filepath.Dir(rel), 0700); err != nil {
		return err
	}
	// A unique temporary file plus rename keeps concurrent readers on immutable text.
	tmp := rel + "." + rand.Text()
	file, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	if _, err = file.Write(data); err == nil {
		err = file.Chmod(0444)
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return root.Rename(tmp, rel)
}

func (e *Engine) rememberLibrary(path, uri string, s *LSPServer) error {
	if s == nil {
		return nil
	} // Sources without an originating server stay unsupported.
	if previous, err := e.libraryOrigin(path); err == nil {
		if previous.URI != uri || previous.Lang != s.lang || previous.Root != s.Root {
			return errors.New("library origin conflict")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	text, err := e.readLibrarySource(path)
	if err != nil {
		return err
	}
	origin := libraryOrigin{uri, s.lang, s.Root, path, libraryHash(string(text))}
	data, err := json.Marshal(origin)
	if err != nil {
		return err
	}
	root, err := e.libraryFS("source-metadata")
	if err != nil {
		return err
	}
	defer root.Close()
	name := libraryHash(path) + ".json"
	tmp := name + "." + rand.Text()
	if err = root.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	defer root.Remove(tmp)
	return root.Rename(tmp, name)
}
func (e *Engine) libraryOrigin(path string) (libraryOrigin, error) {
	var origin libraryOrigin
	path, err := filepath.Abs(path)
	if err != nil {
		return origin, err
	}
	root, err := e.libraryFS("source-metadata")
	if err != nil {
		return origin, err
	}
	defer root.Close()
	f, err := root.Open(libraryHash(path) + ".json")
	if err != nil {
		return origin, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 64<<10))
	if err != nil {
		return origin, err
	}
	if err = json.Unmarshal(data, &origin); err != nil {
		return origin, err
	}
	if origin.Path != path || origin.Lang == "" || !filepath.IsAbs(origin.Root) || filepath.Clean(origin.Root) != origin.Root || e.library(origin.Root) {
		return origin, errors.New("invalid library origin")
	}
	if _, ok := e.config[origin.Lang]; !ok {
		return origin, errors.New("library language server is no longer configured")
	}
	originalFile := ""
	if strings.HasPrefix(origin.URI, "file:") {
		original, err := fromURI(origin.URI)
		if err != nil || !filepath.IsAbs(original) || e.library(original) {
			return origin, errors.New("invalid library file URI")
		}
		originalFile = original
	} else if !strings.HasPrefix(origin.URI, "jar:") && !strings.HasPrefix(origin.URI, "jdt:") {
		return origin, errors.New("unsupported library URI")
	}
	expected := e.libraryDirectory(origin.URI, &LSPServer{lang: origin.Lang, Root: origin.Root})
	if !isWithin(path, expected) || path == expected {
		return origin, errors.New("library origin path mismatch")
	}
	text, err := e.readLibrarySource(path)
	if err != nil {
		return origin, err
	}
	if libraryHash(string(text)) != origin.Digest {
		return origin, errors.New("library source changed")
	}
	if originalFile != "" {
		current, err := readLibraryFileTarget(originalFile)
		if err != nil {
			return origin, err
		}
		if libraryHash(string(current)) != origin.Digest {
			return origin, errLibraryFileChanged
		}
	}
	return origin, nil
}

func (e *Engine) libraryInfo(path string) (any, bool) {
	if !e.library(path) {
		return nil, false
	}
	origin, err := e.libraryOrigin(path)
	out := map[string]any{"lang": nil, "library": true, "semantic": false, "readonly": true}
	if err != nil {
		out["reason"] = "original language server association unavailable"
		if errors.Is(err, errLibraryFileChanged) {
			out["reason"] = err.Error()
		}
		return out, true
	}
	out["lang"], out["root"], out["semantic"] = origin.Lang, origin.Root, true
	out["state"], out["busy"] = "not started", []string{}
	_, commandErr := e.command(e.config[origin.Lang], origin.Root)
	out["installed"] = commandErr == nil
	e.mu.Lock()
	s := e.servers[origin.Lang+"\x00"+origin.Root]
	e.mu.Unlock()
	if s != nil {
		s.mu.Lock()
		out["state"], out["busy"] = s.state, lspBusy(s.progress)
		s.mu.Unlock()
	}
	return out, true
}

// Some servers (including typescript-language-server) only answer file-source
// queries after didOpen. Use the original URI and verified disk text, without a
// cache document or editor lease, and never replace an active editor buffer.
func (e *Engine) openLibraryOriginal(ctx context.Context, origin libraryOrigin, s *LSPServer) (int, error) {
	if !strings.HasPrefix(origin.URI, "file:") {
		return 0, nil
	}
	path, err := fromURI(origin.URI)
	if err != nil {
		return 0, err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	if _, leased := e.documents[filepath.Clean(path)]; leased {
		return 0, errors.New("library original source has an open editor buffer")
	}
	text, err := readLibraryFileTarget(path)
	if err != nil {
		return 0, err
	}
	if libraryHash(string(text)) != origin.Digest {
		return 0, errLibraryFileChanged
	}
	_, version, err := s.syncURIText(ctx, path, origin.URI, strings.ToValidUTF8(string(text), "�"), "")
	return version, err
}

func (e *Engine) verifyLibraryOriginal(origin libraryOrigin, s *LSPServer, version int) error {
	if !strings.HasPrefix(origin.URI, "file:") {
		return nil
	}
	path, err := fromURI(origin.URI)
	if err != nil {
		return err
	}
	e.documentMu.Lock()
	defer e.documentMu.Unlock()
	if _, leased := e.documents[filepath.Clean(path)]; leased {
		return errors.New("library original source has an open editor buffer")
	}
	s.docMu.Lock()
	defer s.docMu.Unlock()
	if doc, ok := s.docs[origin.URI]; !ok || doc.owner != "" || doc.version != version {
		return errors.New("library original source changed during navigation; retry")
	}
	return nil
}

func (e *Engine) libraryRequest(ctx context.Context, route string, req Request) (any, bool, error) {
	if !e.library(req.Path) || route == "tokens" {
		return nil, false, nil
	}
	if route == "info" {
		info, _ := e.libraryInfo(req.Path)
		return info, true, nil
	}
	switch route {
	case "hover", "definition", "references", "symbols", "diagnostics":
	default:
		return nil, true, errors.New("library source is read-only; endpoint unsupported")
	}
	if req.DocumentOwner != "" || req.Revision != nil || req.Text != nil {
		return nil, true, errors.New("library source is read-only; buffered text is not supported")
	}
	origin, err := e.libraryOrigin(req.Path)
	if err != nil {
		if errors.Is(err, errLibraryFileChanged) {
			return nil, true, err
		}
		return nil, true, errors.New("library semantic navigation unsupported: original language server association unavailable")
	}
	if route == "diagnostics" {
		// External URI diagnostics are not opened or synthesized from cached text.
		return map[string]any{"items": []any{}, "busy": []string{}, "supported": false, "version_confidence": "unversioned", "scope": "external_source", "reason": "external source diagnostics unavailable"}, true, nil
	}
	s, err := e.serverFor(ctx, origin.Lang, origin.Root, req.Retry)
	if err != nil {
		return nil, true, err
	}
	originalVersion, err := e.openLibraryOriginal(ctx, origin, s)
	if err != nil {
		return nil, true, err
	}
	params := map[string]any{"textDocument": map[string]any{"uri": origin.URI}, "position": map[string]any{"line": req.Line, "character": req.Col}}
	method := "textDocument/" + route
	switch route {
	case "symbols":
		method = "textDocument/documentSymbol"
		delete(params, "position")
	case "definition":
		switch req.Kind {
		case "type", "typeDefinition":
			method = "textDocument/typeDefinition"
		case "implementation":
			method = "textDocument/implementation"
		}
	case "references":
		params["context"] = map[string]any{"includeDeclaration": true}
	}
	raw, err := s.Call(ctx, method, params)
	if err != nil {
		return nil, true, err
	}
	if err := e.verifyLibraryOriginal(origin, s, originalVersion); err != nil {
		return nil, true, err
	}
	switch route {
	case "hover":
		var hover struct {
			Contents any `json:"contents"`
		}
		if err = json.Unmarshal(raw, &hover); err != nil {
			return nil, true, err
		}
		return map[string]any{"markdown": lspMarkup(hover.Contents)}, true, nil
	case "symbols":
		var items []lspSymbol
		if err = json.Unmarshal(raw, &items); err != nil {
			return nil, true, err
		}
		out := []any{}
		flattenLSPSymbols(items, 0, &out)
		return out, true, nil
	default:
		locs, err := e.Locations(ctx, raw, s)
		if route == "references" && len(locs) > 500 {
			locs = locs[:500]
		}
		return e.bufferPreviews(locs), true, err
	}
}
