package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Spring navigation is a bounded source index, not a running application model.
type SpringMarker struct {
	Kind      string    `json:"kind"`
	Line      int       `json:"line"`
	Col       int       `json:"col"`
	Name      string    `json:"name,omitempty"`
	Type      string    `json:"type,omitempty"`
	Qualifier string    `json:"qualifier,omitempty"`
	Key       string    `json:"key,omitempty"`
	Title     string    `json:"title"`
	Owner     *Position `json:"owner,omitempty"`
}
type spToken struct {
	text, value string
	line, col   int
	str         bool
}
type spAnn struct {
	name string
	args []spToken
}
type spClass struct {
	name, qualified string
	parents         []string
	at              spToken
	bean            bool
	interfaceType   bool
	anns            []spAnn
	methods         []spMethod
	file            *spFile
}
type spBean struct {
	names                []string
	typ                  string
	qualifier            string
	primary, conditional bool
	loc                  Location
	file                 *spFile
}
type spInjection struct {
	name, typ, qualifier, key string
	resource                  bool
	at                        spToken
	owner                     *Position
	file                      *spFile
}
type spMethod struct {
	name, typ   string
	at          spToken
	anns        []spAnn
	params      []spToken
	constructor bool
}
type spFile struct {
	path, pkg  string
	imports    map[string]string
	stars      []string
	tokens     []spToken
	classes    []*spClass
	beans      []*spBean
	injections []*spInjection
	endpoints  []Location
}
type spIndex struct {
	files      []*spFile
	beans      []*spBean
	classes    map[string]*spClass
	properties []Location
}
type spCacheEntry struct {
	signature [32]byte
	index     *spIndex
	at        time.Time
}

var spCache = struct {
	sync.Mutex
	entries map[string]spCacheEntry
}{entries: map[string]spCacheEntry{}}

const spMaxFiles = 2000
const spMaxBytes = 16 << 20
const spMaxFileBytes = 1 << 20

