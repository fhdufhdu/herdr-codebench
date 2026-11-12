"""Create a new, disposable SQLite database and import files for manual UI tests."""
import csv
import json
import pathlib
import sqlite3
import tempfile


def create_fixture():
    root = pathlib.Path(tempfile.mkdtemp(prefix="codebench-db-ux-", dir="/private/tmp"))
    database = root / "ux-lab.sqlite"
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
                active BOOLEAN NOT NULL DEFAULT 1, notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),
                amount NUMERIC(12,2) NOT NULL, state TEXT CHECK(state IN ('new','paid','cancelled')),
                notes TEXT, amount_with_tax NUMERIC GENERATED ALWAYS AS (amount * 1.1) STORED
            );
            CREATE INDEX orders_customer ON orders(customer_id);
            CREATE TABLE memberships (
                team_id INTEGER, member_id INTEGER, label TEXT,
                PRIMARY KEY(team_id, member_id)
            );
            CREATE TABLE no_primary_key (name TEXT, notes TEXT);
            CREATE TABLE binary_values (id INTEGER PRIMARY KEY, payload BLOB, empty_text TEXT);
            CREATE TABLE audit (id INTEGER PRIMARY KEY, customer_id INTEGER, old_name TEXT, new_name TEXT);
            CREATE TRIGGER customer_name_changed AFTER UPDATE OF name ON customers
            BEGIN
                INSERT INTO audit(customer_id, old_name, new_name) VALUES(NEW.id, OLD.name, NEW.name);
            END;
            CREATE VIEW active_customers AS SELECT id,name,email FROM customers WHERE active=1;
        """)
        notes = [None, "", "first line\nsecond line", 'comma, and "quotes"', "\\N", "긴 설명 " * 50]
        connection.executemany(
            "INSERT INTO customers(id,name,email,active,notes) VALUES(?,?,?,?,?)",
            [(i, f"테스트 고객 {i:03d}", f"customer{i}@example.invalid", i % 2, notes[(i - 1) % len(notes)]) for i in range(1, 241)],
        )
        connection.executemany("INSERT INTO orders(id,customer_id,amount,state,notes) VALUES(?,?,?,?,?)", [(1, 1, "12.50", "new", None), (2, 2, "99.99", "paid", "UTF-8 한글")])
        connection.executemany("INSERT INTO memberships VALUES(?,?,?)", [(1, 1, "one"), (1, 2, "two"), (2, 1, "three")])
        connection.execute("INSERT INTO no_primary_key VALUES('read-only editing test',NULL)")
        connection.execute("INSERT INTO binary_values VALUES(1,?, '')", (bytes([0, 1, 127, 255]),))
    columns = ["id", "name", "email", "active", "notes"]
    rows = [[901, "CSV 가져오기", "csv@example.invalid", 1, "first\nsecond"], [902, '쉼표, "따옴표"', "quotes@example.invalid", 0, "\\N"]]
    with (root / "customers.csv").open("w", newline="") as output:
        writer = csv.writer(output); writer.writerow(columns); writer.writerows(rows)
    (root / "customers.json").write_text(json.dumps([dict(zip(columns, [903, "JSON 가져오기", "json@example.invalid", True, None]))], ensure_ascii=False))
    (root / "invalid.csv").write_text('id,name\n904,"unfinished')
    (root / "queries.sql").write_text("""-- Run each block, a selected range, and Cmd+Enter candidates.
SELECT id,name,notes FROM customers ORDER BY id LIMIT 12;
SELECT * FROM (SELECT id,name FROM customers WHERE active=1) AS active LIMIT 5;
SELECT count(*) AS total_customers FROM customers;
-- Cancellation: execute separately and stop the running job.
WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counter WHERE n<100000000)
SELECT sum(n) FROM counter;
""")
    return {"directory": str(root), "database": str(database), "source_name": "Codebench UX Lab (SQLite)"}


if __name__ == "__main__":
    print(json.dumps(create_fixture(), ensure_ascii=False))
