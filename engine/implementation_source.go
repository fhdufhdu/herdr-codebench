package main

import (
	"context"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// A bounded project-source fallback when a Java/Kotlin server cannot return
// implementations. These are inheritance candidates, not a runtime bean model.
func sourceImplementations(ctx context.Context, req Request) ([]Location, error) {
	if ext := strings.ToLower(filepath.Ext(req.Path)); ext != ".java" && ext != ".kt" && ext != ".kts" {
		return nil, nil
	}
	idx, err := spLoad(ctx, req)
	if err != nil {
		return nil, err
	}
	var file *spFile
	for _, f := range idx.files {
		if f.path == spCanonical(req.Path) {
			file = f
			break
		}
	}
	if file == nil {
		return nil, nil
	}
	at := func(token spToken) bool {
		return token.line == req.Line && token.col <= req.Col && req.Col < token.col+len(utf16.Encode([]rune(token.text)))
	}
	target, method := "", ""
	for _, c := range file.classes {
		if at(c.at) {
			target = c.qualified
			break
		}
		for _, m := range c.methods {
			if !m.constructor && at(m.at) {
				target, method = c.qualified, m.name
				// Do not guess which overload a lexical match implements.
				count := 0
				for _, other := range c.methods {
					if other.name == method {
						count++
					}
				}
				if count > 1 {
					return nil, nil
				}
				break
			}
		}
		if target != "" {
			break
		}
	}
	if target == "" {
		for _, token := range file.tokens {
			if !at(token) || token.str || !spIdent(token.text) {
				continue
			}
			for _, injection := range file.injections {
				if injection.name == token.text && injection.at.line == token.line {
					base, _ := spUnwrap(injection.typ)
					target = spResolve(file, base)
					break
				}
			}
			if target == "" {
				qualified := spResolve(file, token.text)
				if idx.classes[qualified] != nil || file.imports[token.text] != "" {
					target = qualified
				}
			}
			break
		}
	}
	if target == "" {
		return nil, nil
	}
	var out []Location
	for _, candidate := range idx.classes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if candidate.qualified == target || !spAssignable(idx, candidate.qualified, target, map[string]bool{}) {
			continue
		}
		position, name := candidate.at, candidate.name
		detail := "구현 타입 후보 · 프로젝트 소스 상속 관계"
		if method != "" {
			var matches []spMethod
			for _, m := range candidate.methods {
				if !m.constructor && m.name == method {
					matches = append(matches, m)
				}
			}
			if len(matches) != 1 {
				continue
			}
			position, name = matches[0].at, matches[0].name
			detail = "구현 멤버 후보 · 프로젝트 소스 상속 관계"
		}
		out = append(out, spLocation(candidate.file, position, name, detail))
	}
	return spUnique(out), nil
}