func spLex(source string) []spToken {
	var out []spToken
	line, col := 0, 0
	advance := func(s string) {
		for _, r := range s {
			if r == '\n' {
				line++
				col = 0
			} else if r > 0xffff {
				col += 2
			} else {
				col++
			}
		}
	}
	for i := 0; i < len(source); {
		start, l, c := i, line, col
		r, n := utf8.DecodeRuneInString(source[i:])
		if unicode.IsSpace(r) {
			advance(source[i : i+n])
			i += n
			continue
		}
		if strings.HasPrefix(source[i:], "//") {
			for i < len(source) && source[i] != '\n' {
				i++
			}
			advance(source[start:i])
			continue
		}
		if strings.HasPrefix(source[i:], "/*") {
			i += 2
			depth := 1
			for i < len(source) && depth > 0 {
				if strings.HasPrefix(source[i:], "/*") {
					depth++
					i += 2
				} else if strings.HasPrefix(source[i:], "*/") {
					depth--
					i += 2
				} else {
					i++
				}
			}
			advance(source[start:i])
			continue
		}
		if r == '"' || r == '\'' {
			quote := byte(r)
			triple := quote == '"' && strings.HasPrefix(source[i:], `"""`)
			if triple {
				i += 3
				for i < len(source) && !strings.HasPrefix(source[i:], `"""`) {
					i++
				}
				if i < len(source) {
					i += 3
				}
			} else {
				i++
				for i < len(source) {
					if source[i] == '\\' {
						i += 2
						continue
					}
					if source[i] == quote {
						i++
						break
					}
					i++
				}
				if i > len(source) {
					i = len(source)
				}
			}
			raw := source[start:i]
			value := ""
			if triple && len(raw) >= 6 {
				value = raw[3 : len(raw)-3]
			} else if v, err := strconv.Unquote(raw); err == nil {
				value = v
			}
			out = append(out, spToken{text: raw, value: value, line: l, col: c, str: true})
			advance(raw)
			continue
		}
		if unicode.IsLetter(r) || r == '_' || r == '$' || r == '`' {
			i += n
			if r == '`' {
				for i < len(source) && source[i] != '`' {
					i++
				}
				if i < len(source) {
					i++
				}
			} else {
				for i < len(source) {
					q, m := utf8.DecodeRuneInString(source[i:])
					if !unicode.IsLetter(q) && !unicode.IsDigit(q) && q != '_' && q != '$' {
						break
					}
					i += m
				}
			}
			raw := source[start:i]
			out = append(out, spToken{text: strings.Trim(raw, "`"), line: l, col: c})
			advance(raw)
			continue
		}
		i += n
		out = append(out, spToken{text: string(r), line: l, col: c})
		advance(source[start:i])
	}
	return out
}
func spMatch(t []spToken, i int, open, close string) int {
	depth := 0
	for j := i; j < len(t); j++ {
		if t[j].text == open {
			depth++
		}
		if t[j].text == close {
			depth--
			if depth == 0 {
				return j
			}
		}
	}
	return len(t) - 1
}
func spIdent(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if !(unicode.IsLetter(r) || r == '_' || r == '$' || i > 0 && unicode.IsDigit(r)) {
			return false
		}
	}
	return true
}
func spAnnotation(t []spToken, i int) (spAnn, int) {
	a := spAnn{}
	j := i + 1
	if j+1 < len(t) && t[j+1].text == ":" {
		j += 2
	}
	for j < len(t) && (spIdent(t[j].text) || t[j].text == ".") {
		a.name += t[j].text
		j++
		if j >= len(t) || t[j].text != "." {
			break
		}
		a.name += "."
		j++
	}
	if j < len(t) && t[j].text == "(" {
		end := spMatch(t, j, "(", ")")
		a.args = t[j+1 : end]
		j = end + 1
	}
	return a, j
}
func spAnnName(f *spFile, a spAnn) string {
	name := a.name
	if v := f.imports[name]; v != "" {
		name = v
	}
	if strings.Contains(name, ".") {
		for _, prefix := range []string{"org.springframework.", "javax.inject.", "jakarta.inject.", "javax.annotation.", "jakarta.annotation."} {
			if strings.HasPrefix(name, prefix) {
				return name[strings.LastIndex(name, ".")+1:]
			}
		}
		return ""
	}
	return name
}
func spHas(f *spFile, anns []spAnn, names ...string) bool {
	for _, a := range anns {
		for _, name := range names {
			if spAnnName(f, a) == name {
				return true
			}
		}
	}
	return false
}
func spStrings(a spAnn, key string) []string {
	var out []string
	start, end := 0, len(a.args)
	named := false
	for i := 0; i+1 < len(a.args); i++ {
		if a.args[i+1].text == "=" {
			named = true
			if a.args[i].text == key {
				start = i + 2
				depth := 0
				end = len(a.args)
				for j := start; j < len(a.args); j++ {
					s := a.args[j].text
					if s == "[" || s == "{" || s == "(" {
						depth++
					}
					if s == "]" || s == "}" || s == ")" {
						depth--
					}
					if s == "," && depth == 0 {
						end = j
						break
					}
				}
				for _, v := range a.args[start:end] {
					if v.str {
						out = append(out, v.value)
					}
				}
				return out
			}
		}
	}
	if named {
		return nil
	}
	if key != "value" {
		return nil
	}
	for _, v := range a.args {
		if v.str {
			out = append(out, v.value)
		}
	}
	return out
}
func spNames(f *spFile, anns []spAnn, kind, fallback string) []string {
	for _, a := range anns {
		if spAnnName(f, a) == kind {
			names := spStrings(a, "name")
			if len(names) == 0 {
				names = spStrings(a, "value")
			}
			if len(names) > 0 {
				return names
			}
		}
	}
	return []string{fallback}
}
func spType(tokens []spToken) string {
	var b strings.Builder
	for _, t := range tokens {
		if !t.str {
			b.WriteString(t.text)
		}
	}
	return b.String()
}
func spModifiers(t []spToken) []spToken {
	for len(t) > 0 {
		switch t[0].text {
		case "public", "private", "protected", "internal", "final", "static", "abstract", "open", "override", "suspend", "inline", "lateinit", "transient", "volatile", "synchronized", "external", "actual", "expect", "val", "var":
			t = t[1:]
		default:
			return t
		}
	}
	return t
}
func spParts(t []spToken) [][]spToken {
	var out [][]spToken
	start, paren, angle := 0, 0, 0
	for i, v := range t {
		switch v.text {
		case "(", "[", "{":
			paren++
		case ")", "]", "}":
			paren--
		case "<":
			angle++
		case ">":
			angle--
		}
		if v.text == "," && paren == 0 && angle == 0 {
			out = append(out, t[start:i])
			start = i + 1
		}
	}
	if start < len(t) {
		out = append(out, t[start:])
	}
	return out
}
func spStripAnnotations(t []spToken) ([]spToken, []spAnn) {
	var clean []spToken
	var anns []spAnn
	for i := 0; i < len(t); {
		if t[i].text == "@" {
			a, next := spAnnotation(t, i)
			anns = append(anns, a)
			i = next
		} else {
			clean = append(clean, t[i])
			i++
		}
	}
	return clean, anns
}
func spResolve(f *spFile, name string) string {
	name = strings.TrimSuffix(strings.TrimSpace(name), "?")
	if strings.Contains(name, ".") {
		return name
	}
	if q := f.imports[name]; q != "" {
		return q
	}
	if f.pkg != "" {
		return f.pkg + "." + name
	}
	return name
}
func spUnwrap(raw string) (string, bool) {
	raw = strings.ReplaceAll(raw, "...", "")
	raw = strings.TrimSuffix(raw, "?")
	multi := false
	for {
		i := strings.Index(raw, "<")
		if i < 0 {
			break
		}
		base := raw[:i]
		if j := strings.LastIndex(base, "."); j >= 0 {
			base = base[j+1:]
		}
		switch base {
		case "List", "Set", "Collection", "Iterable", "Sequence", "Provider", "ObjectProvider", "ObjectFactory", "Optional", "Lazy", "Map":
			multi = true
			inner := strings.TrimSuffix(raw[i+1:], ">")
			parts := strings.Split(inner, ",")
			raw = parts[len(parts)-1]
		default:
			return raw[:i], true
		}
	}
	raw = strings.TrimPrefix(raw, "?extends")
	return strings.TrimSuffix(raw, "[]"), multi
}
func spScalar(raw string) bool {
	base, _ := spUnwrap(raw)
	if j := strings.LastIndex(base, "."); j >= 0 {
		base = base[j+1:]
	}
	switch base {
	case "", "String", "CharSequence", "Boolean", "Bool", "Int", "Long", "Short", "Byte", "Double", "Float", "Char", "Integer", "Character", "Number", "boolean", "int", "long", "short", "byte", "double", "float", "char", "void", "Unit", "Any", "Object":
		return true
	}
	return false
}
func spLocation(f *spFile, t spToken, name, detail string) Location {
	return Location{Path: f.path, Line: t.line, Col: t.col, EndLine: t.line, EndCol: t.col + spWidth(t.text), Name: name, Text: name, Detail: detail}
}
func spWidth(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xffff {
			n += 2
		} else {
			n++
		}
	}
	return n
}
func spQualifier(f *spFile, anns []spAnn) string {
	for _, a := range anns {
		if spAnnName(f, a) == "Qualifier" || spAnnName(f, a) == "Named" {
			if v := spStrings(a, "value"); len(v) > 0 {
				return v[0]
			}
		}
	}
	return ""
}
func spConditional(f *spFile, anns []spAnn) bool {
	for _, a := range anns {
		n := spAnnName(f, a)
		if n == "Profile" || strings.HasPrefix(n, "Conditional") {
			return true
		}
	}
	return false
}
func spAddInjection(f *spFile, tokens []spToken, inherited []spAnn, implicit bool, owner *Position) {
	t, anns := spStripAnnotations(tokens)
	anns = append(append([]spAnn{}, inherited...), anns...)
	t = spModifiers(t)
	if len(t) < 2 {
		return
	}
	for i, v := range t {
		if v.text == "=" {
			t = t[:i]
			break
		}
	}
	if len(t) < 2 {
		return
	}
	var name spToken
	typ := ""
	colon := -1
	for i, v := range t {
		if v.text == ":" {
			colon = i
			break
		}
	}
	if colon > 0 {
		name = t[colon-1]
		typ = spType(t[colon+1:])
	} else {
		name = t[len(t)-1]
		typ = spType(t[:len(t)-1])
	}
	if !spIdent(name.text) {
		return
	}
	inj := &spInjection{name: name.text, typ: typ, at: name, owner: owner, file: f}
	for _, a := range anns {
		n := spAnnName(f, a)
		if n == "Qualifier" || n == "Named" {
			v := spStrings(a, "value")
			if len(v) > 0 {
				inj.qualifier = v[0]
			}
		}
		if n == "Resource" {
			inj.resource = true
			v := spStrings(a, "name")
			if len(v) > 0 {
				inj.qualifier = v[0]
			}
		}
		if n == "Value" {
			for _, v := range spStrings(a, "value") {
				m := spPropertyExpr.FindStringSubmatch(v)
				if len(m) > 1 {
					inj.key = m[1]
				}
			}
		}
	}
	if inj.key != "" {
		f.injections = append(f.injections, inj)
		return
	}
	if (implicit || spHas(f, anns, "Autowired", "Inject", "Resource")) && !spScalar(typ) {
		f.injections = append(f.injections, inj)
	}
}

