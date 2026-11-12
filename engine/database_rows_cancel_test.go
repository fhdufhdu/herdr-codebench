package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDatabaseSQLiteCancelDuringRows(t *testing.T) {
	_, _, p := dbFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rows, err := p.QueryContext(ctx, `SELECT 0 AS value UNION ALL SELECT (WITH RECURSIVE counter(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM counter WHERE x<1000000000) SELECT sum(x) FROM counter)`)
	if err != nil {
		t.Fatal(err)
	}
	if !rows.Next() {
		rows.Close()
		t.Fatal("first row unavailable", rows.Err())
	}
	var first int
	if err = rows.Scan(&first); err != nil || first != 0 {
		rows.Close()
		t.Fatal("unexpected first row", first, err)
	}
	finished := make(chan error, 1)
	unexpectedRow := errors.New("long second row completed before cancellation")
	go func() {
		if rows.Next() {
			finished <- unexpectedRow
		} else {
			finished <- rows.Err()
		}
		rows.Close()
	}()
	// The first row has already been consumed; exercise cancellation in a later VM step.
	time.Sleep(5 * time.Millisecond)
	cancel()
	select {
	case err := <-finished:
		if err == nil || err == unexpectedRow {
			t.Fatal("cancelled row iterator returned no error")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SQLite row iteration did not stop after cancellation")
	}
}
