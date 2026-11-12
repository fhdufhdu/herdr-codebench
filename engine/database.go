package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type dbSource struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Driver          string  `json:"driver"`
	Host            string  `json:"host,omitempty"`
	Port            int     `json:"port,omitempty"`
	User            string  `json:"user,omitempty"`
	Password        *string `json:"password,omitempty"`
	Database        string  `json:"database,omitempty"`
	Path            string  `json:"path,omitempty"`
	TLS             string  `json:"tls,omitempty"`
	HasPassword     bool    `json:"has_password"`
	PasswordStorage string  `json:"password_storage"`
	revision        uint64
}
type dbObject struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Database   string `json:"database,omitempty"`
	Schema     string `json:"schema,omitempty"`
	Table      string `json:"table,omitempty"`
	DataType   string `json:"data_type,omitempty"`
	PrimaryKey bool   `json:"primary_key,omitempty"`
}
type dbChange struct {
	Op       string         `json:"op"`
	Original map[string]any `json:"original"`
	Values   map[string]any `json:"values"`
}
type dbRequest struct {
	Source     *dbSource  `json:"source"`
	SourceID   string     `json:"source_id"`
	Database   string     `json:"database"`
	Schema     string     `json:"schema"`
	Table      string     `json:"table"`
	Limit      int        `json:"limit"`
	Offset     int        `json:"offset"`
	Statements []string   `json:"statements"`
	JobID      string     `json:"job_id"`
	Objects    []dbObject `json:"objects"`
	Changes    []dbChange `json:"changes"`
}
type dbColumn struct {
	Name     string `json:"name"`
	DataType string `json:"data_type,omitempty"`
}
type dbResult struct {
	Columns      []dbColumn `json:"columns"`
	Rows         [][]any    `json:"rows"`
	AffectedRows *int64     `json:"affected_rows,omitempty"`
	Truncated    bool       `json:"truncated,omitempty"`
	Statement    string     `json:"statement,omitempty"`
	ElapsedMS    int64      `json:"elapsed_ms,omitempty"`
}
type dbPage struct {
	dbResult
	PrimaryKeys []string `json:"primary_keys"`
	Offset      int      `json:"offset"`
	Limit       int      `json:"limit"`
}
type dbJob struct {
	ID        string     `json:"id"`
	State     string     `json:"state"`
	Current   int        `json:"current"`
	Total     int        `json:"total"`
	ElapsedMS int64      `json:"elapsed_ms"`
	Results   []dbResult `json:"results"`
	Error     string     `json:"error,omitempty"`
	started   time.Time
	finished  time.Time
	cancel    context.CancelFunc
}
type databaseManager struct {
	mu            sync.Mutex
	path          string
	sources       map[string]dbSource
	passwords     map[string]string
	passwordStore databasePasswordStore
	revisions     map[string]uint64
	nextRevision  uint64
	pools         map[string]*sql.DB
	jobs          map[string]*dbJob
	ctx           context.Context
	cancel        context.CancelFunc
	slots         chan struct{}
	wg            sync.WaitGroup
	closed        bool
}

func databaseRoute(route string) bool {
	switch route {
	case "db_sources", "db_save", "db_delete", "db_test", "db_catalog", "db_rows", "db_ddl", "db_query", "db_job", "db_cancel", "db_apply":
		return true
	}
	return false
}

var mysqlDatabaseDSN func(dbSource, string, string, string, int) (string, string, error)

