package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestEditorCompletionSafety(t *testing.T) {
	text := "😀name\nnext"
	for _, raw := range []string{
		`{"label":"snippet","insertTextFormat":2,"insertText":"${TM_FILENAME}"}`,
		`{"label":"command","command":{"command":"write-files"}}`,
		`{"label":"bad","textEdit":{"range":{"start":{"line":0,"character":1},"end":{"line":0,"character":2}},"newText":"x"}}`,
		`{"label":"bad","textEdit":{"insert":{},"replace":{},"newText":"x"}}`,
		`{"label":"bad","textEdit":{"range":{"start":{"line":0,"character":2},"end":{"line":0,"character":3}}}}`,
		`{"label":"cross-file","additionalTextEdits":[{"uri":"file:///other.go","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"x"}]}`,
	} {
		if item := completionItem(json.RawMessage(raw), text); item.Disabled == "" {
			t.Fatal("unsafe completion enabled", raw)
		}
	}
	valid := completionItem(json.RawMessage(`{"label":"name","textEdit":{"range":{"start":{"line":0,"character":2},"end":{"line":0,"character":6}},"newText":"newName"},"additionalTextEdits":[{"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":0}},"newText":"import "}]}`), text)
	if valid.Disabled != "" || valid.TextEdit == nil || len(valid.Additional) != 1 {
		t.Fatal(valid)
	}
	var items []string
	for i := 0; i < 120; i++ {
		items = append(items, fmt.Sprintf(`{"label":"item%d"}`, i))
	}
	list, err := completionList(json.RawMessage("["+strings.Join(items, ",")+"]"), text)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.(map[string]any)["items"].([]editorCompletionItem)) != 100 || list.(map[string]any)["incomplete"] != true {
		t.Fatal("completion bound missing")
	}
	defaults, err := completionList(json.RawMessage(`{"itemDefaults":{"editRange":{"start":{"line":0,"character":2},"end":{"line":0,"character":6}}},"items":[{"label":"defaultRange"}]}`), text)
	if err != nil {
		t.Fatal(err)
	}
	item := defaults.(map[string]any)["items"].([]editorCompletionItem)[0]
	if item.Disabled != "" || item.TextEdit == nil || item.TextEdit.NewText != "defaultRange" {
		t.Fatal(item)
	}
}

func TestEditorCompletionAndFormattingBufferedProtocol(t *testing.T) {
	e, path := fixtureEngine(t)
	req := Request{Path: path, DocumentOwner: "completion-editor", Revision: revision(0), Text: textValue("package current\n"), Line: 0, Col: 10}
	documentHTTP(t, e, "document_sync", req, "")
	req.Text = nil
	result := documentHTTP(t, e, "completion", req, "")
	if result["document_owner"] != req.DocumentOwner || result["revision"] != float64(0) {
		t.Fatal(result)
	}
	value := result["value"].(map[string]any)
	items := value["items"].([]any)
	if len(items) != 2 || value["resolve_supported"] != true {
		t.Fatal(value)
	}
	var plain map[string]any
	for _, raw := range items {
		item := raw.(map[string]any)
		if item["label"] == "snippet" && (item["disabled_reason"] != nil || item["insert_text"] != "unsupported") {
			t.Fatal("snippet default was not converted", item)
		}
		if item["label"] == "completed" {
			plain = item
		}
	}
	req.CompletionItem, _ = json.Marshal(plain["item"])
	resolved := documentHTTP(t, e, "completion_resolve", req, "")["value"].(map[string]any)
	if len(resolved["additional_text_edits"].([]any)) != 1 {
		t.Fatal(resolved)
	}
	formatted := documentHTTP(t, e, "formatting", req, "")["value"].(map[string]any)
	if len(formatted["edits"].([]any)) != 1 {
		t.Fatal(formatted)
	}
	bad := req
	bad.DocumentOwner = "other-editor"
	documentHTTP(t, e, "completion", bad, "owner conflict")
	bad = req
	bad.Revision = revision(1)
	documentHTTP(t, e, "formatting", bad, "stale")
	documentHTTP(t, e, "completion", Request{Path: path}, "document owner")
	documentHTTP(t, e, "document_close", req, "")
}

func TestPlainCompletionSnippets(t *testing.T) {
	for source, want := range map[string]string{
		`literal`: `literal`, `call($1)$0`: `call()`, `${1:name} = $1; $0`: `name = name; `,
		`${1:outer ${2:inner}}`: `outer inner`, `${1|red,green,blue|}`: `red`,
		`${1|a\,b,c|}`: `a,b`, `${1|a\|b,c|}`: `a|b`, `\$schema \\ \}`: `$schema \ }`,
		`${1:😀名前}`: `😀名前`, `${1:}`: ``, `${1|,empty|}`: ``,
	} {
		got, err := plainCompletionSnippet(source)
		if err != nil || got != want {
			t.Errorf("%q = %q, %v; want %q", source, got, err, want)
		}
	}
	for _, source := range []string{`${TM_FILENAME}`, `${HOME:default}`, `$TM_SELECTED_TEXT`, `${1/foo/bar/}`, `${1:missing`, `${1|a,b}`, `${1!}`, `${`, strings.Repeat(`${1:`, 18) + strings.Repeat(`}`, 18), strings.Repeat(`x`, (256<<10)+1)} {
		if _, err := plainCompletionSnippet(source); err == nil {
			t.Errorf("unsupported snippet accepted: %.80q", source)
		}
	}
	text := "old\n"
	item := completionItem(json.RawMessage(`{"label":"method","insertTextFormat":2,"insertText":"raw($0)","textEdit":{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"call(${1:arg})$0"},"additionalTextEdits":[{"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":0}},"newText":"literal $0"}]}`), text)
	if item.Disabled != "" || item.TextEdit == nil || item.TextEdit.NewText != "call(arg)" || item.InsertText != "call(arg)" || item.Additional[0].NewText != "literal $0" {
		t.Fatal(item)
	}
	item = completionItem(json.RawMessage(`{"label":"transform","insertTextFormat":2,"textEdit":{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"${1/a/b/}"}}`), text)
	if item.Disabled == "" || item.TextEdit.NewText != "" || item.InsertText != "" {
		t.Fatal("unsupported snippet exposed for insertion", item)
	}
	list, err := completionList(json.RawMessage(`{"itemDefaults":{"insertTextFormat":2,"editRange":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}}},"items":[{"label":"choice","textEditText":"${1|yes,no|}$0"}]}`), text)
	if err != nil {
		t.Fatal(err)
	}
	if got := list.(map[string]any)["items"].([]editorCompletionItem)[0]; got.Disabled != "" || got.TextEdit.NewText != "yes" {
		t.Fatal(got)
	}
}
