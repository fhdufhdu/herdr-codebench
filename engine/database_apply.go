package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

func dbBoundValue(v any) (any, error) {
	switch x := v.(type) {
	case nil, string, bool, float64, int64:
		return x, nil
	case json.Number:
		if n, err := x.Int64(); err == nil {
			return n, nil
		}
		return x.String(), nil
	case map[string]any:
		if x["type"] != "binary" || len(x) != 2 {
			return nil, errors.New("unsupported cell value")
		}
		text, ok := x["base64"].(string)
		if !ok {
			return nil, errors.New("invalid binary value")
		}
		return base64.StdEncoding.DecodeString(text)
	default:
		return nil, errors.New("unsupported cell value")
	}
}
func dbKeys(values map[string]any) []string {
	a := make([]string, 0, len(values))
	for k := range values {
		a = append(a, k)
	}
	sort.Strings(a)
	return a
}
func dbApply(ctx context.Context, p *sql.DB, s dbSource, r dbRequest) (any, error) {
	if len(r.Changes) == 0 || len(r.Changes) > 1000 {
		return nil, errors.New("provide 1 to 1000 changes")
	}
	table, err := dbTable(s, r)
	if err != nil {
		return nil, err
	}
	fields, err := dbFields(ctx, p, s, r)
	if err != nil {
		return nil, err
	}
	known := map[string]dbField{}
	pk := []string{}
	for _, f := range fields {
		known[f.Name] = f
		if f.PK {
			pk = append(pk, f.Name)
		}
	}
	tx, err := p.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var affected int64
	for index, c := range r.Changes {
		if c.Op != "insert" && c.Op != "update" && c.Op != "delete" {
			return nil, fmt.Errorf("change %d: unsupported operation", index+1)
		}
		for k := range c.Original {
			if _, ok := known[k]; !ok {
				return nil, fmt.Errorf("unknown original column %q", k)
			}
		}
		for k := range c.Values {
			f, ok := known[k]
			if !ok {
				return nil, fmt.Errorf("unknown column %q", k)
			}
			if f.Generated {
				return nil, fmt.Errorf("generated column %q cannot be assigned", k)
			}
		}
		args := []any{}
		bind := func(v any) (string, error) {
			x, err := dbBoundValue(v)
			if err != nil {
				return "", err
			}
			args = append(args, x)
			return dbParam(s.Driver, len(args)), nil
		}
		q := ""
		if c.Op == "insert" {
			cols := []string{}
			params := []string{}
			for _, k := range dbKeys(c.Values) {
				cols = append(cols, dbQuote(s.Driver, k))
				param, err := bind(c.Values[k])
				if err != nil {
					return nil, err
				}
				params = append(params, param)
			}
			if len(cols) == 0 {
				if s.Driver == "mysql" || s.Driver == "mariadb" {
					q = "INSERT INTO " + table + " () VALUES ()"
				} else {
					q = "INSERT INTO " + table + " DEFAULT VALUES"
				}
			} else {
				q = "INSERT INTO " + table + " (" + strings.Join(cols, ",") + ") VALUES (" + strings.Join(params, ",") + ")"
			}
		} else {
			if len(pk) == 0 {
				return nil, errors.New("updates and deletes require a primary key")
			}
			for _, k := range pk {
				v, ok := c.Original[k]
				if !ok || v == nil {
					return nil, errors.New("original primary key values are required")
				}
			}
			if c.Op == "update" {
				if len(c.Values) == 0 {
					return nil, errors.New("update values are required")
				}
				sets := []string{}
				for _, k := range dbKeys(c.Values) {
					if _, ok := c.Original[k]; !ok {
						return nil, fmt.Errorf("original value for %q is required", k)
					}
					param, err := bind(c.Values[k])
					if err != nil {
						return nil, err
					}
					sets = append(sets, dbQuote(s.Driver, k)+"="+param)
				}
				q = "UPDATE " + table + " SET " + strings.Join(sets, ",")
			} else {
				for _, f := range fields {
					if !f.Generated {
						if _, ok := c.Original[f.Name]; !ok {
							return nil, fmt.Errorf("original value for %q is required to delete", f.Name)
						}
					}
				}
				q = "DELETE FROM " + table
			}
			where := []string{}
			for _, k := range dbKeys(c.Original) {
				col := dbQuote(s.Driver, k)
				if c.Original[k] == nil {
					where = append(where, col+" IS NULL")
				} else {
					param, err := bind(c.Original[k])
					if err != nil {
						return nil, err
					}
					where = append(where, col+"="+param)
				}
			}
			q += " WHERE " + strings.Join(where, " AND ")
		}
		result, err := tx.ExecContext(ctx, q, args...)
		if err != nil {
			return nil, fmt.Errorf("change %d: %w", index+1, err)
		}
		n, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if n != 1 {
			return nil, fmt.Errorf("change %d: row conflict (matched %d rows); all changes rolled back", index+1, n)
		}
		affected += n
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]int64{"affected_rows": affected}, nil
}
