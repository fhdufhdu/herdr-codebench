package main

import (
	"strings"
	"testing"
)

func TestMSSQLDDLColumnTypes(t *testing.T) {
	for _, tc := range []struct {
		column mssqlDDLColumn
		want   string
	}{
		{mssqlDDLColumn{Type: "nvarchar", Length: "80"}, "nvarchar(40)"},
		{mssqlDDLColumn{Type: "nchar", Length: "2"}, "nchar(1)"},
		{mssqlDDLColumn{Type: "nvarchar", Length: "-1"}, "nvarchar(max)"},
		{mssqlDDLColumn{Type: "varchar", Length: "-1"}, "varchar(max)"},
		{mssqlDDLColumn{Type: "varbinary", Length: "-1"}, "varbinary(max)"},
		{mssqlDDLColumn{Type: "char", Length: "30"}, "char(30)"},
		{mssqlDDLColumn{Type: "binary", Length: "16"}, "binary(16)"},
		{mssqlDDLColumn{Type: "decimal", Precision: "38", Scale: "12"}, "decimal(38,12)"},
		{mssqlDDLColumn{Type: "numeric", Precision: "10", Scale: "0"}, "numeric(10,0)"},
		{mssqlDDLColumn{Type: "datetime2", Scale: "7"}, "datetime2(7)"},
		{mssqlDDLColumn{Type: "datetimeoffset", Scale: "0"}, "datetimeoffset(0)"},
		{mssqlDDLColumn{Type: "time", Scale: "3"}, "time(3)"},
		{mssqlDDLColumn{Type: "float", Precision: "24"}, "float(24)"},
		{mssqlDDLColumn{Type: "sysname"}, "[sysname]"},
		{mssqlDDLColumn{Type: "money"}, "[money]"},
		{mssqlDDLColumn{Type: "odd]type", TypeSchema: "app", CustomType: true}, "[app].[odd]]type]"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			got, err := dbMSSQLColumnType(tc.column)
			if err != nil || got != tc.want {
				t.Fatalf("type: %q, %v; want %q", got, err, tc.want)
			}
		})
	}
	for _, c := range []mssqlDDLColumn{{Type: "nvarchar", Length: "3"}, {Type: "char", Length: "-1"}, {Type: "numeric", Precision: "5", Scale: "6"}, {Type: "float", Precision: "54"}, {Type: "datetime2", Scale: "8"}, {Type: "vector"}} {
		if _, err := dbMSSQLColumnType(c); err == nil {
			t.Fatalf("invalid/unsupported type accepted: %+v", c)
		}
	}
}

