package main

import (
	"database/sql"
	"net"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/microsoft/go-mssqldb"
	sqliteDriver "github.com/ncruces/go-sqlite3/driver"
)

func init() {
	sql.Register("sqlite", &sqliteDriver.SQLite{})
	mysqlDatabaseDSN = func(s dbSource, database, pw, host string, port int) (string, string, error) {
		c := mysql.NewConfig()
		c.User = s.User
		c.Passwd = pw
		c.Net = "tcp"
		c.Addr = net.JoinHostPort(host, strconv.Itoa(port))
		c.DBName = database
		c.Timeout = 10 * time.Second
		c.ReadTimeout = 2 * time.Minute
		c.WriteTimeout = 30 * time.Second
		c.ClientFoundRows = true
		switch s.TLS {
		case "disable":
			c.TLSConfig = "false"
		case "require":
			c.TLSConfig = "skip-verify"
		default:
			c.TLSConfig = "true"
		}
		return "mysql", c.FormatDSN(), nil
	}
}
