package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestSourceImplementationsQualifiedInheritanceAndMembers(t *testing.T) {
	root := spFixture(t, map[string]string{
		"api/Api.kt":   "package api\ninterface Api {\n fun run(value: String): String\n}\n",
		"a/One.kt":     "package a\nimport api.Api\nopen class One : Api {\n override fun run(value: String): String = value\n}\nclass Child : One()\n",
		"b/Two.java":   "package b;\nimport api.Api;\nclass Two implements Api {\n public String run(String value) { return value; }\n}\n",
		"other/Api.kt": "package other\ninterface Api\nclass Unrelated : Api\n",
		"use/Use.kt":   "package use\nimport api.Api\nclass Use(val api: Api)\n",
	})
	request := Request{Root: root, Path: filepath.Join(root, "api/Api.kt"), Line: 1, Col: 10}
	locations, err := sourceImplementations(context.Background(), request)
	if err != nil || len(locations) != 3 {
		t.Fatalf("inheritance: %+v %v", locations, err)
	}
	for _, location := range locations {
		if strings.Contains(location.Path, "other") || !strings.Contains(location.Detail, "후보") {
			t.Fatalf("unqualified/falsely semantic result: %+v", location)
		}
	}
	request.Line, request.Col = 2, 6
	locations, err = sourceImplementations(context.Background(), request)
	if err != nil || len(locations) != 2 {
		t.Fatalf("members: %+v %v", locations, err)
	}
	for _, location := range locations {
		if location.Name != "run" {
			t.Fatalf("member: %+v", location)
		}
	}
	request.Path, request.Line, request.Col = filepath.Join(root, "use/Use.kt"), 2, 19
	locations, err = sourceImplementations(context.Background(), request)
	if err != nil || len(locations) != 3 {
		t.Fatalf("imported type: %+v %v", locations, err)
	}
	request.Path, request.Line, request.Col = filepath.Join(root, "api/Api.kt"), 1, 10
	request.Text = textValue("package api\ninterface Renamed\n")
	locations, err = sourceImplementations(context.Background(), request)
	if err != nil || len(locations) != 0 {
		t.Fatalf("unsaved source ignored: %+v %v", locations, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = sourceImplementations(ctx, request); err == nil {
		t.Fatal("cancelled query continued")
	}
}

func TestSourceImplementationsRejectOverloadGuess(t *testing.T) {
	root := spFixture(t, map[string]string{
		"Api.kt":  "interface Api {\n fun run(value: String): String\n fun run(value: Int): String\n}\n",
		"Impl.kt": "class Impl : Api {\n override fun run(value: String): String = value\n}\n",
	})
	got, err := sourceImplementations(context.Background(), Request{Root: root, Path: filepath.Join(root, "Api.kt"), Line: 1, Col: 6})
	if err != nil || len(got) != 0 {
		t.Fatalf("overload guessed: %+v %v", got, err)
	}
}

func TestImplementationDispatchFallbackPreservesBufferSnapshot(t *testing.T) {
	e, _ := fixtureEngine(t)
	config := e.config["go"]
	config.Extensions = []string{"kt"}
	config.Markers = []string{"pom.xml"}
	e.config["kotlin"] = config
	root := spFixture(t, map[string]string{"Api.kt": "interface Api\n", "Impl.kt": "class Impl : Api\n"})
	path := filepath.Join(root, "Api.kt")
	request := Request{Root: root, Path: path, DocumentOwner: "owned-fallback", Revision: revision(1), Text: textValue("interface Api\n"), Line: 0, Col: 10, Kind: "implementation"}
	if _, err := e.dispatch(context.Background(), "document_sync", request); err != nil {
		t.Fatal(err)
	}
	result, err := e.dispatch(context.Background(), "definition", request)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var decoded struct {
		Value    []Location `json:"value"`
		Revision int64      `json:"revision"`
	}
	if err = json.Unmarshal(raw, &decoded); err != nil || len(decoded.Value) != 1 || decoded.Revision != 1 || decoded.Value[0].Name != "Impl" {
		t.Fatalf("fallback envelope: %s %v", raw, err)
	}
	if e.documents[path].text != *request.Text || e.documents[path].owner != request.DocumentOwner {
		t.Fatal("fallback changed source ownership")
	}
}
