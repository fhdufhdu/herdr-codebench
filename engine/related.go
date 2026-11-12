package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Keep protocol/process ownership in Engine; the small adapter makes the super
// algorithm testable with real wire replies and no language-server process.
func related(ctx context.Context, e *Engine, req Request) ([]Location, error) {
	if req.Kind != "super" {
		return springRelated(ctx, e, req)
	}
	srv, err := e.Server(ctx, req.Path, false)
	if err != nil {
		return nil, err
	}
	uri, err := e.legacyOpen(ctx, srv, req.Path)
	if err != nil {
		return nil, err
	}
	return superDocumentNavigation(ctx, e, req, srv, uri, nil)
}

// Source text is tied to the request snapshot. Other active targets are
// supported only in this server's language/root, and must remain unchanged
// throughout navigation; no lock is held while the server answers RPCs.
func superDocumentNavigation(ctx context.Context, e *Engine, req Request, srv *LSPServer, uri string, snapshot *documentSnapshot) ([]Location, error) {
	targets := map[string]bufferedDocument{}
	read := e.legacyRead
	open := func(ctx context.Context, path string) (string, error) { return e.legacyOpen(ctx, srv, path) }
	if snapshot != nil {
		read = func(path string) ([]byte, error) {
			abs, err := filepath.Abs(path)
			if err != nil {
				return nil, err
			}
			if abs == snapshot.Path {
				return []byte(snapshot.text), nil
			}
			if target, ok := targets[abs]; ok {
				return []byte(target.text), nil
			}
			return e.legacyRead(path)
		}
		open = func(ctx context.Context, path string) (string, error) {
			abs, err := filepath.Abs(path)
			if err != nil {
				return "", err
			}
			e.documentMu.Lock()
			defer e.documentMu.Unlock()
			doc, leased := e.documents[abs]
			if !leased {
				return srv.Open(ctx, abs)
			}
			if abs == snapshot.Path && (doc.owner != snapshot.Owner || doc.revision != snapshot.Revision) {
				return "", errors.New("stale source document during super navigation")
			}
			if previous, ok := targets[abs]; ok && (previous.owner != doc.owner || previous.revision != doc.revision) {
				return "", errors.New("stale target document during super navigation")
			}
			lang, cfg := e.language(abs)
			if lang != srv.lang || findRoot(abs, cfg) != srv.Root {
				return "", errors.New("buffered super target belongs to another language server/root")
			}
			targetURI, version, err := srv.syncText(ctx, abs, doc.text, doc.owner)
			if err != nil {
				return "", err
			}
			doc.server = srv
			doc.version = version
			e.documents[abs] = doc
			targets[abs] = doc
			return targetURI, nil
		}
	}
	result, err := superNavigation(ctx, req, superCallbacks{
		uri: uri, call: srv.Call,
		open: open, read: read,
		locations: func(ctx context.Context, raw json.RawMessage) ([]Location, error) {
			return e.Locations(ctx, raw, srv)
		},
	})
	if err != nil {
		return nil, err
	}
	if snapshot != nil {
		texts := map[string]string{}
		e.documentMu.Lock()
		for path, previous := range targets {
			doc, ok := e.documents[path]
			if !ok || doc.owner != previous.owner || doc.revision != previous.revision {
				e.documentMu.Unlock()
				return nil, errors.New("stale target document during super navigation")
			}
		}
		for _, loc := range result {
			path, err := filepath.Abs(loc.Path)
			if err != nil {
				continue
			}
			if path == snapshot.Path {
				texts[loc.Path] = snapshot.text
			} else if target, ok := targets[path]; ok {
				texts[loc.Path] = target.text
			} else if doc, ok := e.documents[path]; ok {
				texts[loc.Path] = doc.text
			}
		}
		e.documentMu.Unlock()
		return withPreviewTexts(result, texts), nil
	}
	return withPreviews(result), nil
}

type superCallbacks struct {
	uri       string
	call      func(context.Context, string, any) (json.RawMessage, error)
	open      func(context.Context, string) (string, error)
	locations func(context.Context, json.RawMessage) ([]Location, error)
	read      func(string) ([]byte, error)
}