var spPropertyExpr = regexp.MustCompile(`\$\{([A-Za-z0-9_.-]+)(?::[^}]*)?\}`)

func spParse(path, source string) *spFile {
	f := &spFile{path: path, imports: map[string]string{}, tokens: spLex(source)}
	t := f.tokens
	for i := 0; i < len(t); i++ {
		if t[i].text != "package" && t[i].text != "import" {
			continue
		}
		kind, l := t[i].text, t[i].line
		j := i + 1
		s := ""
		for j < len(t) && t[j].line == l && t[j].text != ";" && t[j].text != "as" {
			s += t[j].text
			j++
		}
		if kind == "package" {
			f.pkg = s
		} else if strings.HasSuffix(s, ".*") {
			f.stars = append(f.stars, strings.TrimSuffix(s, ".*"))
		} else {
			name := s[strings.LastIndex(s, ".")+1:]
			if j+1 < len(t) && t[j].text == "as" {
				name = t[j+1].text
			}
			f.imports[name] = s
		}
		i = j - 1
	}
	spParseRange(f, 0, len(t), nil)
	return f
}
func spParseRange(f *spFile, start, end int, owner *spClass) {
	t := f.tokens
	kotlin := strings.HasSuffix(f.path, ".kt") || strings.HasSuffix(f.path, ".kts")
	var pending []spAnn
	var methods []spMethod
	for i := start; i < end; {
		if t[i].text == "@" {
			a, next := spAnnotation(t, i)
			pending = append(pending, a)
			i = next
			continue
		}
		if t[i].text == "class" || t[i].text == "interface" || t[i].text == "object" {
			if i+1 >= end || !spIdent(t[i+1].text) {
				i++
				continue
			}
			name := t[i+1]
			c := &spClass{name: name.text, qualified: spResolve(f, name.text), at: name, anns: pending, interfaceType: t[i].text == "interface", file: f}
			if owner != nil {
				c.qualified = owner.qualified + "." + name.text
			}
			pending = nil
			c.bean = spHas(f, c.anns, "Component", "Service", "Repository", "Configuration", "Controller", "RestController")
			j := i + 2
			headerEnd := end
			body := -1
			depth, angle := 0, 0
			for ; j < end; j++ {
				s := t[j].text
				if s == "(" {
					depth++
				}
				if s == ")" {
					depth--
				}
				if s == "<" {
					angle++
				}
				if s == ">" {
					angle--
				}
				if depth == 0 && angle == 0 {
					if s == "{" {
						body = j
						headerEnd = j
						break
					}
					if s == ";" || s == "}" || (j > i+2 && t[j].line > t[j-1].line && (s == "@" || s == "class" || s == "interface" || s == "object")) {
						headerEnd = j
						break
					}
				}
			}
			depth, angle = 0, 0
			parentStart := -1
			for k := i + 2; k < headerEnd; k++ {
				s := t[k].text
				if s == "(" {
					depth++
				}
				if s == ")" {
					depth--
				}
				if s == "<" {
					angle++
				}
				if s == ">" {
					angle--
				}
				if depth == 0 && angle == 0 && (s == ":" || s == "extends" || s == "implements") {
					parentStart = k + 1
					break
				}
			}
			if parentStart >= 0 {
				parents := append([]spToken{}, t[parentStart:headerEnd]...)
				for k := range parents {
					if parents[k].text == "implements" || parents[k].text == "extends" {
						parents[k].text = ","
					}
				}
				for _, part := range spParts(parents) {
					for k, v := range part {
						if v.text == "(" || v.text == "implements" {
							part = part[:k]
							break
						}
					}
					raw, _ := spUnwrap(spType(part))
					if raw != "" {
						c.parents = append(c.parents, spResolve(f, raw))
					}
				}
			}
			f.classes = append(f.classes, c)
			if c.bean {
				names := []string{}
				for _, a := range c.anns {
					n := spAnnName(f, a)
					if n == "Component" || n == "Service" || n == "Repository" || n == "Configuration" || n == "Controller" || n == "RestController" {
						names = spNames(f, []spAnn{a}, n, spDecap(c.name))
						break
					}
				}
				f.beans = append(f.beans, &spBean{names: names, typ: c.qualified, qualifier: spQualifier(f, c.anns), primary: spHas(f, c.anns, "Primary"), conditional: spConditional(f, c.anns), loc: spLocation(f, c.at, names[0], "Spring bean · static source candidate"), file: f})
			}
			if kotlin {
				for k := i + 2; k < headerEnd; k++ {
					if t[k].text == "(" {
						close := spMatch(t, k, "(", ")")
						for _, p := range spParts(t[k+1 : close]) {
							spAddInjection(f, p, nil, c.bean, &Position{Line: c.at.line, Col: c.at.col})
						}
						break
					}
				}
			}
			if body >= 0 {
				close := spMatch(t, body, "{", "}")
				spParseRange(f, body+1, close, c)
				i = close + 1
			} else {
				i = headerEnd
			}
			continue
		}
		if owner == nil {
			if len(spModifiers(t[i:i+1])) != 0 {
				pending = nil
			}
			i++
			continue
		}
		begin := i
		j := i
		paren := -1
		angle := 0
		for j < end {
			v := t[j]
			if v.text == "<" {
				angle++
			}
			if v.text == ">" {
				angle--
			}
			if v.text == "(" && angle == 0 {
				paren = j
				break
			}
			if v.text == "{" || v.text == ";" || v.text == "=" || (j > begin && v.line > t[j-1].line && angle == 0) {
				break
			}
			j++
		}
		if paren >= 0 && paren > begin {
			close := spMatch(t, paren, "(", ")")
			name := t[paren-1]
			prefix := spModifiers(t[begin : paren-1])
			if len(prefix) > 0 && prefix[0].text == "fun" {
				prefix = prefix[1:]
			}
			m := spMethod{name: name.text, at: name, anns: pending, params: t[paren+1 : close], constructor: name.text == owner.name || kotlin && name.text == "constructor"}
			pending = nil
			k := close + 1
			ret := k
			if k < end && t[k].text == ":" {
				ret = k + 1
				k = ret
				for k < end && t[k].text != "{" && t[k].text != "=" && t[k].text != ";" && (k == ret || t[k].line == t[k-1].line) {
					k++
				}
				m.typ = spType(t[ret:k])
			} else {
				m.typ = spType(prefix)
				for k < end && t[k].text != "{" && t[k].text != "=" && t[k].text != ";" && t[k].line == t[close].line {
					k++
				}
			}
			if spIdent(name.text) {
				methods = append(methods, m)
				if spHas(f, m.anns, "Bean") && !m.constructor && m.typ != "" && m.typ != "void" && m.typ != "Unit" {
					names := spNames(f, m.anns, "Bean", m.name)
					base, _ := spUnwrap(m.typ)
					f.beans = append(f.beans, &spBean{names: names, typ: spResolve(f, base), qualifier: spQualifier(f, m.anns), primary: spHas(f, m.anns, "Primary"), conditional: spConditional(f, m.anns) || spConditional(f, owner.anns), loc: spLocation(f, name, names[0], "@Bean factory · static source candidate"), file: f})
				}
				spEndpoints(f, owner, m)
			}
			if k < end && t[k].text == "{" {
				i = spMatch(t, k, "{", "}") + 1
			} else {
				for k < end && t[k].text != ";" && t[k].line == t[close].line {
					k++
					if k < end && t[k].text == "{" {
						k = spMatch(t, k, "{", "}") + 1
						break
					}
				}
				i = k
				if i < end && t[i].text == ";" {
					i++
				}
			}
			continue
		}
		if j > begin {
			spAddInjection(f, t[begin:j], pending, false, &Position{Line: owner.at.line, Col: owner.at.col})
		}
		pending = nil
		if j < end && t[j].text == "{" {
			i = spMatch(t, j, "{", "}") + 1
		} else if j < end && (t[j].text == "=" || t[j].text == ";") {
			line := t[j].line
			j++
			for j < end && t[j].line == line && t[j].text != ";" {
				if t[j].text == "{" {
					j = spMatch(t, j, "{", "}") + 1
				} else {
					j++
				}
			}
			if j < end && t[j].text == ";" {
				j++
			}
			i = j
		} else if j > begin {
			i = j
		} else {
			i++
		}
	}
	constructors := 0
	for _, m := range methods {
		if m.constructor {
			constructors++
		}
	}
	for _, m := range methods {
		if !m.constructor {
			owner.methods = append(owner.methods, m)
		}
		implicit := m.constructor && owner.bean && constructors == 1
		if implicit || spHas(f, m.anns, "Autowired", "Inject") {
			for _, p := range spParts(m.params) {
				spAddInjection(f, p, nil, true, &Position{Line: m.at.line, Col: m.at.col})
			}
		}
	}
}
func spDecap(s string) string {
	r := []rune(s)
	if len(r) > 1 && unicode.IsUpper(r[0]) && unicode.IsUpper(r[1]) {
		return s
	}
	if len(r) > 0 {
		r[0] = unicode.ToLower(r[0])
	}
	return string(r)
}
func spMappings(f *spFile, anns []spAnn) ([]string, []string, bool) {
	for _, a := range anns {
		n := spAnnName(f, a)
		method := ""
		switch n {
		case "GetMapping":
			method = "GET"
		case "PostMapping":
			method = "POST"
		case "PutMapping":
			method = "PUT"
		case "DeleteMapping":
			method = "DELETE"
		case "PatchMapping":
			method = "PATCH"
		case "RequestMapping":
			method = "ANY"
		default:
			continue
		}
		if spDynamicPath(a) {
			return nil, nil, false
		}
		paths := spStrings(a, "path")
		if len(paths) == 0 {
			paths = spStrings(a, "value")
		}
		if len(paths) == 0 {
			for j, v := range a.args {
				if (v.text == "path" || v.text == "value") && j+1 < len(a.args) && a.args[j+1].text == "=" {
					return nil, nil, false
				}
			}
			paths = []string{""}
		}
		methods := []string{method}
		if n == "RequestMapping" {
			var found []string
			for _, v := range a.args {
				switch v.text {
				case "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE":
					found = append(found, v.text)
				}
			}
			if len(found) > 0 {
				methods = found
			}
		}
		return paths, methods, true
	}
	return nil, nil, false
}
func spDynamicPath(a spAnn) bool {
	args := a.args
	named := false
	var path []spToken
	for i := 0; i+1 < len(args); i++ {
		if args[i+1].text == "=" {
			named = true
			if args[i].text == "path" || args[i].text == "value" {
				depth := 0
				for j := i + 2; j < len(args); j++ {
					s := args[j].text
					if s == "," && depth == 0 {
						break
					}
					if s == "[" || s == "{" {
						depth++
					}
					if s == "]" || s == "}" {
						depth--
					}
					path = append(path, args[j])
				}
				break
			}
		}
	}
	if !named {
		path = args
	}
	for _, t := range path {
		if !t.str && t.text != "[" && t.text != "]" && t.text != "{" && t.text != "}" && t.text != "," {
			return true
		}
	}
	return false
}
func spEndpoints(f *spFile, c *spClass, m spMethod) {
	paths, methods, ok := spMappings(f, m.anns)
	if !ok {
		return
	}
	prefix, _, classMap := spMappings(f, c.anns)
	if !classMap {
		if spHas(f, c.anns, "RequestMapping", "GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "PatchMapping") {
			return
		}
		prefix = []string{""}
	}
	for _, p := range prefix {
		for _, q := range paths {
			full := "/" + strings.Trim(strings.TrimRight(p, "/")+"/"+strings.TrimLeft(q, "/"), "/")
			for _, method := range methods {
				f.endpoints = append(f.endpoints, spLocation(f, m.at, m.name, method+" "+full+" · static source"))
			}
		}
	}
}

