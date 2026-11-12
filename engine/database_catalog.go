package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type dbField struct {
	Name, Type, Default     string
	PK, Generated, Nullable bool
}

func dbStrings(ctx context.Context, p *sql.DB, q string, args ...any) ([][]string, error) {
	rows, err := p.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := [][]string{}
	for rows.Next() {
		if len(out) >= 5000 {
			return nil, errors.New("catalog exceeds 5000 objects; narrow the selection")
		}
		v := make([]any, len(cols))
		dest := make([]any, len(cols))
		for i := range v {
			dest[i] = &v[i]
		}
		if err = rows.Scan(dest...); err != nil {
			return nil, err
		}
		a := make([]string, len(v))
		for i, x := range v {
			switch y := x.(type) {
			case nil:
			case []byte:
				a[i] = string(y)
			default:
				a[i] = fmt.Sprint(y)
			}
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func dbSchema(s dbSource, r dbRequest) string {
	if r.Schema != "" {
		return r.Schema
	}
	switch s.Driver {
	case "postgres":
		return "public"
	case "sqlserver":
		return "dbo"
	case "sqlite":
		return "main"
	}
	if r.Database != "" {
		return r.Database
	}
	return s.Database
}
func dbFields(ctx context.Context, p *sql.DB, s dbSource, r dbRequest) ([]dbField, error) {
	schema := dbSchema(s, r)
	var a [][]string
	var err error
	if s.Driver == "sqlite" {
		if schema != "main" {
			return nil, errors.New("unknown SQLite schema")
		}
		a, err = dbStrings(ctx, p, "PRAGMA main.table_xinfo("+dbQuote(s.Driver, r.Table)+")")
		if err != nil {
			return nil, err
		}
		out := []dbField{}
		for _, v := range a {
			out = append(out, dbField{Name: v[1], Type: v[2], Nullable: v[3] == "0", Default: v[4], PK: v[5] != "0", Generated: len(v) > 6 && v[6] != "0"})
		}
		if len(out) == 0 {
			return nil, errors.New("table not found")
		}
		return out, nil
	}
	ph1, ph2 := dbParam(s.Driver, 1), dbParam(s.Driver, 2)
	q := "SELECT c.column_name,c.data_type,c.is_nullable,COALESCE(c.column_default,''),CASE WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON t.constraint_name=k.constraint_name AND t.table_schema=k.table_schema AND t.table_name=k.table_name WHERE t.constraint_type='PRIMARY KEY' AND t.table_schema=c.table_schema AND t.table_name=c.table_name AND k.column_name=c.column_name) THEN 1 ELSE 0 END FROM information_schema.columns c WHERE c.table_schema=" + ph1 + " AND c.table_name=" + ph2 + " ORDER BY c.ordinal_position"
	a, err = dbStrings(ctx, p, q, schema, r.Table)
	if err != nil {
		return nil, err
	}
	out := []dbField{}
	for _, v := range a {
		out = append(out, dbField{Name: v[0], Type: v[1], Nullable: v[2] == "YES", Default: v[3], PK: v[4] == "1"})
	}
	if len(out) == 0 {
		return nil, errors.New("table not found")
	}
	return out, nil
}
func dbCatalog(ctx context.Context, p *sql.DB, s dbSource, r dbRequest) (any, error) {
	nodes := []dbObject{}
	if r.Table != "" {
		fields, err := dbFields(ctx, p, s, r)
		if err != nil {
			return nil, err
		}
		for _, f := range fields {
			nodes = append(nodes, dbObject{Kind: "column", Name: f.Name, Database: r.Database, Schema: dbSchema(s, r), Table: r.Table, DataType: f.Type, PrimaryKey: f.PK})
		}
		return map[string]any{"nodes": nodes}, nil
	}
	var a [][]string
	var err error
	if r.Database == "" {
		switch s.Driver {
		case "sqlite":
			a = [][]string{{"main"}}
		case "mysql", "mariadb":
			a, err = dbStrings(ctx, p, "SHOW DATABASES")
		case "postgres":
			a, err = dbStrings(ctx, p, "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname")
		case "sqlserver":
			a, err = dbStrings(ctx, p, "SELECT name FROM sys.databases WHERE HAS_DBACCESS(name)=1 ORDER BY name")
		}
		if err != nil {
			return nil, err
		}
		for _, v := range a {
			nodes = append(nodes, dbObject{Kind: "database", Name: v[0], Database: v[0]})
		}
		return map[string]any{"nodes": nodes}, nil
	}
	if r.Schema == "" && (s.Driver == "postgres" || s.Driver == "sqlserver") {
		q := "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','sys','INFORMATION_SCHEMA') AND schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' ORDER BY schema_name"
		a, err = dbStrings(ctx, p, q)
		if err != nil {
			return nil, err
		}
		for _, v := range a {
			nodes = append(nodes, dbObject{Kind: "schema", Name: v[0], Database: r.Database, Schema: v[0]})
		}
		return map[string]any{"nodes": nodes}, nil
	}
	if s.Driver == "sqlite" {
		if r.Database != "main" {
			return nil, errors.New("unknown SQLite database")
		}
		a, err = dbStrings(ctx, p, "SELECT name,type FROM main.sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
	} else {
		a, err = dbStrings(ctx, p, "SELECT table_name,table_type FROM information_schema.tables WHERE table_schema="+dbParam(s.Driver, 1)+" ORDER BY table_name", dbSchema(s, r))
	}
	if err != nil {
		return nil, err
	}
	for _, v := range a {
		kind := "table"
		if strings.Contains(strings.ToLower(v[1]), "view") {
			kind = "view"
		}
		nodes = append(nodes, dbObject{Kind: kind, Name: v[0], Database: r.Database, Schema: dbSchema(s, r), Table: v[0]})
	}
	return map[string]any{"nodes": nodes}, nil
}
func dbRows(ctx context.Context, p *sql.DB, s dbSource, r dbRequest) (any, error) {
	if r.Offset < 0 {
		return nil, errors.New("offset must be nonnegative")
	}
	table, err := dbTable(s, r)
	if err != nil {
		return nil, err
	}
	fields, err := dbFields(ctx, p, s, r)
	if err != nil {
		return nil, err
	}
	keys := []string{}
	order := []string{}
	for _, f := range fields {
		if f.PK {
			keys = append(keys, f.Name)
			order = append(order, dbQuote(s.Driver, f.Name))
		}
	}
	q := "SELECT * FROM " + table
	if len(order) > 0 {
		q += " ORDER BY " + strings.Join(order, ",")
	}
	limit := dbLimit(r.Limit)
	if s.Driver == "sqlserver" {
		if len(order) == 0 {
			q += " ORDER BY (SELECT NULL)"
		}
		q += " OFFSET " + strconv.Itoa(r.Offset) + " ROWS FETCH NEXT " + strconv.Itoa(limit+1) + " ROWS ONLY"
	} else {
		q += " LIMIT " + strconv.Itoa(limit+1) + " OFFSET " + strconv.Itoa(r.Offset)
	}
	rows, err := p.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	result, err := dbReadRows(rows, limit)
	return dbPage{dbResult: result, PrimaryKeys: keys, Offset: r.Offset, Limit: limit}, err
}