type superParent struct {
	location Location
	uri      string
	name     string
}

type superWirePosition struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

type superRange struct {
	Start superWirePosition `json:"start"`
	End   superWirePosition `json:"end"`
}

func superUnsupported(err error) bool {
	var rpc *RPCError
	return errors.As(err, &rpc) && rpc.Code == -32601
}

func superParams(uri string, p Position) map[string]any {
	return map[string]any{"textDocument": map[string]string{"uri": uri},
		"position": superWirePosition{Line: p.Line, Character: p.Col}}
}

func superItems(raw json.RawMessage) ([]json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("invalid LSP array result: %w", err)
	}
	return items, nil
}

func superNavigation(ctx context.Context, req Request, cb superCallbacks) ([]Location, error) {
	owner := Position{Line: req.Line, Col: req.Col}
	if req.Owner != nil {
		owner = *req.Owner
	}
	raw, err := cb.call(ctx, "textDocument/prepareTypeHierarchy", superParams(cb.uri, owner))
	if err != nil && !superUnsupported(err) {
		return nil, fmt.Errorf("prepare super hierarchy: %w", err)
	}
	var parents []superParent
	if err == nil {
		items, err := superItems(raw)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			raw, err := cb.call(ctx, "typeHierarchy/supertypes", map[string]any{"item": item})
			if superUnsupported(err) {
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("resolve supertypes: %w", err)
			}
			items, err := superItems(raw)
			if err != nil {
				return nil, err
			}
			for _, item := range items {
				var parent struct {
					URI            string          `json:"uri"`
					Name           string          `json:"name"`
					Range          json.RawMessage `json:"range"`
					SelectionRange json.RawMessage `json:"selectionRange"`
				}
				if err := json.Unmarshal(item, &parent); err != nil {
					return nil, err
				}
				rng := parent.SelectionRange
				if len(rng) == 0 || string(rng) == "null" {
					rng = parent.Range
				}
				if parent.URI == "" || len(rng) == 0 {
					return nil, fmt.Errorf("supertype result is missing its URI or range")
				}
				loc, err := json.Marshal(map[string]any{"uri": parent.URI, "range": rng})
				if err != nil {
					return nil, err
				}
				resolved, err := superResolve(ctx, loc, parent.Name, cb)
				if err != nil {
					return nil, err
				}
				parents = append(parents, resolved...)
			}
		}
	}
	if len(parents) == 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		source, err := cb.read(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read super declaration header: %w", err)
		}
		for _, ref := range superHeaderTypes(string(source), owner) {
			raw, err := cb.call(ctx, "textDocument/definition", superParams(cb.uri, ref.pos))
			if err != nil {
				return nil, fmt.Errorf("resolve parent %s: %w", ref.name, err)
			}
			resolved, err := superResolve(ctx, raw, ref.name, cb)
			if err != nil {
				return nil, err
			}
			parents = append(parents, resolved...)
		}
	}
	var result []Location
	seenParents := map[string]bool{}
	for _, parent := range parents {
		key := superLocationKey(parent.location)
		if seenParents[key] {
			continue
		}
		seenParents[key] = true
		if req.Name == "" {
			result = append(result, parent.location)
			continue
		}
		members, err := superMembers(ctx, req.Name, parent, cb)
		if err != nil {
			return nil, err
		}
		result = append(result, members...)
	}
	seen := map[string]bool{}
	out := make([]Location, 0, len(result))
	for _, loc := range result {
		key := superLocationKey(loc)
		if !seen[key] {
			seen[key] = true
			out = append(out, loc)
		}
	}
	return out, nil
}

func superLocationKey(loc Location) string {
	return fmt.Sprintf("%s:%d:%d", loc.Path, loc.Line, loc.Col)
}