func newDatabaseManager(cache string) (*databaseManager, error) {
	return newDatabaseManagerWithStore(cache, newDatabasePasswordStore())
}
func newDatabaseManagerWithStore(cache string, store databasePasswordStore) (*databaseManager, error) {
	ctx, cancel := context.WithCancel(context.Background())
	m := &databaseManager{path: filepath.Join(cache, "database-sources.json"), passwordStore: store, revisions: map[string]uint64{}, sources: map[string]dbSource{}, passwords: map[string]string{}, pools: map[string]*sql.DB{}, jobs: map[string]*dbJob{}, ctx: ctx, cancel: cancel, slots: make(chan struct{}, 4)}
	b, err := os.ReadFile(m.path)
	if err == nil {
		var sources []dbSource
		if err = json.Unmarshal(b, &sources); err != nil {
			cancel()
			return nil, fmt.Errorf("database profile metadata: %w", err)
		}
		for _, s := range sources {
			s.Password = nil
			s.HasPassword = store != nil && s.HasPassword && s.PasswordStorage == "keychain"
			if !s.HasPassword {
				s.PasswordStorage = "none"
			}
			m.sources[s.ID] = s
		}
	} else if !os.IsNotExist(err) {
		cancel()
		return nil, err
	}
	return m, nil
}
func dbID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func (m *databaseManager) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	m.cancel()
	pools := m.pools
	m.pools = map[string]*sql.DB{}
	m.mu.Unlock()
	m.wg.Wait()
	for _, p := range pools {
		_ = p.Close()
	}
}
func validDBSource(s dbSource) error {
	switch s.Driver {
	case "mysql", "mariadb", "postgres", "sqlserver", "sqlite":
	default:
		return errors.New("unsupported database driver")
	}
	if s.Port < 0 || s.Port > 65535 {
		return errors.New("port must be between 0 and 65535")
	}
	if s.Driver == "sqlite" {
		if s.Path == "" {
			return errors.New("SQLite path is required")
		}
		if !filepath.IsAbs(s.Path) {
			return errors.New("SQLite path must be absolute")
		}
		if strings.ContainsAny(s.Path, "?\x00") || strings.HasPrefix(s.Path, "file:") {
			return errors.New("use a plain SQLite path, not a URI")
		}
	}
	if s.Name == "" {
		return errors.New("connection name is required")
	}
	switch s.TLS {
	case "", "disable", "require", "verify-full":
	default:
		return errors.New("TLS must be disable, require or verify-full")
	}
	return nil
}
func (m *databaseManager) publicLocked(s dbSource) dbSource {
	s.Password = nil
	s.HasPassword = s.HasPassword && s.PasswordStorage == "keychain" && m.passwordStore != nil
	if !s.HasPassword {
		s.PasswordStorage = "none"
	}
	if m.passwords[s.ID] != "" {
		s.HasPassword = true
		s.PasswordStorage = "session"
	}
	return s
}
func (m *databaseManager) persistLocked() error {
	a := []dbSource{}
	for _, s := range m.sources {
		s.Password = nil
		s.HasPassword = s.HasPassword && s.PasswordStorage == "keychain"
		if !s.HasPassword {
			s.PasswordStorage = "none"
		}
		a = append(a, s)
	}
	sort.Slice(a, func(i, j int) bool { return a[i].ID < a[j].ID })
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(a)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(m.path), ".database-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err = f.Chmod(0600); err != nil {
		return err
	}
	if _, err = f.Write(b); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), m.path)
}
func (m *databaseManager) invalidateLocked(id string) {
	for k, p := range m.pools {
		if strings.HasPrefix(k, id+"\x00") {
			delete(m.pools, k)
			m.wg.Add(1)
			go func() { defer m.wg.Done(); _ = p.Close() }()
		}
	}
}
func (m *databaseManager) source(id string) (dbSource, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sources[id]
	if !ok {
		return s, errors.New("database source not found")
	}
	pw := m.passwords[id]
	if s.HasPassword && s.PasswordStorage == "keychain" {
		if m.passwordStore == nil {
			return s, errors.New("database password requires macOS Keychain; enter it again on this platform")
		}
		var err error
		pw, err = m.passwordStore.Get(m.ctx, id)
		if err != nil {
			return s, err
		}
	}
	s.revision = m.revisions[id]
	s.Password = &pw
	return s, nil
}
func (m *databaseManager) handle(ctx context.Context, route string, raw json.RawMessage) (any, error) {
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return nil, errors.New("database manager closed")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(m.ctx, cancel)
	defer stop()
	defer cancel()
	var r dbRequest
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := d.Decode(&r); err != nil {
		return nil, errors.New("database request object is required")
	}
	switch route {
	case "db_sources":
		m.mu.Lock()
		defer m.mu.Unlock()
		a := []dbSource{}
		for _, s := range m.sources {
			a = append(a, m.publicLocked(s))
		}
		sort.Slice(a, func(i, j int) bool { return a[i].Name < a[j].Name })
		return map[string]any{"sources": a}, nil
	case "db_save":
		if r.Source == nil {
			return nil, errors.New("source is required")
		}
		s := *r.Source
		if err := validDBSource(s); err != nil {
			return nil, err
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.closed {
			return nil, errors.New("database manager closed")
		}
		if s.ID == "" {
			s.ID = dbID()
		}
		old, exists := m.sources[s.ID]
		pw := s.Password
		s.Password = nil
		s.HasPassword, s.PasswordStorage = old.HasPassword, old.PasswordStorage
		if err := m.changePasswordLocked(ctx, old, &s, pw, func() error {
			m.sources[s.ID] = s
			return m.persistLocked()
		}); err != nil {
			if exists {
				m.sources[s.ID] = old
			} else {
				delete(m.sources, s.ID)
			}
			return nil, err
		}
		if pw != nil {
			delete(m.passwords, s.ID)
			if m.passwordStore == nil && *pw != "" {
				m.passwords[s.ID] = *pw
			}
		}
		if s.PasswordStorage == "keychain" {
			delete(m.passwords, s.ID)
		}
		m.nextRevision++
		m.revisions[s.ID] = m.nextRevision
		m.invalidateLocked(s.ID)
		return m.publicLocked(s), nil
	case "db_delete":
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.closed {
			return nil, errors.New("database manager closed")
		}
		old, exists := m.sources[r.SourceID]
		if !exists {
			return nil, errors.New("database source not found")
		}
		empty := ""
		next := old
		if err := m.changePasswordLocked(ctx, old, &next, &empty, func() error {
			delete(m.sources, r.SourceID)
			return m.persistLocked()
		}); err != nil {
			m.sources[r.SourceID] = old
			return nil, err
		}
		delete(m.passwords, r.SourceID)
		delete(m.revisions, r.SourceID)
		m.invalidateLocked(r.SourceID)
		return map[string]bool{"deleted": true}, nil
	case "db_test":
		var s dbSource
		var err error
		if r.Source != nil {
			s = *r.Source
			if err = validDBSource(s); err != nil {
				return nil, err
			}
			if s.Password == nil && s.ID != "" {
				old, e := m.source(s.ID)
				if e != nil {
					return nil, e
				}
				s.Password = old.Password
			}
		} else {
			s, err = m.source(r.SourceID)
		}
		if err != nil {
			return nil, err
		}
		p, err := openDatabase(s, r.Database)
		if err != nil {
			return nil, errors.New("invalid connection configuration")
		}
		defer p.Close()
		c, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err = p.PingContext(c); err != nil {
			return nil, dbSafeError(err, s)
		}
		return map[string]any{"connected": true, "driver": s.Driver}, nil
	case "db_job", "db_cancel":
		return m.job(r.JobID, route == "db_cancel")
	case "db_query":
		return m.startJob(r)
	}
	s, err := m.source(r.SourceID)
	if err != nil {
		return nil, err
	}
	p, err := m.pool(s, r.Database)
	if err != nil {
		return nil, dbSafeError(err, s)
	}
	var result any
	switch route {
	case "db_catalog":
		result, err = dbCatalog(ctx, p, s, r)
	case "db_rows":
		result, err = dbRows(ctx, p, s, r)
	case "db_apply":
		result, err = dbApply(ctx, p, s, r)
	case "db_ddl":
		result, err = m.ddl(ctx, s, r)
	default:
		return nil, errors.New("unknown database endpoint")
	}
	if err != nil {
		return nil, dbSafeError(err, s)
	}
	return result, nil
}
func dbSafeError(err error, s dbSource) error {
	msg := err.Error()
	if s.Password != nil && *s.Password != "" {
		pw := *s.Password
		for _, secret := range []string{url.QueryEscape(pw), url.PathEscape(pw), strings.TrimPrefix(url.UserPassword("", pw).String(), ":"), pw} {
			msg = strings.ReplaceAll(msg, secret, "[redacted]")
		}
	}
	return errors.New(msg)
}
func openDatabase(s dbSource, database string) (*sql.DB, error) {
	if s.Driver != "sqlite" && s.User == "" {
		return nil, errors.New("database username is required")
	}
	if database == "" {
		database = s.Database
	}
	pw := ""
	if s.Password != nil {
		pw = *s.Password
	}
	driver, dsn, err := databaseDSN(s, database, pw)
	if err != nil {
		return nil, err
	}
	p, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	p.SetMaxOpenConns(4)
	p.SetMaxIdleConns(2)
	p.SetConnMaxLifetime(10 * time.Minute)
	if s.Driver == "sqlite" {
		p.SetMaxOpenConns(1)
	}
	return p, nil
}
func databaseDSN(s dbSource, database, pw string) (string, string, error) {
	if s.Driver == "sqlite" {
		if database != "" && database != "main" {
			return "", "", errors.New("SQLite supports only the main database per source")
		}
		u := url.URL{Scheme: "file", Path: s.Path}
		if s.Path == ":memory:" {
			return "sqlite", ":memory:", nil
		}
		q := url.Values{}
		q.Add("_pragma", "busy_timeout(5000)")
		q.Add("_pragma", "foreign_keys(1)")
		u.RawQuery = q.Encode()
		return "sqlite", u.String(), nil
	}
	host := s.Host
	if host == "" {
		host = "localhost"
	}
	port := s.Port
	if port == 0 {
		switch s.Driver {
		case "mysql", "mariadb":
			port = 3306
		case "postgres":
			port = 5432
		case "sqlserver":
			port = 1433
		}
	}
	u := url.URL{Host: net.JoinHostPort(host, strconv.Itoa(port)), User: url.UserPassword(s.User, pw)}
	q := url.Values{}
	switch s.Driver {
	case "mysql", "mariadb":
		if mysqlDatabaseDSN == nil {
			return "", "", errors.New("MySQL driver unavailable")
		}
		return mysqlDatabaseDSN(s, database, pw, host, port)
	case "postgres":
		u.Scheme = "postgres"
		if database == "" {
			database = "postgres"
		}
		u.Path = "/" + database
		tls := s.TLS
		if tls == "" {
			tls = "verify-full"
		}
		q.Set("sslmode", tls)
		q.Set("connect_timeout", "10")
		q.Set("default_query_exec_mode", "simple_protocol")
		// Profiles are self contained: never inherit pgpass, service or client keys.
		q.Set("passfile", os.DevNull)
		for _, key := range []string{"service", "servicefile", "sslkey", "sslcert", "sslrootcert", "sslpassword"} {
			q.Set(key, "")
		}
		u.RawQuery = q.Encode()
		return "pgx", u.String(), nil
	case "sqlserver":
		u.Scheme = "sqlserver"
		q.Set("database", database)
		q.Set("connection timeout", "10")
		q.Set("encrypt", "true")
		if s.TLS == "disable" {
			q.Set("encrypt", "disable")
		}
		if s.TLS == "require" {
			q.Set("TrustServerCertificate", "true")
		}
		u.RawQuery = q.Encode()
		return "sqlserver", u.String(), nil
	}
	return "", "", errors.New("unsupported driver")
}
func (m *databaseManager) pool(s dbSource, database string) (*sql.DB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("database manager closed")
	}
	current, exists := m.sources[s.ID]
	if !exists || current.Driver != s.Driver || current.Host != s.Host || current.Port != s.Port || current.User != s.User || current.Database != s.Database || current.Path != s.Path || current.TLS != s.TLS || (s.Password != nil && s.revision != m.revisions[s.ID]) {
		return nil, errors.New("database profile changed; retry the operation")
	}
	if database == "" {
		database = s.Database
	}
	if s.Driver == "sqlite" && database == "" {
		database = "main"
	}
	key := s.ID + "\x00" + database
	if p := m.pools[key]; p != nil {
		return p, nil
	}
	p, err := openDatabase(s, database)
	if err == nil {
		m.pools[key] = p
	}
	return p, err
}
func dbLimit(n int) int {
	if n <= 0 {
		return 200
	}
	if n > 1000 {
		return 1000
	}
	return n
}
func (m *databaseManager) cleanupLocked() {
	now := time.Now()
	for id, j := range m.jobs {
		if !j.finished.IsZero() && now.Sub(j.finished) > 15*time.Minute {
			delete(m.jobs, id)
		}
	}
	for len(m.jobs) >= 64 {
		var oldest *dbJob
		for _, j := range m.jobs {
			if !j.finished.IsZero() && (oldest == nil || j.finished.Before(oldest.finished)) {
				oldest = j
			}
		}
		if oldest == nil {
			break
		}
		delete(m.jobs, oldest.ID)
	}
}
func (m *databaseManager) startJob(r dbRequest) (any, error) {
	if len(r.Statements) == 0 || len(r.Statements) > 256 {
		return nil, errors.New("provide 1 to 256 statements")
	}
	for _, s := range r.Statements {
		if strings.TrimSpace(s) == "" {
			return nil, errors.New("empty statement")
		}
	}
	s, err := m.source(r.SourceID)
	if err != nil {
		return nil, err
	}
	p, err := m.pool(s, r.Database)
	if err != nil {
		return nil, dbSafeError(err, s)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("database manager closed")
	}
	m.cleanupLocked()
	active := 0
	for _, j := range m.jobs {
		if j.finished.IsZero() {
			active++
		}
	}
	if active >= 32 {
		return nil, errors.New("too many queued database jobs")
	}
	ctx, cancel := context.WithTimeout(m.ctx, 2*time.Minute)
	j := &dbJob{ID: dbID(), State: "queued", Total: len(r.Statements), Results: []dbResult{}, started: time.Now(), cancel: cancel}
	m.jobs[j.ID] = j
	m.wg.Add(1)
	go m.runJob(ctx, j, p, s, r)
	return map[string]string{"job_id": j.ID}, nil
}
func (m *databaseManager) runJob(ctx context.Context, j *dbJob, p *sql.DB, s dbSource, r dbRequest) {
	defer m.wg.Done()
	defer j.cancel()
	var err error
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	case <-ctx.Done():
		err = ctx.Err()
	}
	if err == nil {
		m.mu.Lock()
		j.State = "running"
		m.mu.Unlock()
		var conn *sql.Conn
		conn, err = p.Conn(ctx)
		if err == nil {
			defer conn.Close()
			// A console may change session state or leave an explicit transaction open.
			// Discard its physical connection before it can be reused by other jobs.
			defer conn.Raw(func(any) error { return driver.ErrBadConn })
			err = dbSetSchema(ctx, conn, s, r.Schema)
			size := 0
			for i, statement := range r.Statements {
				if err != nil {
					break
				}
				m.mu.Lock()
				j.Current = i + 1
				m.mu.Unlock()
				var results []dbResult
				results, err = dbExecute(ctx, conn, statement, dbLimit(r.Limit))
				if err == nil {
					b, _ := json.Marshal(results)
					size += len(b)
					if size > 16<<20 {
						err = errors.New("job result exceeds 16 MiB; reduce row limit")
						break
					}
					m.mu.Lock()
					j.Results = append(j.Results, results...)
					m.mu.Unlock()
				}
			}
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j.finished = time.Now()
	j.ElapsedMS = j.finished.Sub(j.started).Milliseconds()
	if ctx.Err() != nil {
		j.State = "cancelled"
		j.Error = ctx.Err().Error()
	} else if err != nil {
		j.State = "error"
		j.Error = dbSafeError(err, s).Error()
	} else {
		j.State = "completed"
	}
}
func (m *databaseManager) job(id string, cancel bool) (any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil {
		return nil, errors.New("database job not found")
	}
	if cancel && j.finished.IsZero() {
		j.cancel()
	}
	snapshot := *j
	snapshot.Results = append([]dbResult{}, j.Results...)
	if j.finished.IsZero() {
		snapshot.ElapsedMS = time.Since(j.started).Milliseconds()
	}
	return snapshot, nil
}
func dbSetSchema(ctx context.Context, c *sql.Conn, s dbSource, schema string) error {
	if schema == "" {
		return nil
	}
	if s.Driver == "postgres" {
		_, err := c.ExecContext(ctx, "SET search_path TO "+dbQuote(s.Driver, schema))
		return err
	}
	if s.Driver == "mysql" || s.Driver == "mariadb" {
		_, err := c.ExecContext(ctx, "USE "+dbQuote(s.Driver, schema))
		return err
	}
	if s.Driver == "sqlite" && schema != "main" {
		return errors.New("unknown SQLite schema")
	}
	if s.Driver == "sqlserver" {
		// SQL Server resolves unqualified names through the login's default schema.
		// There is no connection-local schema setting; scripts can qualify names.
		return nil
	}
	return nil
}
func dbQuote(driver, s string) string {
	if driver == "mysql" || driver == "mariadb" {
		return "`" + strings.ReplaceAll(s, "`", "``") + "`"
	}
	if driver == "sqlserver" {
		return "[" + strings.ReplaceAll(s, "]", "]]") + "]"
	}
	return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
}
func dbTable(s dbSource, r dbRequest) (string, error) {
	if r.Table == "" || strings.ContainsRune(r.Table, 0) {
		return "", errors.New("table is required")
	}
	schema := r.Schema
	if schema == "" {
		switch s.Driver {
		case "postgres":
			schema = "public"
		case "sqlserver":
			schema = "dbo"
		case "sqlite":
			schema = "main"
		}
	}
	if schema != "" {
		return dbQuote(s.Driver, schema) + "." + dbQuote(s.Driver, r.Table), nil
	}
	return dbQuote(s.Driver, r.Table), nil
}
func dbParam(driver string, n int) string {
	if driver == "postgres" {
		return "$" + strconv.Itoa(n)
	}
	if driver == "sqlserver" {
		return "@p" + strconv.Itoa(n)
	}
	return "?"
}
func dbSQLPrefix(s string) string {
	for {
		s = strings.TrimSpace(s)
		if strings.HasPrefix(s, "--") {
			i := strings.IndexByte(s, '\n')
			if i < 0 {
				return ""
			}
			s = s[i+1:]
			continue
		}
		if strings.HasPrefix(s, "/*") {
			i := strings.Index(s, "*/")
			if i < 0 {
				return ""
			}
			s = s[i+2:]
			continue
		}
		return strings.ToUpper(s)
	}
}
func dbExecute(ctx context.Context, c *sql.Conn, statement string, limit int) ([]dbResult, error) {
	start := time.Now()
	r := dbResult{Columns: []dbColumn{}, Rows: [][]any{}, Statement: statement}
	prefix := dbSQLPrefix(statement)
	end := 0
	for end < len(prefix) && ((prefix[end] >= 'A' && prefix[end] <= 'Z') || prefix[end] == '_') {
		end++
	}
	word := prefix[:end]
	returns := false
	if word != "" {
		switch word {
		case "SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA", "VALUES", "TABLE", "CALL", "EXEC", "EXECUTE":
			returns = true
		}
	}
	if strings.Contains(prefix, "RETURNING") || strings.Contains(prefix, "OUTPUT") {
		returns = true
	}
	if returns {
		rows, err := c.QueryContext(ctx, statement)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		results := []dbResult{}
		size := 0
		for {
			r, err = dbReadCurrentRows(rows, limit)
			if err != nil {
				return nil, err
			}
			r.Statement = statement
			r.ElapsedMS = time.Since(start).Milliseconds()
			b, _ := json.Marshal(r)
			size += len(b)
			if size > 16<<20 {
				return nil, errors.New("statement result exceeds 16 MiB; reduce row limit")
			}
			results = append(results, r)
			if !rows.NextResultSet() {
				break
			}
			if len(results) >= 256 {
				return nil, errors.New("statement exceeds 256 result sets")
			}
		}
		return results, rows.Err()
	}
	res, err := c.ExecContext(ctx, statement)
	if err == nil {
		n, e := res.RowsAffected()
		if e == nil {
			r.AffectedRows = &n
		}
	}
	r.ElapsedMS = time.Since(start).Milliseconds()
	return []dbResult{r}, err
}
func dbReadRows(rows *sql.Rows, limit int) (dbResult, error) {
	defer rows.Close()
	return dbReadCurrentRows(rows, limit)
}
func dbReadCurrentRows(rows *sql.Rows, limit int) (dbResult, error) {
	r := dbResult{Columns: []dbColumn{}, Rows: [][]any{}}
	types, err := rows.ColumnTypes()
	if err != nil {
		return r, err
	}
	for _, c := range types {
		r.Columns = append(r.Columns, dbColumn{c.Name(), c.DatabaseTypeName()})
	}
	size := 0
	for rows.Next() {
		if len(r.Rows) >= limit {
			r.Truncated = true
			break
		}
		values := make([]any, len(types))
		ptrs := make([]any, len(types))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err = rows.Scan(ptrs...); err != nil {
			return r, err
		}
		for i, v := range values {
			values[i] = dbJSONValue(v, types[i].DatabaseTypeName())
		}
		b, err := json.Marshal(values)
		if err != nil {
			return r, err
		}
		size += len(b)
		if size > 16<<20 {
			return r, errors.New("result exceeds 16 MiB; reduce row limit")
		}
		r.Rows = append(r.Rows, values)
	}
	return r, rows.Err()
}
func dbJSONValue(v any, typ string) any {
	switch x := v.(type) {
	case int64:
		if x > 9007199254740991 || x < -9007199254740991 {
			return strconv.FormatInt(x, 10)
		}
		return x
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return strconv.FormatFloat(x, 'g', -1, 64)
		}
		return x
	case []byte:
		t := strings.ToUpper(typ)
		if t == "" || strings.Contains(t, "BLOB") || strings.Contains(t, "BINARY") || t == "BYTEA" || t == "IMAGE" || t == "BIT" || t == "VARBIT" || t == "UNIQUEIDENTIFIER" || t == "GEOMETRY" || t == "GEOGRAPHY" || !utf8.Valid(x) {
			return map[string]string{"type": "binary", "base64": base64.StdEncoding.EncodeToString(x)}
		}
		return string(x)
	case time.Time:
		return x.Format(time.RFC3339Nano)
	default:
		return v
	}
}
