package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConfiguredFileLanguageIDs(t *testing.T) {
	e, err := NewEngine("../mods/codenav/bridge/servers.json", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	cases := map[string][2]string{
		"README.md": {"markdown", "markdown"}, "notes.markdown": {"markdown", "markdown"}, "config.toml": {"toml", "toml"}, "pom.xml": {"xml", "xml"}, "schema.xsd": {"xml", "xml"}, "style.xsl": {"xml", "xml"}, "style.xslt": {"xml", "xml"}, "icon.svg": {"xml", "xml"},
		"main.go": {"go", "go"}, "lib.rs": {"rust", "rust"}, "main.swift": {"swift", "swift"},
		"App.java": {"java", "java"}, "Main.kt": {"kotlin", "kotlin"}, "build.kts": {"kotlin", "kotlin"},
		"main.py": {"python", "python"}, "main.pyi": {"python", "python"},
		"app.ts": {"typescript", "typescript"}, "app.mts": {"typescript", "typescript"}, "app.cts": {"typescript", "typescript"},
		"App.TSX": {"typescript", "typescriptreact"}, "app.js": {"typescript", "javascript"},
		"app.mjs": {"typescript", "javascript"}, "app.cjs": {"typescript", "javascript"}, "App.jsx": {"typescript", "javascriptreact"},
		"package.json": {"json", "json"}, "settings.JSONC": {"json", "jsonc"},
		"config.yml": {"yaml", "yaml"}, "config.yaml": {"yaml", "yaml"},
		"index.htm": {"html", "html"}, "index.html": {"html", "html"},
		"main.css": {"css", "css"}, "main.scss": {"css", "scss"}, "main.less": {"css", "less"},
		"setup.sh": {"shellscript", "shellscript"}, "setup.bash": {"shellscript", "shellscript"},
		"main.c": {"cpp", "c"}, "main.h": {"cpp", "c"}, "main.C": {"cpp", "cpp"}, "main.H": {"cpp", "cpp"},
		"main.cc": {"cpp", "cpp"}, "main.cpp": {"cpp", "cpp"}, "main.cxx": {"cpp", "cpp"},
		"main.c++": {"cpp", "cpp"}, "main.hh": {"cpp", "cpp"}, "main.hpp": {"cpp", "cpp"},
		"main.hxx": {"cpp", "cpp"}, "main.h++": {"cpp", "cpp"},
	}
	for file, want := range cases {
		t.Run(file, func(t *testing.T) {
			lang, _ := e.language(file)
			if lang != want[0] || languageID(file, lang) != want[1] {
				t.Fatalf("got family=%q ID=%q; want %v", lang, languageID(file, lang), want)
			}
		})
	}
	for _, file := range []string{"notes.txt", "setup.zsh", "setup.fish", "query.sql", "noextension"} {
		if lang, _ := e.language(file); lang != "" {
			t.Errorf("unsupported %s selects %s", file, lang)
		}
	}
	if languageID("custom.ext", "custom") != "custom" {
		t.Fatal("custom language fallback changed")
	}
}

func TestDialectIDSentOnDocumentOpen(t *testing.T) {
	e, path := fixtureEngine(t)
	ctx := fixtureContext(t)
	s, err := e.Server(ctx, path, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, dialect := range []struct{ file, family, id string }{
		{"app.jsx", "typescript", "javascriptreact"}, {"settings.jsonc", "json", "jsonc"},
		{"style.scss", "css", "scss"}, {"style.less", "css", "less"}, {"main.c", "cpp", "c"},
	} {
		s.lang = dialect.family
		path := filepath.Join(filepath.Dir(path), dialect.file)
		uri, _, err := s.syncText(ctx, path, "buffer text", "dialect-test")
		if err != nil {
			t.Fatal(err)
		}
		state := inspectFixture(t, ctx, s)
		doc := state["docs"].(map[string]any)[uri].(map[string]any)
		if doc["languageId"] != dialect.id {
			t.Fatalf("%s didOpen: %v", dialect.file, doc)
		}
	}
}

// Optional host smoke check: starts only owned servers in temporary directories,
// never the shared engine or any workspace builds. CI does not require host tools.
func TestInstalledCommonLanguageServers(t *testing.T) {
	if os.Getenv("HERDR_TEST_COMMON_LSP") != "1" {
		t.Skip("set HERDR_TEST_COMMON_LSP=1 for installed-server integration")
	}
	e, err := NewEngine("../mods/codenav/bridge/servers.json", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	for _, sample := range []struct{ file, text string }{
		{"test.json", "{\"name\":true}"}, {"test.jsonc", "{ /* comment */ \"name\":true }"},
		{"test.yaml", "name: true\n"}, {"test.html", "<html><body></body></html>"},
		{"test.css", "body { color: red; }"}, {"test.scss", "$x: red; body { color: $x; }"},
		{"test.less", "@x: red; body { color: @x; }"}, {"test.sh", "#!/bin/sh\necho hello\n"}, {"test.py", "name = True\n"},
		{"test.md", "# Heading\n\n[link](#heading)\n"}, {"test.toml", "name = true\n"},
		{"test.c", "int main(void) { return 0; }"}, {"test.cpp", "int main() { return 0; }"},
	} {
		t.Run(sample.file, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			path := filepath.Join(t.TempDir(), sample.file)
			s, err := e.Server(ctx, path, false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Stop()
			uri, _, err := s.syncText(ctx, path, sample.text, "host-smoke")
			if err != nil {
				t.Fatal(err)
			}
			if !s.editorCapability("completionProvider", nil) {
				t.Fatal("completion not advertised")
			}
			_, err = s.Call(ctx, "textDocument/completion", map[string]any{"textDocument": map[string]string{"uri": uri}, "position": map[string]int{"line": 0, "character": 0}})
			if err != nil {
				t.Fatal(err)
			}
			if sample.file == "test.sh" {
				_, err := s.Call(ctx, "textDocument/formatting", map[string]any{"textDocument": map[string]string{"uri": uri}, "options": map[string]any{"tabSize": 2, "insertSpaces": true}})
				if err != nil {
					t.Fatal("Bash formatting with shfmt", err)
				}
			}
		})
	}
}

func TestInstalledCommonLanguageDiagnostics(t *testing.T) {
	if os.Getenv("HERDR_TEST_COMMON_LSP") != "1" {
		t.Skip("set HERDR_TEST_COMMON_LSP=1 for installed-server integration")
	}
	e, err := NewEngine("../mods/codenav/bridge/servers.json", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	for _, sample := range []struct{ file, text string }{
		{"invalid.json", "{\"name\": }"}, {"invalid.yaml", "name: [\n"},
		{"invalid.sh", "#!/bin/sh\necho $1\n"}, {"invalid.toml", "name = [\n"},
		{"invalid.css", "body { color: ; broken }"}, {"invalid.c", "int main( { return 0; }"},
	} {
		t.Run(sample.file, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			path := filepath.Join(t.TempDir(), sample.file)
			s, err := e.Server(ctx, path, false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Stop()
			uri, _, err := s.syncText(ctx, path, sample.text, "diagnostics-smoke")
			if err != nil {
				t.Fatal(err)
			}
			tick := time.NewTicker(25 * time.Millisecond)
			defer tick.Stop()
			for {
				s.mu.Lock()
				count := len(s.diagnostics[uri])
				s.mu.Unlock()
				if count > 0 {
					return
				}
				select {
				case <-ctx.Done():
					t.Fatal("invalid buffer produced no diagnostics")
				case <-tick.C:
				}
			}
		})
	}
}