// Preserve each real target URI, including materialized library sources, for
// documentSymbol. Never replace a library URI with a guessed workspace path.
func superResolve(ctx context.Context, raw json.RawMessage, name string, cb superCallbacks) ([]superParent, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	items := []json.RawMessage{raw}
	if strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
		var err error
		items, err = superItems(raw)
		if err != nil {
			return nil, err
		}
	}
	var out []superParent
	for _, item := range items {
		var meta struct {
			URI       string `json:"uri"`
			TargetURI string `json:"targetUri"`
		}
		if err := json.Unmarshal(item, &meta); err != nil {
			return nil, err
		}
		uri := meta.TargetURI
		if uri == "" {
			uri = meta.URI
		}
		locs, err := cb.locations(ctx, item)
		if err != nil {
			return nil, err
		}
		for _, loc := range locs {
			out = append(out, superParent{location: loc, uri: uri, name: name})
		}
	}
	return out, nil
}

type superSymbol struct {
	Name           string        `json:"name"`
	Detail         string        `json:"detail"`
	Kind           int           `json:"kind"`
	Range          *superRange   `json:"range"`
	SelectionRange *superRange   `json:"selectionRange"`
	Children       []superSymbol `json:"children"`
}

func superIsType(kind int) bool {
	return kind == 5 || kind == 10 || kind == 11 || kind == 19 || kind == 23
}
func superIsMember(kind int) bool { return kind == 6 || kind == 7 || kind == 8 || kind == 12 }
func superBefore(a, b superWirePosition) bool {
	return a.Line < b.Line || a.Line == b.Line && a.Character < b.Character
}
func superContains(r *superRange, p superWirePosition) bool {
	return r != nil && !superBefore(p, r.Start) && !superBefore(r.End, p)
}

func superTypeScope(symbols []superSymbol, point superWirePosition) *superSymbol {
	// A precise declaration position wins over a nested provider's coarser
	// whole-line range (including multiple declarations on the same line).
	if exact := superExactTypeScope(symbols, point); exact != nil {
		return exact
	}
	return superContainingTypeScope(symbols, point)
}

func superExactTypeScope(symbols []superSymbol, point superWirePosition) *superSymbol {
	for i := range symbols {
		symbol := &symbols[i]
		if superIsType(symbol.Kind) && symbol.SelectionRange != nil && symbol.SelectionRange.Start == point {
			return symbol
		}
		if child := superExactTypeScope(symbol.Children, point); child != nil {
			return child
		}
	}
	return nil
}

func superContainingTypeScope(symbols []superSymbol, point superWirePosition) *superSymbol {
	for i := range symbols {
		symbol := &symbols[i]
		if superContains(symbol.Range, point) {
			if child := superContainingTypeScope(symbol.Children, point); child != nil {
				return child
			}
			if superIsType(symbol.Kind) {
				return symbol
			}
		}
	}
	return nil
}

func superMemberName(name string) string {
	if before, _, ok := strings.Cut(name, "("); ok {
		return strings.TrimSpace(before)
	}
	return strings.TrimSpace(name)
}

