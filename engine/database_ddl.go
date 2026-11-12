package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

func (m *databaseManager) ddl(ctx context.Context, s dbSource, r dbRequest) (any, error) {
	if len(r.Objects) == 0 || len(r.Objects) > 256 {
		return nil, errors.New("select 1 to 256 objects")
	}
	warnings := []string{}
	parts := []string{}
	deferred := []string{}
	seen := map[string]bool{}
	count := 0
	objects := append([]dbObject{}, r.Objects...)
	rank := func(k string) int {
		switch k {
		case "database":
			return 0
		case "schema":
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(objects, func(i, j int) bool { return rank(objects[i].Kind) < rank(objects[j].Kind) })
	var walk func(dbObject) error
	walk = func(o dbObject) error {
		if o.Database == "" {
			o.Database = r.Database
		}
		if o.Database == "" {
			o.Database = s.Database
		}
		if o.Database == "" && s.Driver == "sqlite" {
			o.Database = "main"
		}
		if o.Schema == "" && o.Kind != "database" {
			o.Schema = dbSchema(s, dbRequest{Database: o.Database, Schema: r.Schema})
		}
		if o.Kind == "database" {
			o.Database = o.Name
		}
		if o.Kind == "schema" {
			o.Schema = o.Name
		}
		if o.Kind == "column" {
			if o.Table == "" {
				return errors.New("column DDL selection requires its owning table")
			}
			warnings = append(warnings, "Column selection uses its owning table definition.")
			o.Name = o.Table
			o.Kind = "table"
		}
		key := o.Database + "\x00" + o.Schema + "\x00" + o.Kind + "\x00" + o.Name
		if seen[key] {
			return nil
		}
		seen[key] = true
		count++
		if count > 5000 {
			return errors.New("DDL selection exceeds 5000 objects")
		}
		p, err := m.pool(s, o.Database)
		if err != nil {
			return err
		}
		if o.Kind == "database" || o.Kind == "schema" {
			if o.Kind == "database" {
				if s.Driver == "sqlite" {
					parts = append(parts, "-- SQLite database file: open or create separately.")
				} else {
					if s.Driver == "mysql" || s.Driver == "mariadb" {
						definition, err := dbShowCreate(ctx, p, "DATABASE", dbQuote(s.Driver, o.Name))
						if err != nil {
							return err
						}
						parts = append(parts, definition)
						parts = append(parts, "USE "+dbQuote(s.Driver, o.Name)+";")
					} else {
						parts = append(parts, "CREATE DATABASE "+dbQuote(s.Driver, o.Name)+";")
						warnings = append(warnings, "Reconnect to "+o.Name+" before executing its child definitions.")
					}
				}
			} else if s.Driver != "sqlite" && s.Driver != "mysql" && s.Driver != "mariadb" {
				parts = append(parts, "CREATE SCHEMA "+dbQuote(s.Driver, o.Name)+";")
			}
			childReq := dbRequest{Database: o.Database}
			if o.Kind == "schema" {
				childReq.Schema = o.Schema
			}
			v, err := dbCatalog(ctx, p, s, childReq)
			if err != nil {
				return err
			}
			nodes := v.(map[string]any)["nodes"].([]dbObject)
			for _, child := range nodes {
				if err = walk(child); err != nil {
					return err
				}
			}
			return nil
		}
		if o.Kind != "table" && o.Kind != "view" {
			warnings = append(warnings, "Unsupported DDL object kind: "+o.Kind)
			return nil
		}
		rr := dbRequest{Database: o.Database, Schema: o.Schema, Table: o.Name}
		name, err := dbTable(s, rr)
		if err != nil {
			return err
		}
		switch s.Driver {
		case "sqlite":
			a, err := dbStrings(ctx, p, "SELECT sql FROM main.sqlite_schema WHERE (name=? OR (tbl_name=? AND type IN ('index','trigger'))) AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END,name", o.Name, o.Name)
			if err != nil {
				return err
			}
			if len(a) == 0 {
				return errors.New("DDL object not found")
			}
			for _, v := range a {
				parts = append(parts, strings.TrimSuffix(strings.TrimSpace(v[0]), ";")+";")
			}
		case "mysql", "mariadb":
			definition, err := dbShowCreate(ctx, p, strings.ToUpper(o.Kind), name)
			if err != nil {
				return err
			}
			parts = append(parts, definition)
		case "postgres":
			if o.Kind == "view" {
				a, err := dbStrings(ctx, p, "SELECT pg_get_viewdef(to_regclass($1),true)", name)
				if err != nil {
					return err
				}
				if len(a) == 0 || a[0][0] == "" {
					return errors.New("view definition unavailable")
				}
				parts = append(parts, "CREATE VIEW "+name+" AS "+strings.TrimSuffix(a[0][0], ";")+";")
				break
			}
			a, err := dbStrings(ctx, p, "SELECT a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,COALESCE(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", name)
			if err != nil {
				return err
			}
			if len(a) == 0 {
				return errors.New("table definition unavailable")
			}
			defs := []string{}
			for _, v := range a {
				d := dbQuote(s.Driver, v[0]) + " " + v[1]
				if v[5] != "" {
					d += " GENERATED ALWAYS AS (" + v[3] + ") STORED"
				} else if v[4] != "" {
					mode := "BY DEFAULT"
					if v[4] == "a" {
						mode = "ALWAYS"
					}
					d += " GENERATED " + mode + " AS IDENTITY"
				} else if v[3] != "" {
					d += " DEFAULT " + v[3]
				}
				if v[2] == "true" {
					d += " NOT NULL"
				}
				defs = append(defs, d)
			}
			constraints, err := dbStrings(ctx, p, "SELECT conname,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid=to_regclass($1) ORDER BY conname", name)
			if err != nil {
				return err
			}
			for _, v := range constraints {
				defs = append(defs, "CONSTRAINT "+dbQuote(s.Driver, v[0])+" "+v[1])
			}
			parts = append(parts, "CREATE TABLE "+name+" (\n  "+strings.Join(defs, ",\n  ")+"\n);")
			indexes, err := dbStrings(ctx, p, "SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid=to_regclass($1) AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) ORDER BY i.indexrelid", name)
			if err != nil {
				return err
			}
			for _, v := range indexes {
				parts = append(parts, v[0]+";")
			}
			warnings = append(warnings, "PostgreSQL output excludes sequences, partitions/inheritance, triggers, policies, ownership, grants and referenced type definitions; dependency ordering may require adjustment.")
		case "sqlserver":
			if o.Kind == "view" {
				a, err := dbStrings(ctx, p, "SELECT OBJECT_DEFINITION(OBJECT_ID(@p1))", name)
				if err != nil {
					return err
				}
				if len(a) == 0 || a[0][0] == "" {
					return errors.New("view definition unavailable or insufficient permission")
				}
				parts = append(parts, a[0][0]+";")
				break
			}
			catalog, err := dbReadMSSQLDDL(ctx, p, name)
			if err != nil {
				return err
			}
			definitions, post, warn, err := dbRenderMSSQLDDL(name, catalog)
			if err != nil {
				return err
			}
			parts = append(parts, definitions...)
			deferred = append(deferred, post...)
			warnings = append(warnings, warn...)
		}
		return nil
	}
	for _, o := range objects {
		if err := walk(o); err != nil {
			return nil, err
		}
	}
	sqlText := strings.Join(append(parts, deferred...), "\n\n")
	if len(sqlText) > 16<<20 {
		return nil, errors.New("DDL output exceeds 16 MiB")
	}
	unique := []string{}
	set := map[string]bool{}
	for _, w := range warnings {
		if !set[w] {
			unique = append(unique, w)
			set[w] = true
		}
	}
	return map[string]any{"sql": sqlText, "warnings": unique}, nil
}

func dbShowCreate(ctx context.Context, p *sql.DB, kind, name string) (string, error) {
	a, err := dbStrings(ctx, p, "SHOW CREATE "+kind+" "+name)
	if err != nil {
		return "", err
	}
	if len(a) == 0 || len(a[0]) < 2 || strings.TrimSpace(a[0][1]) == "" {
		return "", errors.New("DDL definition unavailable")
	}
	return strings.TrimSuffix(strings.TrimSpace(a[0][1]), ";") + ";", nil
}

type mssqlDDLColumn struct {
	Name, Type, TypeSchema, Length, Precision, Scale, Collation                                                                                  string
	DefaultName, Default, IdentitySeed, IdentityIncrement, Computed                                                                              string
	CustomType, Nullable, Identity, ComputedColumn, Persisted, RowGUID, Sparse, ColumnSet, FileStream, NotForReplication, TypedXML, BoundDefault bool
}
type mssqlDDLIndex struct {
	ID, Name, Type, ConstraintName, Filter, FillFactor                                                                                 string
	Unique, PrimaryKey, UniqueConstraint, Disabled, Hypothetical, HasFilter, Padded, IgnoreDuplicate, RowLocks, PageLocks, Partitioned bool
	Keys, Includes                                                                                                                     []string
}
type mssqlDDLCheck struct {
	Name, Definition                       string
	Disabled, Untrusted, NotForReplication bool
}
type mssqlDDLForeignKey struct {
	Name, Schema, Table, OnDelete, OnUpdate string
	Columns, References                     []string
	Disabled, Untrusted, NotForReplication  bool
}
type mssqlDDLCatalog struct {
	Columns     []mssqlDDLColumn
	Indexes     []mssqlDDLIndex
	Checks      []mssqlDDLCheck
	ForeignKeys []mssqlDDLForeignKey
}

func dbCatalogFlag(s string) bool { return s == "1" || strings.EqualFold(s, "true") }

func dbReadMSSQLDDL(ctx context.Context, p *sql.DB, name string) (mssqlDDLCatalog, error) {
	catalog := mssqlDDLCatalog{}
	a, err := dbStrings(ctx, p, `SELECT c.name,t.name,SCHEMA_NAME(t.schema_id),t.is_user_defined,c.max_length,c.precision,c.scale,c.is_nullable,COALESCE(c.collation_name,''),COALESCE(d.name,''),COALESCE(d.definition,''),c.is_identity,COALESCE(CONVERT(varchar(100),ic.seed_value),''),COALESCE(CONVERT(varchar(100),ic.increment_value),''),c.is_computed,COALESCE(cc.definition,''),COALESCE(cc.is_persisted,0),c.is_rowguidcol,c.is_sparse,c.is_column_set,c.is_filestream,COALESCE(ic.is_not_for_replication,0),c.xml_collection_id,c.default_object_id FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id LEFT JOIN sys.default_constraints d ON d.object_id=c.default_object_id LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id WHERE c.object_id=OBJECT_ID(@p1) ORDER BY c.column_id`, name)
	if err != nil {
		return catalog, err
	}
	if len(a) == 0 {
		return catalog, errors.New("table definition unavailable or insufficient metadata permission")
	}
	for _, v := range a {
		catalog.Columns = append(catalog.Columns, mssqlDDLColumn{Name: v[0], Type: v[1], TypeSchema: v[2], CustomType: dbCatalogFlag(v[3]), Length: v[4], Precision: v[5], Scale: v[6], Nullable: dbCatalogFlag(v[7]), Collation: v[8], DefaultName: v[9], Default: v[10], Identity: dbCatalogFlag(v[11]), IdentitySeed: v[12], IdentityIncrement: v[13], ComputedColumn: dbCatalogFlag(v[14]), Computed: v[15], Persisted: dbCatalogFlag(v[16]), RowGUID: dbCatalogFlag(v[17]), Sparse: dbCatalogFlag(v[18]), ColumnSet: dbCatalogFlag(v[19]), FileStream: dbCatalogFlag(v[20]), NotForReplication: dbCatalogFlag(v[21]), TypedXML: v[22] != "0", BoundDefault: v[23] != "0" && v[10] == ""})
	}
	a, err = dbStrings(ctx, p, `SELECT i.index_id,i.name,i.type,i.is_unique,i.is_primary_key,i.is_unique_constraint,COALESCE(k.name,''),i.is_disabled,i.is_hypothetical,i.has_filter,COALESCE(i.filter_definition,''),i.fill_factor,i.is_padded,i.ignore_dup_key,i.allow_row_locks,i.allow_page_locks,COALESCE(ic.key_ordinal,0),COALESCE(ic.is_descending_key,0),COALESCE(ic.is_included_column,0),COALESCE(c.name,''),COALESCE(ds.type,'') FROM sys.indexes i LEFT JOIN sys.key_constraints k ON k.parent_object_id=i.object_id AND k.unique_index_id=i.index_id LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id LEFT JOIN sys.data_spaces ds ON ds.data_space_id=i.data_space_id WHERE i.object_id=OBJECT_ID(@p1) AND i.index_id>0 ORDER BY i.index_id,ic.is_included_column,ic.key_ordinal,ic.index_column_id`, name)
	if err != nil {
		return catalog, err
	}
	for _, v := range a {
		if len(catalog.Indexes) == 0 || catalog.Indexes[len(catalog.Indexes)-1].ID != v[0] {
			catalog.Indexes = append(catalog.Indexes, mssqlDDLIndex{ID: v[0], Name: v[1], Type: v[2], Unique: dbCatalogFlag(v[3]), PrimaryKey: dbCatalogFlag(v[4]), UniqueConstraint: dbCatalogFlag(v[5]), ConstraintName: v[6], Disabled: dbCatalogFlag(v[7]), Hypothetical: dbCatalogFlag(v[8]), HasFilter: dbCatalogFlag(v[9]), Filter: v[10], FillFactor: v[11], Padded: dbCatalogFlag(v[12]), IgnoreDuplicate: dbCatalogFlag(v[13]), RowLocks: dbCatalogFlag(v[14]), PageLocks: dbCatalogFlag(v[15]), Partitioned: v[20] == "PS"})
		}
		index := &catalog.Indexes[len(catalog.Indexes)-1]
		if v[19] != "" {
			if dbCatalogFlag(v[18]) {
				index.Includes = append(index.Includes, dbQuote("sqlserver", v[19]))
			} else if v[16] != "0" {
				direction := " ASC"
				if dbCatalogFlag(v[17]) {
					direction = " DESC"
				}
				index.Keys = append(index.Keys, dbQuote("sqlserver", v[19])+direction)
			}
		}
	}
	a, err = dbStrings(ctx, p, `SELECT name,COALESCE(definition,''),is_disabled,is_not_trusted,is_not_for_replication FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(@p1) ORDER BY name`, name)
	if err != nil {
		return catalog, err
	}
	for _, v := range a {
		catalog.Checks = append(catalog.Checks, mssqlDDLCheck{Name: v[0], Definition: v[1], Disabled: dbCatalogFlag(v[2]), Untrusted: dbCatalogFlag(v[3]), NotForReplication: dbCatalogFlag(v[4])})
	}
	a, err = dbStrings(ctx, p, `SELECT f.name,OBJECT_SCHEMA_NAME(f.referenced_object_id),OBJECT_NAME(f.referenced_object_id),f.delete_referential_action_desc,f.update_referential_action_desc,f.is_disabled,f.is_not_trusted,f.is_not_for_replication,c.name,r.name FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id LEFT JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id LEFT JOIN sys.columns r ON r.object_id=fc.referenced_object_id AND r.column_id=fc.referenced_column_id WHERE f.parent_object_id=OBJECT_ID(@p1) ORDER BY f.name,fc.constraint_column_id`, name)
	if err != nil {
		return catalog, err
	}
	for _, v := range a {
		if v[8] == "" || v[9] == "" {
			return catalog, fmt.Errorf("foreign key column metadata unavailable for %q", v[0])
		}
		if len(catalog.ForeignKeys) == 0 || catalog.ForeignKeys[len(catalog.ForeignKeys)-1].Name != v[0] {
			catalog.ForeignKeys = append(catalog.ForeignKeys, mssqlDDLForeignKey{Name: v[0], Schema: v[1], Table: v[2], OnDelete: v[3], OnUpdate: v[4], Disabled: dbCatalogFlag(v[5]), Untrusted: dbCatalogFlag(v[6]), NotForReplication: dbCatalogFlag(v[7])})
		}
		fk := &catalog.ForeignKeys[len(catalog.ForeignKeys)-1]
		fk.Columns = append(fk.Columns, dbQuote("sqlserver", v[8]))
		fk.References = append(fk.References, dbQuote("sqlserver", v[9]))
	}
	return catalog, nil
}

func dbMSSQLColumnType(c mssqlDDLColumn) (string, error) {
	if c.CustomType {
		return dbQuote("sqlserver", c.TypeSchema) + "." + dbQuote("sqlserver", c.Type), nil
	}
	t := strings.ToLower(c.Type)
	positive := func(text string, max int) (string, error) {
		n, err := strconv.Atoi(text)
		if err != nil || n < 1 || n > max {
			return "", fmt.Errorf("invalid %s type metadata for column %q", c.Type, c.Name)
		}
		return strconv.Itoa(n), nil
	}
	switch t {
	case "varchar", "char", "varbinary", "binary", "nvarchar", "nchar":
		if c.Length == "-1" && (t == "varchar" || t == "nvarchar" || t == "varbinary") {
			return t + "(max)", nil
		}
		n, err := strconv.Atoi(c.Length)
		if err != nil || n <= 0 || n > 8000 {
			return "", fmt.Errorf("invalid length for column %q", c.Name)
		}
		if t == "nvarchar" || t == "nchar" {
			if n%2 != 0 {
				return "", fmt.Errorf("invalid Unicode byte length for column %q", c.Name)
			}
			n /= 2
		}
		return t + "(" + strconv.Itoa(n) + ")", nil
	case "decimal", "numeric":
		p, err := positive(c.Precision, 38)
		if err != nil {
			return "", err
		}
		precision, _ := strconv.Atoi(p)
		scale, err := strconv.Atoi(c.Scale)
		if err != nil || scale < 0 || scale > precision {
			return "", fmt.Errorf("invalid scale for column %q", c.Name)
		}
		return t + "(" + p + "," + strconv.Itoa(scale) + ")", nil
	case "time", "datetime2", "datetimeoffset":
		scale, err := strconv.Atoi(c.Scale)
		if err != nil || scale < 0 || scale > 7 {
			return "", fmt.Errorf("invalid time scale for column %q", c.Name)
		}
		return t + "(" + strconv.Itoa(scale) + ")", nil
	case "float":
		p, err := positive(c.Precision, 53)
		if err != nil {
			return "", err
		}
		return t + "(" + p + ")", nil
	case "bigint", "int", "smallint", "tinyint", "bit", "date", "datetime", "smalldatetime", "real", "money", "smallmoney", "text", "ntext", "image", "uniqueidentifier", "xml", "sql_variant", "timestamp", "rowversion", "sysname", "geometry", "geography", "hierarchyid":
		return dbQuote("sqlserver", c.Type), nil
	default:
		return "", fmt.Errorf("unsupported SQL Server type %q for column %q", c.Type, c.Name)
	}
}

func dbRenderMSSQLDDL(name string, catalog mssqlDDLCatalog) ([]string, []string, []string, error) {
	defs := []string{}
	indexes := []string{}
	post := []string{}
	warnings := []string{"SQL Server DDL excludes triggers, permissions, table/storage/partition/compression options, temporal/ledger/encryption/masking settings, user-defined type definitions, sequences and advanced index types/options. Referenced tables and expression dependencies must exist when the script is executed."}
	for _, c := range catalog.Columns {
		column := dbQuote("sqlserver", c.Name)
		if c.ComputedColumn {
			if c.Computed == "" {
				return nil, nil, nil, fmt.Errorf("computed definition unavailable for column %q", c.Name)
			}
			column += " AS " + c.Computed
			if c.Persisted {
				column += " PERSISTED"
				if !c.Nullable {
					column += " NOT NULL"
				}
			}
			defs = append(defs, column)
			continue
		}
		typ, err := dbMSSQLColumnType(c)
		if err != nil {
			return nil, nil, nil, err
		}
		column += " " + typ
		if c.ColumnSet {
			column += " COLUMN_SET FOR ALL_SPARSE_COLUMNS"
			defs = append(defs, column)
			continue
		}
		if c.FileStream {
			column += " FILESTREAM"
		}
		if c.Collation != "" {
			column += " COLLATE " + dbQuote("sqlserver", c.Collation)
		}
		if c.Sparse {
			column += " SPARSE"
		}
		if c.Identity {
			if _, ok := new(big.Int).SetString(c.IdentitySeed, 10); !ok {
				return nil, nil, nil, fmt.Errorf("identity seed unavailable for column %q", c.Name)
			}
			increment, ok := new(big.Int).SetString(c.IdentityIncrement, 10)
			if !ok || increment.Sign() == 0 {
				return nil, nil, nil, fmt.Errorf("identity increment unavailable for column %q", c.Name)
			}
			column += " IDENTITY(" + c.IdentitySeed + "," + c.IdentityIncrement + ")"
			if c.NotForReplication {
				column += " NOT FOR REPLICATION"
			}
		}
		if c.RowGUID {
			column += " ROWGUIDCOL"
		}
		if c.Nullable {
			column += " NULL"
		} else {
			column += " NOT NULL"
		}
		if c.Default != "" {
			if c.DefaultName != "" {
				column += " CONSTRAINT " + dbQuote("sqlserver", c.DefaultName)
			}
			column += " DEFAULT " + c.Default
		}
		if c.CustomType {
			warnings = append(warnings, "User-defined type dependency must be created separately: "+typ)
		}
		if c.TypedXML {
			warnings = append(warnings, "Typed XML collection omitted for column "+dbQuote("sqlserver", c.Name))
		}
		if c.BoundDefault {
			warnings = append(warnings, "Legacy bound default omitted for column "+dbQuote("sqlserver", c.Name))
		}
		defs = append(defs, column)
	}
	if len(defs) == 0 {
		return nil, nil, nil, errors.New("table columns unavailable")
	}
	for _, i := range catalog.Indexes {
		if i.Hypothetical {
			warnings = append(warnings, "Hypothetical index omitted: "+i.Name)
			continue
		}
		if i.Type != "1" && i.Type != "2" {
			warnings = append(warnings, "Unsupported SQL Server index type omitted: "+i.Name+" (type "+i.Type+")")
			continue
		}
		if len(i.Keys) == 0 {
			return nil, nil, nil, fmt.Errorf("index key columns unavailable for %q", i.Name)
		}
		if i.HasFilter && i.Filter == "" {
			return nil, nil, nil, fmt.Errorf("filtered index predicate unavailable for %q", i.Name)
		}
		kind := "NONCLUSTERED"
		if i.Type == "1" {
			kind = "CLUSTERED"
		}
		option := func(flag bool) string {
			if flag {
				return "ON"
			}
			return "OFF"
		}
		options := []string{"PAD_INDEX = " + option(i.Padded), "IGNORE_DUP_KEY = " + option(i.IgnoreDuplicate), "ALLOW_ROW_LOCKS = " + option(i.RowLocks), "ALLOW_PAGE_LOCKS = " + option(i.PageLocks)}
		if i.FillFactor != "" && i.FillFactor != "0" {
			fill, err := strconv.Atoi(i.FillFactor)
			if err != nil || fill < 1 || fill > 100 {
				return nil, nil, nil, fmt.Errorf("invalid fill factor for index %q", i.Name)
			}
			options = append(options, "FILLFACTOR = "+strconv.Itoa(fill))
		}
		with := " WITH (" + strings.Join(options, ", ") + ")"
		if i.PrimaryKey || i.UniqueConstraint {
			constraint := i.ConstraintName
			if constraint == "" {
				return nil, nil, nil, fmt.Errorf("key constraint name unavailable for %q", i.Name)
			}
			constraintKind := "UNIQUE"
			if i.PrimaryKey {
				constraintKind = "PRIMARY KEY"
			}
			defs = append(defs, "CONSTRAINT "+dbQuote("sqlserver", constraint)+" "+constraintKind+" "+kind+" ("+strings.Join(i.Keys, ", ")+")"+with)
		} else {
			unique := ""
			if i.Unique {
				unique = "UNIQUE "
			}
			definition := "CREATE " + unique + kind + " INDEX " + dbQuote("sqlserver", i.Name) + " ON " + name + " (" + strings.Join(i.Keys, ", ") + ")"
			if len(i.Includes) > 0 {
				definition += " INCLUDE (" + strings.Join(i.Includes, ", ") + ")"
			}
			if i.HasFilter {
				definition += " WHERE " + i.Filter
			}
			indexes = append(indexes, definition+with+";")
		}
		if i.Partitioned {
			warnings = append(warnings, "Partition scheme omitted for index "+i.Name)
		}
		if i.Disabled {
			post = append(post, "ALTER INDEX "+dbQuote("sqlserver", i.Name)+" ON "+name+" DISABLE;")
		}
	}
	addConstraint := func(constraint, definition string, disabled, untrusted bool) {
		check := "CHECK"
		if untrusted || disabled {
			check = "NOCHECK"
		}
		post = append(post, "ALTER TABLE "+name+" WITH "+check+" ADD CONSTRAINT "+dbQuote("sqlserver", constraint)+" "+definition+";")
		if disabled {
			post = append(post, "ALTER TABLE "+name+" NOCHECK CONSTRAINT "+dbQuote("sqlserver", constraint)+";")
		}
	}
	for _, c := range catalog.Checks {
		if c.Definition == "" {
			return nil, nil, nil, fmt.Errorf("check constraint definition unavailable for %q", c.Name)
		}
		definition := "CHECK "
		if c.NotForReplication {
			definition += "NOT FOR REPLICATION "
		}
		definition += "(" + c.Definition + ")"
		addConstraint(c.Name, definition, c.Disabled, c.Untrusted)
	}
	action := func(value string) (string, error) {
		switch value {
		case "NO_ACTION", "CASCADE", "SET_NULL", "SET_DEFAULT":
			return strings.ReplaceAll(value, "_", " "), nil
		}
		return "", errors.New("invalid foreign key action metadata")
	}
	for _, f := range catalog.ForeignKeys {
		if f.Schema == "" || f.Table == "" || len(f.Columns) == 0 || len(f.Columns) != len(f.References) {
			return nil, nil, nil, fmt.Errorf("foreign key metadata unavailable for %q", f.Name)
		}
		onDelete, err := action(f.OnDelete)
		if err != nil {
			return nil, nil, nil, err
		}
		onUpdate, err := action(f.OnUpdate)
		if err != nil {
			return nil, nil, nil, err
		}
		definition := "FOREIGN KEY (" + strings.Join(f.Columns, ", ") + ") REFERENCES " + dbQuote("sqlserver", f.Schema) + "." + dbQuote("sqlserver", f.Table) + " (" + strings.Join(f.References, ", ") + ") ON DELETE " + onDelete + " ON UPDATE " + onUpdate
		if f.NotForReplication {
			definition += " NOT FOR REPLICATION"
		}
		addConstraint(f.Name, definition, f.Disabled, f.Untrusted)
	}
	parts := []string{"CREATE TABLE " + name + " (\n  " + strings.Join(defs, ",\n  ") + "\n);"}
	parts = append(parts, indexes...)
	return parts, post, warnings, nil
}