func spSource(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".java", ".kt", ".kts":
		return true
	}
	return false
}
func spConfig(path string) bool {
	name := strings.ToLower(filepath.Base(path))
	return strings.HasPrefix(name, "application") && (strings.HasSuffix(name, ".properties") || strings.HasSuffix(name, ".yaml") || strings.HasSuffix(name, ".yml"))
}
func spDenied(name string) bool {
	n := strings.ToLower(name)
	if strings.HasPrefix(n, ".") || strings.Contains(n, "credential") || strings.Contains(n, "secret") {
		return true
	}
	switch n {
	case "build", "target", "out", "bin", "dist", "node_modules", "vendor", "cache", "__pycache__", "proc", "sys", "dev":
		return true
	}
	return false
}
func spWithin(root, path string) bool {
	r, err := filepath.Rel(root, path)
	return err == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator))
}
func spCanonical(path string) string {
	abs, _ := filepath.Abs(path)
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		return real
	}
	if dir, err := filepath.EvalSymlinks(filepath.Dir(abs)); err == nil {
		return filepath.Join(dir, filepath.Base(abs))
	}
	return abs
}
func spRoot(req Request) (string, error) {
	p, err := filepath.Abs(req.Path)
	if err != nil {
		return "", err
	}
	if req.Root != "" {
		root, er := filepath.Abs(req.Root)
		if er != nil {
			return "", er
		}
		root, er = filepath.EvalSymlinks(root)
		if er != nil {
			return "", er
		}
		if req.Path != "" {
			real, er := filepath.EvalSymlinks(p)
			if er != nil {
				return "", er
			}
			if !spWithin(root, real) {
				return "", fmt.Errorf("Spring source is outside requested root")
			}
		}
		return root, nil
	}
	dir := filepath.Dir(p)
	for {
		for _, marker := range []string{"pom.xml", "build.gradle.kts", "build.gradle", "settings.gradle.kts", "settings.gradle", ".git"} {
			if _, er := os.Stat(filepath.Join(dir, marker)); er == nil {
				return dir, nil
			}
		}
		up := filepath.Dir(dir)
		if up == dir {
			break
		}
		dir = up
	}
	return "", fmt.Errorf("Spring project root not found")
}
func spRead(path string) (string, error) {
	if !spSource(path) && !spConfig(path) {
		return "", fmt.Errorf("Unsupported Spring source path")
	}
	for _, part := range strings.Split(filepath.Clean(path), string(filepath.Separator)) {
		if part != "" && spDenied(part) {
			return "", fmt.Errorf("Excluded Spring source path")
		}
	}
	s, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !s.Mode().IsRegular() || s.Size() > spMaxFileBytes {
		return "", fmt.Errorf("Spring source is not a bounded regular file")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if strings.ContainsRune(string(b), 0) {
		return "", fmt.Errorf("Binary Spring source excluded")
	}
	return string(b), nil
}
func spLoad(ctx context.Context, req Request) (*spIndex, error) {
	root, err := spRoot(req)
	if err != nil {
		return nil, err
	}
	var paths []string
	var signature strings.Builder
	total, visited := int64(0), 0
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > 20000 {
			return fmt.Errorf("Spring project scan entry limit exceeded")
		}
		if path != root && spDenied(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if d.IsDir() || (!spSource(path) && !spConfig(path)) {
			return nil
		}
		info, er := d.Info()
		if er != nil {
			return er
		}
		if !info.Mode().IsRegular() || info.Size() > spMaxFileBytes {
			return fmt.Errorf("Spring source exceeds file limit: %s", d.Name())
		}
		total += info.Size()
		if len(paths) >= spMaxFiles || total > spMaxBytes {
			return fmt.Errorf("Spring project scan size limit exceeded")
		}
		paths = append(paths, path)
		fmt.Fprintf(&signature, "%s:%d:%d\n", path, info.Size(), info.ModTime().UnixNano())
		return nil
	})
	if err != nil {
		return nil, err
	}
	sig := sha256.Sum256([]byte(signature.String()))
	spCache.Lock()
	cached, ok := spCache.entries[root]
	spCache.Unlock()
	var idx *spIndex
	if ok && cached.signature == sig && time.Since(cached.at) < 5*time.Second {
		idx = cached.index
	} else {
		idx = &spIndex{}
		for _, path := range paths {
			source, er := spRead(path)
			if er != nil {
				return nil, er
			}
			if spSource(path) {
				idx.files = append(idx.files, spParse(path, source))
			} else {
				idx.properties = append(idx.properties, spProperties(path, source)...)
			}
		}
		spAssemble(idx)
		spCache.Lock()
		if len(spCache.entries) >= 4 {
			old := ""
			var when time.Time
			for k, v := range spCache.entries {
				if old == "" || v.at.Before(when) {
					old = k
					when = v.at
				}
			}
			delete(spCache.entries, old)
		}
		spCache.entries[root] = spCacheEntry{sig, idx, time.Now()}
		spCache.Unlock()
	}
	if req.Text != nil {
		if len(*req.Text) > spMaxFileBytes {
			return nil, fmt.Errorf("Spring unsaved source exceeds file limit")
		}
		copyIdx := &spIndex{properties: idx.properties}
		abs := spCanonical(req.Path)
		found := false
		for _, f := range idx.files {
			if f.path == abs {
				copyIdx.files = append(copyIdx.files, spParse(abs, *req.Text))
				found = true
			} else {
				copyIdx.files = append(copyIdx.files, f)
			}
		}
		if !found && spSource(abs) {
			copyIdx.files = append(copyIdx.files, spParse(abs, *req.Text))
		}
		spAssemble(copyIdx)
		idx = copyIdx
	}
	return idx, nil
}
func spAssemble(idx *spIndex) {
	idx.beans = nil
	idx.classes = map[string]*spClass{}
	for _, f := range idx.files {
		for _, c := range f.classes {
			idx.classes[c.qualified] = c
		}
	}
	for _, f := range idx.files {
		for _, b := range f.beans {
			c := idx.classes[b.typ]
			if c != nil && c.interfaceType && c.file == f && c.at.line == b.loc.Line && c.at.col == b.loc.Col {
				if spDataAnnotation(f, c.anns, "NoRepositoryBean") {
					continue
				}
				if spRepository(idx, c, map[string]bool{}) {
					// Files can be shared with a cached index; never mutate their beans.
					copyBean := *b
					copyBean.loc.Detail = spRepositoryDetail
					b = &copyBean
				}
			}
			idx.beans = append(idx.beans, b)
		}
		for _, c := range f.classes {
			if c.bean || !c.interfaceType || spDataAnnotation(f, c.anns, "NoRepositoryBean") || !spRepository(idx, c, map[string]bool{}) {
				continue
			}
			name := spDecap(c.name)
			idx.beans = append(idx.beans, &spBean{names: []string{name}, typ: c.qualified, qualifier: spQualifier(f, c.anns), primary: spHas(f, c.anns, "Primary"), conditional: spConditional(f, c.anns), loc: spLocation(f, c.at, name, spRepositoryDetail), file: f})
		}
	}
}