func superMembers(ctx context.Context, name string, parent superParent, cb superCallbacks) ([]Location, error) {
	uri := parent.uri
	if uri == "" || strings.HasPrefix(uri, "file:") {
		var err error
		uri, err = cb.open(ctx, parent.location.Path)
		if err != nil {
			return nil, fmt.Errorf("open resolved parent: %w", err)
		}
	}
	raw, err := cb.call(ctx, "textDocument/documentSymbol", map[string]any{"textDocument": map[string]string{"uri": uri}})
	if err != nil && !superUnsupported(err) {
		return nil, fmt.Errorf("parent document symbols: %w", err)
	}
	if err == nil {
		var symbols []superSymbol
		if err := json.Unmarshal(raw, &symbols); err != nil && len(raw) != 0 {
			return nil, fmt.Errorf("invalid parent symbols: %w", err)
		}
		point := superWirePosition{Line: parent.location.Line, Character: parent.location.Col}
		if scope := superTypeScope(symbols, point); scope != nil {
			var members []Location
			for _, symbol := range scope.Children {
				if !superIsMember(symbol.Kind) || superMemberName(symbol.Name) != name {
					continue
				}
				rng := symbol.SelectionRange
				if rng == nil {
					rng = symbol.Range
				}
				if rng == nil {
					continue
				}
				members = append(members, Location{Path: parent.location.Path, Line: rng.Start.Line, Col: rng.Start.Character,
					EndLine: rng.End.Line, EndCol: rng.End.Character, Name: symbol.Name, Detail: symbol.Detail, External: parent.location.External})
			}
			// An authoritative scoped result with no matching member is empty. Do
			// not jump to its class or a different/nested same-name declaration.
			return members, nil
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	source, err := cb.read(parent.location.Path)
	if err != nil {
		return nil, fmt.Errorf("read resolved parent members: %w", err)
	}
	return superSourceMembers(string(source), parent.location, name), nil
}

type superToken struct {
	text       string
	pos, end   Position
	identifier bool
}

// Tokenization preserves UTF-16 columns while ignoring comments and literals.
// It is only a declaration/header fallback; LSP resolves every parent path.
func superLex(source string) []superToken {
	var tokens []superToken
	i, line, col := 0, 0, 0
	advance := func() rune {
		r, n := utf8.DecodeRuneInString(source[i:])
		i += n
		if r == '\n' {
			line, col = line+1, 0
		} else if r > 0xffff {
			col += 2
		} else {
			col++
		}
		return r
	}
	for i < len(source) {
		r, _ := utf8.DecodeRuneInString(source[i:])
		if unicode.IsSpace(r) {
			advance()
			continue
		}
		if strings.HasPrefix(source[i:], "//") {
			for i < len(source) && source[i] != '\n' {
				advance()
			}
			continue
		}
		if strings.HasPrefix(source[i:], "/*") {
			advance()
			advance()
			for depth := 1; depth > 0 && i < len(source); {
				if strings.HasPrefix(source[i:], "/*") {
					advance()
					advance()
					depth++
				} else if strings.HasPrefix(source[i:], "*/") {
					advance()
					advance()
					depth--
				} else {
					advance()
				}
			}
			continue
		}
		if r == '"' || r == '\'' {
			quote := r
			triple := quote == '"' && strings.HasPrefix(source[i:], `"""`)
			advance()
			if triple {
				advance()
				advance()
			}
			for i < len(source) {
				if triple && strings.HasPrefix(source[i:], `"""`) {
					advance()
					advance()
					advance()
					break
				}
				char := advance()
				if !triple && char == '\\' && i < len(source) {
					advance()
				} else if !triple && char == quote {
					break
				}
			}
			continue
		}
		pos, start := Position{Line: line, Col: col}, i
		if r == '`' {
			advance()
			start = i
			pos.Col++
			for i < len(source) && source[i] != '`' {
				advance()
			}
			text := source[start:i]
			end := Position{Line: line, Col: col}
			if i < len(source) {
				advance()
			}
			tokens = append(tokens, superToken{text: text, pos: pos, end: end, identifier: true})
			continue
		}
		identifier := unicode.IsLetter(r) || r == '_' || r == '$'
		advance()
		if identifier {
			for i < len(source) {
				char, _ := utf8.DecodeRuneInString(source[i:])
				if !unicode.IsLetter(char) && !unicode.IsDigit(char) && char != '_' && char != '$' {
					break
				}
				advance()
			}
		}
		tokens = append(tokens, superToken{text: source[start:i], pos: pos, end: Position{Line: line, Col: col}, identifier: identifier})
	}
	return tokens
}

type superClass struct{ name, headerEnd, bodyStart, bodyEnd int }

func superTypeKeyword(text string) bool {
	return text == "class" || text == "interface" || text == "object" || text == "record" || text == "enum"
}

func superClasses(tokens []superToken) []superClass {
	var classes []superClass
	for i := 0; i+1 < len(tokens); i++ {
		if !superTypeKeyword(tokens[i].text) || !tokens[i+1].identifier || superTypeKeyword(tokens[i+1].text) {
			continue
		}
		class := superClass{name: i + 1, headerEnd: len(tokens), bodyStart: -1, bodyEnd: -1}
		paren, angle, bracket := 0, 0, 0
		for j := i + 2; j < len(tokens); j++ {
			top := paren == 0 && angle == 0 && bracket == 0
			text := tokens[j].text
			if top && (text == ";" || superTypeKeyword(text) && tokens[j].pos.Line > tokens[i+1].pos.Line) {
				class.headerEnd = j
				break
			}
			if top && text == "{" {
				class.headerEnd, class.bodyStart = j, j
				depth := 1
				for k := j + 1; k < len(tokens); k++ {
					if tokens[k].text == "{" {
						depth++
					}
					if tokens[k].text == "}" {
						depth--
					}
					if depth == 0 {
						class.bodyEnd = k
						break
					}
				}
				break
			}
			switch text {
			case "(":
				paren++
			case ")":
				if paren > 0 {
					paren--
				}
			case "<":
				angle++
			case ">":
				if angle > 0 {
					angle--
				}
			case "[":
				bracket++
			case "]":
				if bracket > 0 {
					bracket--
				}
			}
		}
		classes = append(classes, class)
	}
	return classes
}

func superPosBefore(a, b Position) bool { return a.Line < b.Line || a.Line == b.Line && a.Col < b.Col }

func superOwnerClass(tokens []superToken, classes []superClass, owner Position) (superClass, bool) {
	for _, class := range classes {
		name := tokens[class.name]
		if owner.Line == name.pos.Line && owner.Col >= name.pos.Col && owner.Col <= name.end.Col {
			return class, true
		}
	}
	var found superClass
	ok := false
	for _, class := range classes {
		if class.bodyStart >= 0 && class.bodyEnd >= 0 && !superPosBefore(owner, tokens[class.bodyStart].pos) && !superPosBefore(tokens[class.bodyEnd].end, owner) {
			if !ok || superPosBefore(tokens[found.name].pos, tokens[class.name].pos) {
				found, ok = class, true
			}
		}
	}
	if ok {
		return found, true
	}
	best := int(^uint(0) >> 1)
	for _, class := range classes {
		name := tokens[class.name]
		if name.pos.Line == owner.Line {
			distance := name.pos.Col - owner.Col
			if distance < 0 {
				distance = -distance
			}
			if distance < best {
				found, ok, best = class, true, distance
			}
		}
	}
	return found, ok
}

type superTypeRef struct {
	name string
	pos  Position
}

func superTypeHead(tokens []superToken) (superTypeRef, bool) {
	for i := 0; i < len(tokens); {
		if tokens[i].text == "@" {
			i++
			if i < len(tokens) && tokens[i].identifier {
				i++
			}
			for i+1 < len(tokens) && tokens[i].text == "." && tokens[i+1].identifier {
				i += 2
			}
			if i < len(tokens) && tokens[i].text == "(" {
				for depth := 0; i < len(tokens); i++ {
					if tokens[i].text == "(" {
						depth++
					}
					if tokens[i].text == ")" {
						depth--
					}
					if depth == 0 {
						i++
						break
					}
				}
			}
			continue
		}
		if tokens[i].identifier {
			name := tokens[i]
			i++
			for i+1 < len(tokens) && tokens[i].text == "." && tokens[i+1].identifier {
				name = tokens[i+1]
				i += 2
			}
			return superTypeRef{name: name.text, pos: name.pos}, true
		}
		i++
	}
	return superTypeRef{}, false
}

func superHeaderTypes(source string, owner Position) []superTypeRef {
	tokens := superLex(source)
	class, ok := superOwnerClass(tokens, superClasses(tokens), owner)
	if !ok {
		return nil
	}
	var refs []superTypeRef
	paren, angle, bracket, segment := 0, 0, 0, -1
	flush := func(end int) {
		if segment >= 0 {
			if ref, ok := superTypeHead(tokens[segment:end]); ok {
				refs = append(refs, ref)
			}
		}
	}
	for i := class.name + 1; i < class.headerEnd; i++ {
		text := tokens[i].text
		top := paren == 0 && angle == 0 && bracket == 0
		if top && (text == "extends" || text == "implements" || text == ":") {
			flush(i)
			segment = i + 1
			continue
		}
		if top && text == "where" {
			flush(i)
			return refs
		}
		if top && text == "," && segment >= 0 {
			flush(i)
			segment = i + 1
			continue
		}
		switch text {
		case "(":
			paren++
		case ")":
			if paren > 0 {
				paren--
			}
		case "<":
			angle++
		case ">":
			if angle > 0 {
				angle--
			}
		case "[":
			bracket++
		case "]":
			if bracket > 0 {
				bracket--
			}
		}
	}
	flush(class.headerEnd)
	return refs
}

func superSourceMembers(source string, parent Location, name string) []Location {
	tokens := superLex(source)
	class, ok := superOwnerClass(tokens, superClasses(tokens), Position{Line: parent.Line, Col: parent.Col})
	if !ok {
		return nil
	}
	var out []Location
	add := func(token superToken) {
		out = append(out, Location{Path: parent.Path, Line: token.pos.Line, Col: token.pos.Col, EndLine: token.end.Line, EndCol: token.end.Col,
			Name: name, Detail: "declaration fallback (signature not resolved)", External: parent.External})
	}
	// Kotlin primary-constructor properties are inherited members too.
	headerBraces := 0
	for i := class.name + 2; i < class.headerEnd; i++ {
		if tokens[i].text == "{" {
			headerBraces++
		}
		if tokens[i].text == "}" {
			headerBraces--
		}
		if headerBraces == 0 && tokens[i].text == name && (tokens[i-1].text == "val" || tokens[i-1].text == "var") {
			add(tokens[i])
		}
	}
	if class.bodyStart < 0 || class.bodyEnd < 0 {
		return out
	}
	brace, paren := 1, 0
	for i := class.bodyStart + 1; i < class.bodyEnd; i++ {
		text := tokens[i].text
		if brace == 1 && paren == 0 && text == name && tokens[i].identifier {
			previous := tokens[i-1].text
			property := previous == "val" || previous == "var"
			start, kotlinFun, assignment := i-1, false, false
			for ; start > class.bodyStart; start-- {
				prefix := tokens[start].text
				if prefix == "{" || prefix == "}" || prefix == ";" {
					start++
					break
				}
				if prefix == "=" && !kotlinFun {
					assignment = true
				}
				if prefix == "fun" && !assignment {
					kotlinFun = true
				}
			}
			if start == class.bodyStart {
				start++
			}
			method := i+1 < len(tokens) && tokens[i+1].text == "(" && !assignment &&
				(kotlinFun || (tokens[i-1].identifier || previous == ">" || previous == "]") && previous != "new" && !superTypeKeyword(previous))
			if method && text == tokens[class.name].text && !kotlinFun {
				method = superJavaReturnType(tokens[start:i])
			}
			if property || method {
				add(tokens[i])
			}
		}
		switch text {
		case "{":
			brace++
		case "}":
			brace--
		case "(":
			paren++
		case ")":
			if paren > 0 {
				paren--
			}
		}
	}
	return out
}

func superJavaReturnType(prefix []superToken) bool {
	modifiers := map[string]bool{"public": true, "protected": true, "private": true, "static": true, "final": true,
		"abstract": true, "synchronized": true, "native": true, "default": true, "strictfp": true}
	for i := 0; i < len(prefix); {
		if modifiers[prefix[i].text] {
			i++
			continue
		}
		if prefix[i].text == "@" {
			i++
			if i < len(prefix) && prefix[i].identifier {
				i++
			}
			for i+1 < len(prefix) && prefix[i].text == "." && prefix[i+1].identifier {
				i += 2
			}
			if i < len(prefix) && prefix[i].text == "(" {
				for depth := 0; i < len(prefix); i++ {
					if prefix[i].text == "(" {
						depth++
					}
					if prefix[i].text == ")" {
						depth--
					}
					if depth == 0 {
						i++
						break
					}
				}
			}
			continue
		}
		if prefix[i].text == "<" {
			for depth := 0; i < len(prefix); i++ {
				if prefix[i].text == "<" {
					depth++
				}
				if prefix[i].text == ">" {
					depth--
				}
				if depth == 0 {
					i++
					break
				}
			}
			continue
		}
		return prefix[i].identifier
	}
	return false
}
