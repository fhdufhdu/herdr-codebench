package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func dbCall(t *testing.T, m *databaseManager, route string, r any) any {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	v, err := m.handle(context.Background(), route, b)
	if err != nil {
		t.Fatalf("%s: %v", route, err)
	}
	return v
}
func dbFixture(t *testing.T) (*databaseManager, dbSource, *sql.DB) {
	t.Helper()
	registered := false
	for _, d := range sql.Drivers() {
		if d == "sqlite" {
			registered = true
		}
	}
	if !registered {
		t.Skip("SQLite driver not linked in dependency-free source-list test")
	}
	dir := t.TempDir()
	m, err := newDatabaseManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	s := dbCall(t, m, "db_save", dbRequest{Source: &dbSource{Name: "fixture", Driver: "sqlite", Path: filepath.Join(dir, "fixture.sqlite")}}).(dbSource)
	p, err := m.pool(s, "")
	if err != nil {
		t.Fatal(err)
	}
	return m, s, p
}
func waitDBJob(t *testing.T, m *databaseManager, id string) dbJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		v, err := m.job(id, false)
		if err != nil {
			t.Fatal(err)
		}
		j := v.(dbJob)
		if j.State == "completed" || j.State == "error" || j.State == "cancelled" {
			return j
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("database job did not finish")
	return dbJob{}
}
func TestDatabaseProfilePrivacyAndHTTP(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "servers-base.json")
	if err := os.WriteFile(config, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	e, err := NewEngine(config, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	pw := "fixture-secret-not-real"
	s := dbCall(t, e.database, "db_save", dbRequest{Source: &dbSource{Name: "example", Driver: "postgres", Password: &pw}}).(dbSource)
	if s.Password != nil || !s.HasPassword {
		t.Fatal("password public metadata incorrect")
	}
	b, err := os.ReadFile(e.database.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b, []byte(pw)) || bytes.Contains(b, []byte(`"password"`)) {
		t.Fatal("password persisted")
	}
	info, err := os.Stat(e.database.path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("metadata mode: %v %v", info, err)
	}
	s.Name = "renamed"
	s2 := dbCall(t, e.database, "db_save", dbRequest{Source: &s}).(dbSource)
	if !s2.HasPassword {
		t.Fatal("omitted password lost session secret")
	}
	handler := e.Handler("fixture-token")
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {"fixture-token", 200}} {
		req := httptest.NewRequest("POST", "http://127.0.0.1/db_sources", strings.NewReader(`{"database":{}}`))
		req.Header.Set("X-Codenav-Token", tc.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("HTTP: %d %s", w.Code, w.Body.String())
		}
		if bytes.Contains(w.Body.Bytes(), []byte(pw)) {
			t.Fatal("password leaked in HTTP")
		}
	}
	if len(e.servers) != 0 {
		t.Fatal("database request started LSP")
	}
	reopened, err := newDatabaseManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.sources[s.ID].Password != nil || len(reopened.passwords) != 0 {
		t.Fatal("password survived restart")
	}
	dbCall(t, e.database, "db_delete", dbRequest{SourceID: s.ID})
	if len(e.database.sources) != 0 {
		t.Fatal("delete failed")
	}
}
func TestDatabaseCellValues(t *testing.T) {
	if dbJSONValue(nil, "TEXT") != nil {
		t.Fatal("NULL lost")
	}
	if dbJSONValue(int64(9007199254740993), "BIGINT") != "9007199254740993" {
		t.Fatal("integer precision lost")
	}
	if dbJSONValue([]byte("1234567890.123456789012345"), "DECIMAL") != "1234567890.123456789012345" {
		t.Fatal("decimal precision lost")
	}
	if got := dbJSONValue([]byte("AB"), "").(map[string]string); got["type"] != "binary" || got["base64"] != "QUI=" {
		t.Fatal("typeless binary expression was treated as text", got)
	}
	v := dbJSONValue([]byte{0, 255}, "BLOB")
	b, _ := json.Marshal(v)
	var decoded any
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatal(err)
	}
	bound, err := dbBoundValue(decoded)
	if err != nil || !bytes.Equal(bound.([]byte), []byte{0, 255}) {
		t.Fatal("binary round trip", bound, err)
	}
	if dbQuote("postgres", `a"; DROP TABLE x--`) != `"a""; DROP TABLE x--"` {
		t.Fatal("identifier quoting")
	}
}
func TestDatabaseSQLiteLifecycle(t *testing.T) {
	m, s, p := dbFixture(t)
	dbCall(t, m, "db_test", dbRequest{SourceID: s.ID})
	for _, q := range []string{`CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT, precise TEXT, data BLOB, twice INT GENERATED ALWAYS AS (id*2) STORED)`, `CREATE TABLE other_items(id INTEGER PRIMARY KEY)`, `CREATE INDEX items_value ON items(value)`, `CREATE VIEW item_view AS SELECT id,value FROM items`, `INSERT INTO items(id,value,precise,data) VALUES(1,'before','9007199254740993',x'00ff'),(2,NULL,NULL,NULL)`} {
		if _, err := p.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range []dbRequest{{SourceID: s.ID}, {SourceID: s.ID, Database: "main"}, {SourceID: s.ID, Database: "main", Table: "items"}} {
		v := dbCall(t, m, "db_catalog", r).(map[string]any)
		if len(v["nodes"].([]dbObject)) == 0 {
			t.Fatal("empty catalog")
		}
	}
	r := dbCall(t, m, "db_rows", dbRequest{SourceID: s.ID, Database: "main", Table: "items", Limit: 1}).(dbPage)
	if len(r.Rows) != 1 || !r.Truncated || len(r.PrimaryKeys) != 1 {
		t.Fatalf("rows: %+v", r)
	}
	ddl := dbCall(t, m, "db_ddl", dbRequest{SourceID: s.ID, Objects: []dbObject{{Kind: "table", Name: "items", Database: "main"}, {Kind: "database", Name: "main"}, {Kind: "view", Name: "item_view", Database: "main"}}}).(map[string]any)["sql"].(string)
	if strings.Count(ddl, "CREATE TABLE items") != 1 || !strings.Contains(ddl, "CREATE INDEX") || !strings.Contains(ddl, "CREATE VIEW") {
		t.Fatal("DDL hierarchy or dedup:", ddl)
	}
	columnDDL := dbCall(t, m, "db_ddl", dbRequest{SourceID: s.ID, Objects: []dbObject{{Kind: "column", Name: "id", Table: "items", Database: "main"}, {Kind: "column", Name: "id", Table: "other_items", Database: "main"}, {Kind: "table", Name: "items", Database: "main"}}}).(map[string]any)["sql"].(string)
	if strings.Count(columnDDL, "CREATE TABLE items") != 1 || strings.Count(columnDDL, "CREATE TABLE other_items") != 1 {
		t.Fatal("same-name columns lost owning table or duplicated DDL:", columnDDL)
	}
	original := map[string]any{"id": 1, "value": "before", "precise": "9007199254740993", "data": map[string]any{"type": "binary", "base64": "AP8="}}
	dbCall(t, m, "db_apply", dbRequest{SourceID: s.ID, Table: "items", Changes: []dbChange{{Op: "update", Original: original, Values: map[string]any{"value": "after"}}, {Op: "insert", Values: map[string]any{"id": 3, "value": "inserted"}}}})
	b, _ := json.Marshal(dbRequest{SourceID: s.ID, Table: "items", Changes: []dbChange{{Op: "insert", Values: map[string]any{"id": 4}}, {Op: "update", Original: original, Values: map[string]any{"value": "conflict"}}}})
	if _, err := m.handle(context.Background(), "db_apply", b); err == nil {
		t.Fatal("stale update succeeded")
	}
	var n int
	if err := p.QueryRow("SELECT count(*) FROM items WHERE id=4").Scan(&n); err != nil || n != 0 {
		t.Fatal("transaction did not roll back", err, n)
	}
	dbCall(t, m, "db_apply", dbRequest{SourceID: s.ID, Table: "items", Changes: []dbChange{{Op: "delete", Original: map[string]any{"id": 3, "value": "inserted", "precise": nil, "data": nil}}}})
	if err := p.QueryRow("SELECT count(*) FROM items WHERE id=3").Scan(&n); err != nil || n != 0 {
		t.Fatal("delete failed", n, err)
	}
	if _, err := p.Exec("CREATE TABLE no_key(v TEXT)"); err != nil {
		t.Fatal(err)
	}
	dbCall(t, m, "db_apply", dbRequest{SourceID: s.ID, Table: "no_key", Changes: []dbChange{{Op: "insert", Values: map[string]any{"v": "imported"}}}})
	b, _ = json.Marshal(dbRequest{SourceID: s.ID, Table: "no_key", Changes: []dbChange{{Op: "update", Original: map[string]any{"v": "imported"}, Values: map[string]any{"v": "blocked"}}}})
	if _, err := m.handle(context.Background(), "db_apply", b); err == nil {
		t.Fatal("PK-less mutation succeeded")
	}
	job := dbCall(t, m, "db_query", dbRequest{SourceID: s.ID, Statements: []string{"SELECT 9007199254740993 AS big,NULL AS missing,x'4142' AS raw", "SELECT * FROM items", "bad SQL", "DROP TABLE items"}, Limit: 1}).(map[string]string)
	j := waitDBJob(t, m, job["job_id"])
	if j.State != "error" || j.Current != 3 || len(j.Results) != 2 || j.Results[0].Rows[0][0] != "9007199254740993" || j.Results[0].Rows[0][1] != nil || !j.Results[1].Truncated {
		t.Fatalf("job: %+v", j)
	}
	if j.Results[0].Rows[0][2].(map[string]string)["base64"] != "QUI=" {
		t.Fatal("binary expression lost type", j.Results[0].Rows[0][2])
	}
	job = dbCall(t, m, "db_query", dbRequest{SourceID: s.ID, Statements: []string{`WITH RECURSIVE counter(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM counter WHERE x<1000000000) SELECT sum(x) FROM counter`}}).(map[string]string)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		v, _ := m.job(job["job_id"], false)
		if v.(dbJob).Current == 1 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	dbCall(t, m, "db_cancel", dbRequest{JobID: job["job_id"]})
	if j = waitDBJob(t, m, job["job_id"]); j.State != "cancelled" {
		t.Fatalf("cancel: %+v", j)
	}
	job = dbCall(t, m, "db_query", dbRequest{SourceID: s.ID, Statements: []string{`WITH RECURSIVE counter(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM counter WHERE x<1000000000) SELECT sum(x) FROM counter`}}).(map[string]string)
	m.Close()
	if j = waitDBJob(t, m, job["job_id"]); j.State != "cancelled" {
		t.Fatalf("shutdown did not cancel: %+v", j)
	}
}

func TestDatabaseSQLiteCancellationRace(t *testing.T) {
	m, s, _ := dbFixture(t)
	for attempt := 0; attempt < 20; attempt++ {
		job := dbCall(t, m, "db_query", dbRequest{SourceID: s.ID, Statements: []string{`WITH RECURSIVE counter(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM counter WHERE x<1000000000) SELECT sum(x) FROM counter`}}).(map[string]string)
		deadline := time.Now().Add(time.Second)
		for {
			v, err := m.job(job["job_id"], false)
			if err != nil {
				t.Fatal(err)
			}
			if v.(dbJob).Current == 1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("query did not begin")
			}
			runtime.Gosched()
		}
		dbCall(t, m, "db_cancel", dbRequest{JobID: job["job_id"]})
		if j := waitDBJob(t, m, job["job_id"]); j.State != "cancelled" {
			t.Fatalf("attempt %d: %+v", attempt, j)
		}
	}
}