func TestMSSQLDDLCommonTableConstraintsAndIndexes(t *testing.T) {
	catalog := mssqlDDLCatalog{
		Columns: []mssqlDDLColumn{
			{Name: "id", Type: "bigint", Identity: true, IdentitySeed: "100", IdentityIncrement: "-5", NotForReplication: true},
			{Name: "title", Type: "nvarchar", Length: "80", Collation: "Latin1_General_100_CI_AS", DefaultName: "DF_title", Default: "(N'')"},
			{Name: "payload", Type: "varbinary", Length: "-1", Nullable: true},
			{Name: "amount", Type: "decimal", Precision: "38", Scale: "12"},
			{Name: "total", ComputedColumn: true, Computed: "([amount]*(2))", Persisted: true},
			{Name: "guid", Type: "uniqueidentifier", RowGUID: true, DefaultName: "DF_guid", Default: "(newid())"},
			{Name: "optional", Type: "int", Sparse: true, Nullable: true},
			{Name: "all_sparse", Type: "xml", ColumnSet: true},
		},
		Indexes: []mssqlDDLIndex{
			{Name: "PK_items", Type: "1", ConstraintName: "PK_items", PrimaryKey: true, Unique: true, Keys: []string{"[id] DESC"}, RowLocks: true, PageLocks: true},
			{Name: "UQ_title_guid", Type: "2", ConstraintName: "UQ_title_guid", UniqueConstraint: true, Unique: true, Keys: []string{"[title] ASC", "[guid] DESC"}, RowLocks: true, PageLocks: true},
			{Name: "IX_amount", Type: "2", Unique: true, Keys: []string{"[amount] DESC", "[id] ASC"}, Includes: []string{"[payload]", "[guid]"}, HasFilter: true, Filter: "([amount]>(0))", FillFactor: "90", Padded: true, PageLocks: true, Disabled: true},
			{Name: "IX_exotic", Type: "7", Keys: []string{"[id] ASC"}},
		},
		Checks:      []mssqlDDLCheck{{Name: "CK_amount", Definition: "([amount]>=(0))", Untrusted: true, NotForReplication: true}},
		ForeignKeys: []mssqlDDLForeignKey{{Name: "FK_parent", Schema: "app", Table: "parent]table", Columns: []string{"[id]", "[title]"}, References: []string{"[parent_id]", "[parent_title]"}, OnDelete: "CASCADE", OnUpdate: "SET_NULL", Disabled: true, Untrusted: true, NotForReplication: true}},
	}
	parts, post, warnings, err := dbRenderMSSQLDDL("[dbo].[items]", catalog)
	if err != nil {
		t.Fatal(err)
	}
	ddl := strings.Join(parts, "\n")
	after := strings.Join(post, "\n")
	for _, want := range []string{
		"[id] [bigint] IDENTITY(100,-5) NOT FOR REPLICATION NOT NULL",
		"[title] nvarchar(40) COLLATE [Latin1_General_100_CI_AS] NOT NULL CONSTRAINT [DF_title] DEFAULT (N'')",
		"[payload] varbinary(max) NULL",
		"[amount] decimal(38,12) NOT NULL",
		"[total] AS ([amount]*(2)) PERSISTED NOT NULL",
		"[guid] [uniqueidentifier] ROWGUIDCOL NOT NULL CONSTRAINT [DF_guid] DEFAULT (newid())",
		"[optional] [int] SPARSE NULL",
		"[all_sparse] [xml] COLUMN_SET FOR ALL_SPARSE_COLUMNS",
		"CONSTRAINT [PK_items] PRIMARY KEY CLUSTERED ([id] DESC)",
		"CONSTRAINT [UQ_title_guid] UNIQUE NONCLUSTERED ([title] ASC, [guid] DESC)",
		"CREATE UNIQUE NONCLUSTERED INDEX [IX_amount] ON [dbo].[items] ([amount] DESC, [id] ASC) INCLUDE ([payload], [guid]) WHERE ([amount]>(0))",
		"PAD_INDEX = ON, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = OFF, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90",
	} {
		if !strings.Contains(ddl, want) {
			t.Fatalf("missing DDL %q:\n%s", want, ddl)
		}
	}
	for _, want := range []string{
		"ALTER INDEX [IX_amount] ON [dbo].[items] DISABLE;",
		"ALTER TABLE [dbo].[items] WITH NOCHECK ADD CONSTRAINT [CK_amount] CHECK NOT FOR REPLICATION (([amount]>=(0)));",
		"ALTER TABLE [dbo].[items] WITH NOCHECK ADD CONSTRAINT [FK_parent] FOREIGN KEY ([id], [title]) REFERENCES [app].[parent]]table] ([parent_id], [parent_title]) ON DELETE CASCADE ON UPDATE SET NULL NOT FOR REPLICATION;",
		"ALTER TABLE [dbo].[items] NOCHECK CONSTRAINT [FK_parent];",
	} {
		if !strings.Contains(after, want) {
			t.Fatalf("missing deferred DDL %q:\n%s", want, after)
		}
	}
	if strings.Contains(ddl, "FOREIGN KEY") || strings.Contains(ddl, "IX_exotic") || !strings.Contains(strings.Join(warnings, "\n"), "IX_exotic") {
		t.Fatal("FK not deferred or exotic index not disclosed", ddl, warnings)
	}
}

func TestMSSQLDDLMissingMetadataIsExplicit(t *testing.T) {
	base := mssqlDDLCatalog{Columns: []mssqlDDLColumn{{Name: "id", Type: "int"}}}
	for _, catalog := range []mssqlDDLCatalog{
		{Columns: []mssqlDDLColumn{{Name: "computed", ComputedColumn: true}}},
		{Columns: []mssqlDDLColumn{{Name: "id", Type: "bigint", Identity: true, IdentitySeed: "?", IdentityIncrement: "1"}}},
		{Columns: base.Columns, Indexes: []mssqlDDLIndex{{Name: "filtered", Type: "2", Keys: []string{"[id] ASC"}, HasFilter: true}}},
		{Columns: base.Columns, Indexes: []mssqlDDLIndex{{Name: "PK", Type: "1", PrimaryKey: true, Keys: []string{"[id] ASC"}}}},
		{Columns: base.Columns, Checks: []mssqlDDLCheck{{Name: "CK"}}},
		{Columns: base.Columns, ForeignKeys: []mssqlDDLForeignKey{{Name: "FK", Schema: "dbo", Table: "p", Columns: []string{"[id]"}, References: []string{"[id]"}, OnDelete: "INVALID", OnUpdate: "NO_ACTION"}}},
	} {
		if _, _, _, err := dbRenderMSSQLDDL("[dbo].[items]", catalog); err == nil {
			t.Fatal("missing metadata accepted", catalog)
		}
	}
}