const spRepositoryDetail = "Spring Data repository · dynamic proxy source candidate"

// Unlike legacy stereotype recognition, inferred repositories require a known
// qualified Spring Data name, so unrelated JpaRepository interfaces do not match.
func spDataAnnotation(f *spFile, anns []spAnn, name string) bool {
	for _, a := range anns {
		if spResolve(f, a.name) == "org.springframework.data.repository."+name {
			return true
		}
	}
	return false
}

func spRepository(idx *spIndex, c *spClass, seen map[string]bool) bool {
	if !c.interfaceType || seen[c.qualified] {
		return false
	}
	seen[c.qualified] = true
	if spDataAnnotation(c.file, c.anns, "RepositoryDefinition") {
		return true
	}
	for _, parent := range c.parents {
		switch parent {
		case "org.springframework.data.jpa.repository.JpaRepository",
			"org.springframework.data.repository.Repository",
			"org.springframework.data.repository.CrudRepository",
			"org.springframework.data.repository.ListCrudRepository",
			"org.springframework.data.repository.PagingAndSortingRepository",
			"org.springframework.data.repository.ListPagingAndSortingRepository",
			"org.springframework.data.repository.reactive.ReactiveCrudRepository",
			"org.springframework.data.repository.reactive.ReactiveSortingRepository",
			"org.springframework.data.repository.reactive.RxJava3CrudRepository",
			"org.springframework.data.repository.reactive.RxJava3SortingRepository",
			"org.springframework.data.repository.kotlin.CoroutineCrudRepository",
			"org.springframework.data.repository.kotlin.CoroutineSortingRepository":
			return true
		}
		// NoRepositoryBean excludes the base itself, not concrete child interfaces.
		if base := idx.classes[parent]; base != nil && spRepository(idx, base, seen) {
			return true
		}
	}
	return false
}
func spAssignable(idx *spIndex, bean, target string, seen map[string]bool) bool {
	if bean == target {
		return true
	}
	if seen[bean] {
		return false
	}
	seen[bean] = true
	if c := idx.classes[bean]; c != nil {
		for _, parent := range c.parents {
			if spAssignable(idx, parent, target, seen) {
				return true
			}
		}
	}
	return false
}
func spCandidates(idx *spIndex, inj *spInjection) []*spBean {
	base, multi := spUnwrap(inj.typ)
	if base == "" || spScalar(base) {
		return nil
	}
	target := spResolve(inj.file, base)
	var matches []*spBean
	for _, b := range idx.beans {
		if spAssignable(idx, b.typ, target, map[string]bool{}) {
			if inj.qualifier != "" && !spContains(b.names, inj.qualifier) && spBeanQualifier(b) != inj.qualifier {
				continue
			}
			matches = append(matches, b)
		}
	}
	if inj.qualifier != "" || multi {
		return matches
	}
	if inj.resource {
		var named []*spBean
		for _, b := range matches {
			if spContains(b.names, inj.name) {
				named = append(named, b)
			}
		}
		if len(named) > 0 {
			return named
		}
	}
	var primary, named []*spBean
	conditional := false
	for _, b := range matches {
		if b.primary {
			primary = append(primary, b)
		}
		if spContains(b.names, inj.name) {
			named = append(named, b)
		}
		conditional = conditional || b.conditional
	}
	if conditional {
		return matches
	}
	if len(primary) > 0 {
		return primary
	}
	if len(named) > 0 {
		return named
	}
	return matches
}
func spContains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
func spBeanQualifier(b *spBean) string {
	return b.qualifier
}
func springMarkers(req Request) ([]SpringMarker, error) {
	if !spSource(req.Path) {
		return nil, fmt.Errorf("Spring markers require Java or Kotlin source")
	}
	source := ""
	if req.Text != nil {
		source = *req.Text
		if len(source) > spMaxFileBytes {
			return nil, fmt.Errorf("Spring unsaved source exceeds file limit")
		}
	} else {
		var err error
		source, err = spRead(req.Path)
		if err != nil {
			return nil, err
		}
	}
	f := spParse(req.Path, source)
	idx := &spIndex{files: []*spFile{f}}
	spAssemble(idx)
	out := []SpringMarker{}
	for _, b := range idx.beans {
		title := "Spring bean: " + b.loc.Name
		if b.loc.Detail == spRepositoryDetail {
			title = "Spring Data repository: " + b.loc.Name + " · dynamic proxy source candidate"
		}
		out = append(out, SpringMarker{Kind: "spring-bean", Line: b.loc.Line, Col: b.loc.Col, Name: b.loc.Name, Type: b.typ, Title: title})
	}
	for _, i := range f.injections {
		kind, title := "spring", "Spring injection: "+i.typ
		if i.key != "" {
			kind = "spring-property"
			title = "Spring property: " + i.key
		}
		out = append(out, SpringMarker{Kind: kind, Line: i.at.line, Col: i.at.col, Name: i.name, Type: i.typ, Qualifier: i.qualifier, Key: i.key, Title: title, Owner: i.owner})
	}
	return out, nil
}
func springRelated(ctx context.Context, _ *Engine, req Request) ([]Location, error) {
	idx, err := spLoad(ctx, req)
	if err != nil {
		return nil, err
	}
	path := spCanonical(req.Path)
	var file *spFile
	for _, f := range idx.files {
		if f.path == path {
			file = f
			break
		}
	}
	if file == nil {
		return []Location{}, nil
	}
	var chosen *spInjection
	for _, i := range file.injections {
		if (i.at.line == req.Line && (req.Name == "" || i.name == req.Name)) || (req.Name != "" && i.name == req.Name) {
			chosen = i
			if i.at.line == req.Line {
				break
			}
		}
	}
	if req.Kind == "spring-property" {
		key := req.Key
		if key == "" && chosen != nil {
			key = chosen.key
		}
		var out []Location
		for _, l := range idx.properties {
			if l.Name == key {
				out = append(out, l)
			}
		}
		return spUnique(out), nil
	}
	if req.Kind == "spring-bean" {
		var selected []*spBean
		for _, b := range idx.beans {
			if b.file == file && b.loc.Line == req.Line && (req.Name == "" || spContains(b.names, req.Name)) {
				selected = append(selected, b)
			}
		}
		var out []Location
		for _, f := range idx.files {
			for _, i := range f.injections {
				if i.key != "" {
					continue
				}
				for _, candidate := range spCandidates(idx, i) {
					for _, b := range selected {
						if candidate == b {
							out = append(out, spLocation(f, i.at, i.name, "Spring injection use · static source candidate"))
						}
					}
				}
			}
		}
		return spUnique(out), nil
	}
	if chosen == nil {
		chosen = &spInjection{name: req.Name, typ: req.Type, qualifier: req.Qualifier, file: file}
	}
	var out []Location
	for _, b := range spCandidates(idx, chosen) {
		l := b.loc
		if b.primary {
			l.Detail += " · @Primary"
		}
		if b.conditional {
			l.Detail += " · conditional/profile not evaluated"
		}
		out = append(out, l)
	}
	return spUnique(out), nil
}
func springProject(req Request) (any, error) {
	idx, err := spLoad(context.Background(), req)
	if err != nil {
		return nil, err
	}
	var out []Location
	switch req.Kind {
	case "properties":
		out = append(out, idx.properties...)
	case "endpoints":
		for _, f := range idx.files {
			out = append(out, f.endpoints...)
		}
	default:
		for _, b := range idx.beans {
			l := b.loc
			if b.conditional {
				l.Detail += " · conditional/profile not evaluated"
			}
			out = append(out, l)
		}
	}
	q := strings.ToLower(req.Query)
	filtered := []Location{}
	for _, l := range out {
		if q == "" || strings.Contains(strings.ToLower(l.Name+" "+l.Detail), q) {
			filtered = append(filtered, l)
		}
	}
	return spUnique(filtered), nil
}
func spUnique(in []Location) []Location {
	out := []Location{}
	seen := map[string]bool{}
	for _, l := range in {
		k := fmt.Sprintf("%s:%d:%d:%s", l.Path, l.Line, l.Col, l.Detail)
		if !seen[k] {
			seen[k] = true
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		if out[i].Line != out[j].Line {
			return out[i].Line < out[j].Line
		}
		return out[i].Col < out[j].Col
	})
	return out
}

