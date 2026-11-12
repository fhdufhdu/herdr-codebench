package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// Ordinary engine/HTTP tests must never touch a user's Keychain. Dedicated
// persistence tests inject an isolated fake; live testing uses an explicit store.
func init() { newDatabasePasswordStore = func() databasePasswordStore { return nil } }

type fakeDatabasePasswordStore struct {
	values                       map[string]string
	gets                         int
	failGet, failSet, failDelete bool
	onSet                        func()
}

func (s *fakeDatabasePasswordStore) Get(_ context.Context, id string) (string, error) {
	s.gets++
	if s.failGet {
		return "", errors.New("fake Keychain unavailable")
	}
	pw, ok := s.values[id]
	if !ok {
		return "", errDatabasePasswordNotFound
	}
	return pw, nil
}
func (s *fakeDatabasePasswordStore) Set(_ context.Context, id, pw string) error {
	if s.failSet {
		return errors.New("fake Keychain unavailable")
	}
	s.values[id] = pw
	if s.onSet != nil {
		fn := s.onSet
		s.onSet = nil
		fn()
	}
	return nil
}
func (s *fakeDatabasePasswordStore) Delete(_ context.Context, id string) error {
	if s.failDelete {
		return errors.New("fake Keychain unavailable")
	}
	delete(s.values, id)
	return nil
}
func passwordManager(t *testing.T, dir string, store databasePasswordStore) *databaseManager {
	t.Helper()
	m, err := newDatabaseManagerWithStore(dir, store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}
func passwordRequest(m *databaseManager, route string, req dbRequest) error {
	b, _ := json.Marshal(req)
	_, err := m.handle(context.Background(), route, b)
	return err
}
func TestDatabaseKeychainLifecycle(t *testing.T) {
	dir := t.TempDir()
	store := &fakeDatabasePasswordStore{values: map[string]string{}}
	m := passwordManager(t, dir, store)
	pw := "한글\n\"quote'\\\x00tail\n"
	s := dbCall(t, m, "db_save", dbRequest{Source: &dbSource{Name: "keychain", Driver: "postgres", Password: &pw}}).(dbSource)
	if !s.HasPassword || s.PasswordStorage != "keychain" || s.Password != nil || store.values[s.ID] != pw {
		t.Fatal("incorrect saved status")
	}
	b, err := os.ReadFile(m.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b, []byte("quote")) || bytes.Contains(b, []byte(`"password"`)) {
		t.Fatal("secret leaked into metadata")
	}
	m2 := passwordManager(t, dir, store)
	before := store.gets
	dbCall(t, m2, "db_sources", dbRequest{})
	s.Name = "rename"
	s.HasPassword, s.PasswordStorage = false, "none" // Public markers are never trusted.
	s = dbCall(t, m2, "db_save", dbRequest{Source: &s}).(dbSource)
	if store.gets != before || !s.HasPassword || s.PasswordStorage != "keychain" {
		t.Fatal("list/save read secret or trusted client status")
	}
	loaded, err := m2.source(s.ID)
	if err != nil || loaded.Password == nil || *loaded.Password != pw {
		t.Fatal("restart lost credential", err)
	}
	newPW := "replacement"
	s.Password = &newPW
	s = dbCall(t, m2, "db_save", dbRequest{Source: &s}).(dbSource)
	if store.values[s.ID] != newPW {
		t.Fatal("replace failed")
	}
	if _, err := m2.pool(loaded, ""); err == nil {
		t.Fatal("stale credential revision accepted")
	}
	empty := ""
	s.Password = &empty
	s = dbCall(t, m2, "db_save", dbRequest{Source: &s}).(dbSource)
	if s.HasPassword || s.PasswordStorage != "none" || len(store.values) != 0 {
		t.Fatal("clear failed")
	}
	s.Password = &pw
	s = dbCall(t, m2, "db_save", dbRequest{Source: &s}).(dbSource)
	dbCall(t, m2, "db_delete", dbRequest{SourceID: s.ID})
	if len(store.values) != 0 || len(m2.sources) != 0 {
		t.Fatal("delete failed")
	}
}

func TestDatabaseKeychainFailureConsistency(t *testing.T) {
	store := &fakeDatabasePasswordStore{values: map[string]string{}}
	m := passwordManager(t, t.TempDir(), store)
	pw := "first"
	s := dbCall(t, m, "db_save", dbRequest{Source: &dbSource{Name: "original", Driver: "postgres", Password: &pw}}).(dbSource)
	replacement := "second"
	s.Password, s.Name = &replacement, "changed"
	store.failSet = true
	if passwordRequest(m, "db_save", dbRequest{Source: &s}) == nil {
		t.Fatal("Keychain failure silently ignored")
	}
	if m.sources[s.ID].Name != "original" || store.values[s.ID] != pw || len(m.passwords) != 0 {
		t.Fatal("failed write changed state")
	}
	store.failSet = false
	// A directory cannot be atomically replaced by the metadata file.
	badPath := filepath.Join(t.TempDir(), "directory")
	if err := os.Mkdir(badPath, 0700); err != nil {
		t.Fatal(err)
	}
	m.path = badPath
	if passwordRequest(m, "db_save", dbRequest{Source: &s}) == nil {
		t.Fatal("metadata failure silently ignored")
	}
	if m.sources[s.ID].Name != "original" || store.values[s.ID] != pw {
		t.Fatal("credential rollback failed")
	}
	if passwordRequest(m, "db_delete", dbRequest{SourceID: s.ID}) == nil {
		t.Fatal("metadata delete failure ignored")
	}
	if _, ok := m.sources[s.ID]; !ok || store.values[s.ID] != pw {
		t.Fatal("delete rollback failed")
	}
	store.failGet = true
	if _, err := m.source(s.ID); err == nil {
		t.Fatal("missing credential silently replaced")
	}
	if passwordRequest(m, "db_test", dbRequest{Source: &dbSource{ID: s.ID, Name: "draft", Driver: "postgres"}}) == nil {
		t.Fatal("draft swallowed credential failure")
	}
	store.failGet = false
	store.failSet = true // Restore after delete now fails too.
	if err := passwordRequest(m, "db_delete", dbRequest{SourceID: s.ID}); err == nil || !strings.Contains(err.Error(), "rollback failed") {
		t.Fatal("compensation failure hidden", err)
	}
}

func TestDatabaseSessionPasswordAndExplicitPromotion(t *testing.T) {
	m := passwordManager(t, t.TempDir(), nil)
	pw := "session"
	s := dbCall(t, m, "db_save", dbRequest{Source: &dbSource{Name: "session", Driver: "postgres", Password: &pw, HasPassword: true, PasswordStorage: "keychain"}}).(dbSource)
	if s.PasswordStorage != "session" || !s.HasPassword {
		t.Fatal("incorrect session status")
	}
	store := &fakeDatabasePasswordStore{values: map[string]string{}}
	m.passwordStore = store
	s = dbCall(t, m, "db_save", dbRequest{Source: &s}).(dbSource)
	if s.PasswordStorage != "keychain" || store.values[s.ID] != pw || len(m.passwords) != 0 {
		t.Fatal("explicit save did not promote session")
	}
	otherOS := passwordManager(t, filepath.Dir(m.path), nil)
	if otherOS.publicLocked(otherOS.sources[s.ID]).HasPassword {
		t.Fatal("other OS claimed available credential")
	}
}

func TestDatabasePasswordCommandEncoding(t *testing.T) {
	pw := "한글\n\"'\\\x00\nquit\n"
	command, err := databasePasswordCommand(strings.Repeat("a", 32), pw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(command, "\n") != 1 || strings.Contains(command, pw) {
		t.Fatal("unsafe command framing")
	}
	payload := strings.TrimSuffix(strings.Split(command, " -w ")[1], "\n")
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(payload, databasePasswordPrefix))
	if err != nil || string(b) != pw {
		t.Fatal("password changed")
	}
	if _, err := databasePasswordCommand("bad\naccount", pw); err == nil {
		t.Fatal("unsafe account accepted")
	}
	if _, err := databasePasswordCommand(strings.Repeat("a", 32), strings.Repeat("a", 4096)); err == nil {
		t.Fatal("oversized command accepted")
	}
}

func TestDatabasePasswordCancellationAndConcurrentSave(t *testing.T) {
	store := &fakeDatabasePasswordStore{values: map[string]string{}}
	m := passwordManager(t, t.TempDir(), store)
	pw := "first"
	s := dbCall(t, m, "db_save", dbRequest{Source: &dbSource{Name: "original", Driver: "postgres", Password: &pw}}).(dbSource)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store.onSet = cancel
	next := s
	changed := "second"
	next.Password = &changed
	b, _ := json.Marshal(dbRequest{Source: &next})
	if _, err := m.handle(ctx, "db_save", b); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled write not reported", err)
	}
	if store.values[s.ID] != pw || m.sources[s.ID].Name != s.Name {
		t.Fatal("cancelled save did not restore credential")
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := passwordRequest(m, "db_save", dbRequest{Source: &s}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if store.values[s.ID] != pw || m.revisions[s.ID] != 13 {
		t.Fatal("concurrent saves lost state")
	}
	delete(store.values, s.ID) // External deletion: explicit save repairs this profile only.
	next.Password = &changed
	dbCall(t, m, "db_save", dbRequest{Source: &next})
	if store.values[s.ID] != changed {
		t.Fatal("missing credential could not be repaired")
	}
}

// Explicit opt-in only. This test never enumerates or reads existing accounts.
func TestDatabaseKeychainLiveOwnItem(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("HERDR_DB_KEYCHAIN_LIVE_TEST") != "1" {
		t.Skip("opt-in macOS own-item Keychain integration test")
	}
	store := securityDatabasePasswordStore{}
	id := dbID()
	ctx := context.Background()
	t.Cleanup(func() {
		if err := store.Delete(ctx, id); err != nil {
			t.Error("disposable item cleanup failed:", err)
		}
	})
	pw := "disposable fixture 한글\n\"quote'\\\x00tail\n"
	if err := store.Set(ctx, id, pw); err != nil {
		t.Fatal("own-item set:", err)
	}
	got, err := store.Get(ctx, id)
	if err != nil || got != pw {
		t.Fatal("own-item complex credential roundtrip failed:", err)
	}
	if err := store.Set(ctx, id, "replacement fixture"); err != nil {
		t.Fatal("own-item replacement:", err)
	}
	got, err = store.Get(ctx, id)
	if err != nil || got != "replacement fixture" {
		t.Fatal("own-item replacement roundtrip failed:", err)
	}
	// A malformed add command must not look successful in interactive mode.
	_, err = databaseSecurityRun(ctx, "add-generic-password -Z -s "+databasePasswordService+" -a "+id+"\n", "-i", "-q")
	if err == nil {
		t.Fatal("interactive security command failure returned success")
	}
	if err := store.Delete(ctx, id); err != nil {
		t.Fatal("own-item delete:", err)
	}
	if _, err := store.Get(ctx, id); !errors.Is(err, errDatabasePasswordNotFound) {
		t.Fatal("own-item missing status incorrect:", err)
	}
	t.Log("own-item set/get/replace/delete and interactive failure status passed; fixture removed")
}
