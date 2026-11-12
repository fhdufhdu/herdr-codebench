package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupStatusOnlyDiscoversCommands(t *testing.T) {
	e, path := fixtureEngine(t)
	status, err := e.setupStatus(Request{Lang: "go", Root: filepath.Dir(path)})
	if err != nil || !status.Installed || status.Running || status.Root != filepath.Dir(path) || status.Command == "" {
		t.Fatal(status, err)
	}
	if len(e.status()) != 0 {
		t.Fatal("status started a language server")
	}
	status, err = e.setupStatus(Request{Lang: "go"})
	if err != nil || !status.Installed || status.Root != "" || status.Running {
		t.Fatal(status, err)
	}
	if len(e.status()) != 0 {
		t.Fatal("command discovery started a language server")
	}
}
func TestSetupHTTPContract(t *testing.T) {
	e, path := fixtureEngine(t)
	var response struct {
		OK     bool                `json:"ok"`
		Result SetupLanguageStatus `json:"result"`
		Error  string              `json:"error"`
	}
	w := requestHTTP(e, "test-secret", "setup_status", `{"lang":"go"}`, nil)
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 || !response.OK || response.Result.Language != "go" || !response.Result.Installed || response.Result.Running {
		t.Fatal(w.Code, w.Body, err)
	}
	if len(e.status()) != 0 {
		t.Fatal("HTTP setup check started a process")
	}
	w = requestHTTP(e, "test-secret", "setup_start", `{"lang":"go"}`, nil)
	response.OK = true
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if response.OK || !strings.Contains(response.Error, "root is required") {
		t.Fatal(w.Body)
	}
	body, _ := json.Marshal(Request{Lang: "go", Root: filepath.Dir(path)})
	w = requestHTTP(e, "test-secret", "setup_start", string(body), nil)
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	if !response.OK || !response.Result.Running || response.Result.Root != filepath.Dir(path) {
		t.Fatal(w.Body)
	}
}

func TestSetupKnownLanguages(t *testing.T) {
	e, err := NewEngine("../mods/codenav/bridge/servers.json", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	for _, lang := range []string{"go", "rust", "swift", "typescript", "python", "java", "kotlin", "json", "yaml", "html", "css", "shellscript", "cpp", "markdown", "toml", "xml"} {
		status, err := e.setupStatus(Request{Lang: lang})
		if err != nil || status.Language != lang || status.Command == "" || status.Running {
			t.Fatal(lang, status, err)
		}
		if !status.Installed && status.Error == "" {
			t.Fatal("missing executable had no installation error", status)
		}
	}
	if len(e.status()) != 0 {
		t.Fatal("language checks started processes")
	}
}

func TestSetupMissingLanguageServer(t *testing.T) {
	e, path := fixtureEngine(t)
	entry := e.config["go"]
	entry.Commands = [][]string{{filepath.Join(t.TempDir(), "missing-herdr-language-server")}}
	e.config["go"] = entry
	status, err := e.setupStatus(Request{Lang: "go", Root: filepath.Dir(path)})
	if err != nil || status.Installed || status.Running || !strings.Contains(status.Error, "not installed") {
		t.Fatal(status, err)
	}
	status, err = e.setupStart(fixtureContext(t), Request{Lang: "go", Root: filepath.Dir(path)})
	if err == nil || status.Installed || status.Running || status.Error == "" {
		t.Fatal(status, err)
	}
	if len(e.status()) != 0 {
		t.Fatal("missing executable produced a running server")
	}
}

func TestSetupValidatesLanguageAndRoot(t *testing.T) {
	e, path := fixtureEngine(t)
	requests := []Request{{Root: filepath.Dir(path)}, {Lang: "unknown", Root: filepath.Dir(path)}, {Lang: "go"}, {Lang: "go", Root: "relative"}, {Lang: "go", Root: filepath.Join(filepath.Dir(path), "nonexistent")}, {Lang: "go", Root: path}}
	for _, req := range requests {
		status, err := e.setupStart(fixtureContext(t), req)
		if err == nil || status.Running || status.Error == "" {
			t.Fatal(req, status, err)
		}
	}
	for _, req := range requests {
		if req.Lang == "go" && req.Root == "" {
			continue
		}
		if _, err := e.setupStatus(req); err == nil {
			t.Fatal("invalid status selection accepted", req)
		}
	}
	if len(e.status()) != 0 {
		t.Fatal("invalid setup started a process")
	}
}

func TestSetupStartsRealServerWithoutOpeningSyntheticFile(t *testing.T) {
	e, path := fixtureEngine(t)
	root := filepath.Dir(path)
	if err := os.Mkdir(filepath.Join(root, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "nested")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	status, err := e.setupStart(fixtureContext(t), Request{Lang: "go", Root: nested})
	if err != nil || !status.Running || !status.Installed || status.Root != root || status.Error != "" {
		t.Fatal(status, err)
	}
	e.mu.Lock()
	server := e.servers["go\x00"+root]
	e.mu.Unlock()
	if server == nil {
		t.Fatal("real initialized server missing")
	}
	state := inspectFixture(t, fixtureContext(t), server)
	if state["opens"] != float64(0) || len(state["docs"].(map[string]any)) != 0 {
		t.Fatal("setup opened a synthetic document", state)
	}
	for _, dir := range []string{root, nested} {
		if _, err := os.Stat(filepath.Join(dir, "__herdr_lsp_setup__.go")); !os.IsNotExist(err) {
			t.Fatal("setup created a source file", err)
		}
	}
	again, err := e.setupStatus(Request{Lang: "go", Root: nested})
	if err != nil || !again.Running || again.Root != root {
		t.Fatal(again, err)
	}
	server.Stop()
	stopped, err := e.setupStatus(Request{Lang: "go", Root: nested})
	if err != nil || stopped.Running || stopped.Error == "" {
		t.Fatal(stopped, err)
	}
}

func TestSetupFailingServerHelper(t *testing.T) {
	if os.Getenv("HERDR_SETUP_LSP_FAILURE") == "1" {
		os.Exit(4)
	}
}
func TestSetupDoesNotClaimFailedInitialization(t *testing.T) {
	e, path := fixtureEngine(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	entry := e.config["go"]
	entry.Commands = [][]string{{exe, "-test.run=^TestSetupFailingServerHelper$"}}
	entry.Env = map[string]string{"HERDR_SETUP_LSP_FAILURE": "1"}
	e.config["go"] = entry
	status, err := e.setupStart(fixtureContext(t), Request{Lang: "go", Root: filepath.Dir(path)})
	if err == nil || status.Running || !status.Installed || status.Error == "" {
		t.Fatal(status, err)
	}
}