var spYAMLKey = regexp.MustCompile(`^( *)([A-Za-z0-9_.-]+)\s*:`)
var spPropKey = regexp.MustCompile(`^\s*([A-Za-z0-9_.-]+)\s*(?:[=:]|\s)`)

func spProperties(path, source string) []Location {
	out := []Location{}
	type level struct {
		indent int
		key    string
	}
	var stack []level
	blockIndent := -1
	for line, text := range strings.Split(source, "\n") {
		trim := strings.TrimSpace(text)
		if trim == "" || strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, "!") {
			continue
		}
		key, col, width := "", 0, 0
		if strings.HasSuffix(strings.ToLower(path), ".properties") {
			m := spPropKey.FindStringSubmatchIndex(text)
			if m == nil {
				continue
			}
			key = text[m[2]:m[3]]
			col = m[2]
			width = len(key)
		} else {
			if trim == "---" {
				stack = nil
				blockIndent = -1
				continue
			}
			indent := len(text) - len(strings.TrimLeft(text, " "))
			if blockIndent >= 0 {
				if indent > blockIndent {
					continue
				}
				blockIndent = -1
			}
			if strings.HasPrefix(trim, "-") {
				blockIndent = indent
				continue
			}
			m := spYAMLKey.FindStringSubmatchIndex(text)
			if m == nil {
				continue
			}
			indent = m[3] - m[2]
			for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
				stack = stack[:len(stack)-1]
			}
			parts := []string{}
			for _, p := range stack {
				parts = append(parts, p.key)
			}
			local := text[m[4]:m[5]]
			parts = append(parts, local)
			key = strings.Join(parts, ".")
			col = m[4]
			width = len(local)
			value := strings.TrimSpace(text[m[1]:])
			if value == "" || strings.HasPrefix(value, "#") {
				stack = append(stack, level{indent, local})
			} else if strings.HasPrefix(value, "|") || strings.HasPrefix(value, ">") {
				blockIndent = indent
			}
		}
		out = append(out, Location{Path: path, Line: line, Col: col, EndLine: line, EndCol: col + width, Name: key, Text: key, Detail: "Configuration key declaration"})
	}
	return out
}
