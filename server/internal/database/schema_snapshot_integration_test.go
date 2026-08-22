package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"tallyo/internal/utils/must"

	"github.com/samber/lo"
)

func TestSchemaSnapshot(t *testing.T) {
	ctx := context.Background()
	s := testDB(t)

	dump, err := dumpSchema(ctx, s)
	must.NoErr(t, err)

	golden := "testdata/schema.sql"
	if os.Getenv("UPDATE_SCHEMA_SNAPSHOT") == "1" {
		must.NoErr(t, os.WriteFile(golden, []byte(dump), 0o644))
		t.Logf("updated schema snapshot: %s", golden)
		return
	}

	expected, err := os.ReadFile(golden)
	must.NoErr(t, err)

	if dump != string(expected) {
		t.Errorf("schema mismatch!\n\n--- expected (%s)\n+++ actual\n\n%s\n\nTo update: UPDATE_SCHEMA_SNAPSHOT=1 go test ./internal/database/ -run TestSchemaSnapshot", golden, dump)
	}
}

func TestOpenDBRunsGooseMigrations(t *testing.T) {
	s := testDB(t)
	var version int64
	err := s.db.QueryRowContext(context.Background(), "SELECT MAX(version_id) FROM goose_db_version").Scan(&version)
	must.NoErr(t, err)
	if version != 2 {
		t.Fatalf("goose db version = %d, want 2", version)
	}
}

type column struct {
	cid  int
	name string
	typ  string
	pk   int
	notN bool
	dflt sql.Null[string]
}

type foreignKey struct {
	from     string
	to       string
	refTable string
	onDelete string
	onUpdate string
}

type schemaTable struct {
	name string
	sql  string
}

func dumpSchema(ctx context.Context, store *DB) (string, error) {
	tables, err := listTables(ctx, store)
	if err != nil {
		return "", fmt.Errorf("list tables: %w", err)
	}

	expIdxs, err := listExplicitIndexes(ctx, store)
	if err != nil {
		return "", fmt.Errorf("list indexes: %w", err)
	}
	triggers, err := listTriggers(ctx, store)
	if err != nil {
		return "", fmt.Errorf("list triggers: %w", err)
	}
	views, err := listViews(ctx, store)
	if err != nil {
		return "", fmt.Errorf("list views: %w", err)
	}

	var sb strings.Builder
	sb.WriteString("-- Schema snapshot for tallyo\n")
	sb.WriteString("-- Auto-generated; do not edit directly.\n")
	sb.WriteString("-- Regenerate with: UPDATE_SCHEMA_SNAPSHOT=1 go test ./internal/database/ -run TestSchemaSnapshot\n")
	sb.WriteString("\n")

	byTblName := func(idx explicitIndex) string { return idx.tblName }
	idxByTable := lo.GroupBy(expIdxs, byTblName)

	for _, table := range tables {
		if isVirtualTableSQL(table.sql) {
			sb.WriteString(table.sql)
			sb.WriteString(";\n\n")
			continue
		}

		cols, err := loadColumns(ctx, store, table.name)
		if err != nil {
			return "", fmt.Errorf("columns for %s: %w", table.name, err)
		}
		sort.Slice(cols, func(i, j int) bool { return cols[i].name < cols[j].name })

		fks, err := loadForeignKeys(ctx, store, table.name)
		if err != nil {
			return "", fmt.Errorf("foreign keys for %s: %w", table.name, err)
		}

		composites, err := loadCompositeUniques(ctx, store, table.name)
		if err != nil {
			return "", fmt.Errorf("composite uniques for %s: %w", table.name, err)
		}

		ddl := buildTableDDL(table.name, cols, fks, composites, table.sql)
		sb.WriteString(ddl)
		sb.WriteString(";\n\n")

		for _, idx := range idxByTable[table.name] {
			sb.WriteString(idx.sql)
			sb.WriteString(";\n\n")
		}
	}

	for _, view := range views {
		sb.WriteString(view.sql)
		sb.WriteString(";\n\n")
	}

	for _, trigger := range triggers {
		sb.WriteString(trigger.sql)
		sb.WriteString(";\n\n")
	}

	return sb.String(), nil
}

func listTables(ctx context.Context, store *DB) ([]schemaTable, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'goose_db_version' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	tables := []schemaTable{}
	virtualTables := []string{}
	for rows.Next() {
		var table schemaTable
		if err := rows.Scan(&table.name, &table.sql); err != nil {
			return nil, err
		}
		if isVirtualTableSQL(table.sql) {
			virtualTables = append(virtualTables, table.name)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]schemaTable, 0, len(tables))
	for _, table := range tables {
		if isVirtualTableShadow(table.name, virtualTables) {
			continue
		}
		out = append(out, table)
	}
	return out, nil
}

func listViews(ctx context.Context, store *DB) ([]schemaTable, error) {
	return queryRows(
		ctx,
		store.db,
		`SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name`,
		func(rows *sql.Rows) (schemaTable, error) {
			var view schemaTable
			return view, rows.Scan(&view.name, &view.sql)
		},
	)
}

func queryRows[T any](ctx context.Context, db *sql.DB, query string, scan func(*sql.Rows) (T, error)) ([]T, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []T{}
	for rows.Next() {
		row, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func isVirtualTableSQL(rawSQL string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(rawSQL)), "CREATE VIRTUAL TABLE")
}

func isVirtualTableShadow(name string, virtualTables []string) bool {
	isShadow := func(virtualTable string) bool { return strings.HasPrefix(name, virtualTable+"_") }
	return slices.ContainsFunc(virtualTables, isShadow)
}

func loadColumns(ctx context.Context, store *DB, table string) ([]column, error) {
	return queryRows(
		ctx,
		store.db,
		`PRAGMA table_info(`+table+`)`,
		func(rows *sql.Rows) (column, error) {
			var c column
			return c, rows.Scan(&c.cid, &c.name, &c.typ, &c.notN, &c.dflt, &c.pk)
		},
	)
}

func loadForeignKeys(ctx context.Context, store *DB, table string) ([]foreignKey, error) {
	return queryRows(
		ctx,
		store.db,
		`PRAGMA foreign_key_list(`+table+`)`,
		func(rows *sql.Rows) (foreignKey, error) {
			var id, seq int
			var match string
			var fk foreignKey
			return fk, rows.Scan(&id, &seq, &fk.refTable, &fk.from, &fk.to, &fk.onUpdate, &fk.onDelete, &match)
		},
	)
}

// loadCompositeUniques returns column lists for multi-column UNIQUE table
// constraints. SQLite backs these with an auto-generated index (origin='u')
// that carries no `sql` in sqlite_master, so listExplicitIndexes can't see
// them and single-column UNIQUE detection (columnHasUnique) doesn't apply.
func loadCompositeUniques(ctx context.Context, store *DB, table string) ([][]string, error) {
	rows, err := store.db.QueryContext(ctx, `PRAGMA index_list(`+table+`)`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var names []string
	for rows.Next() {
		var seq int
		var name, origin string
		var unique, partial bool
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return nil, err
		}
		if unique && origin == "u" {
			names = append(names, name)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var out [][]string
	for _, name := range names {
		cols, err := loadIndexColumns(ctx, store, name)
		if err != nil {
			return nil, err
		}
		if len(cols) > 1 {
			out = append(out, cols)
		}
	}
	return out, nil
}

func loadIndexColumns(ctx context.Context, store *DB, index string) ([]string, error) {
	return queryRows(
		ctx,
		store.db,
		`PRAGMA index_info(`+index+`)`,
		func(rows *sql.Rows) (string, error) {
			var seqno, cid int
			var name string
			return name, rows.Scan(&seqno, &cid, &name)
		},
	)
}

type explicitIndex struct {
	name    string
	tblName string
	sql     string
}

func listExplicitIndexes(ctx context.Context, store *DB) ([]explicitIndex, error) {
	return queryRows(
		ctx,
		store.db,
		`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`,
		func(rows *sql.Rows) (explicitIndex, error) {
			var e explicitIndex
			return e, rows.Scan(&e.name, &e.tblName, &e.sql)
		},
	)
}

func listTriggers(ctx context.Context, store *DB) ([]schemaTable, error) {
	return queryRows(
		ctx,
		store.db,
		`SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name`,
		func(rows *sql.Rows) (schemaTable, error) {
			var trigger schemaTable
			return trigger, rows.Scan(&trigger.name, &trigger.sql)
		},
	)
}

func hasAutoincrement(origSQL string) bool {
	return strings.Contains(strings.ToUpper(origSQL), "AUTOINCREMENT")
}

func extractCheckConstraints(origSQL string) []string {
	re := regexp.MustCompile(`(?i)CHECK\s*\(`)
	starts := re.FindAllStringIndex(origSQL, -1)
	matches := make([]string, 0, len(starts))
	for _, start := range starts {
		if constraint, ok := balancedCheckConstraint(origSQL, start[0], start[1]-1); ok {
			matches = append(matches, constraint)
		}
	}
	if len(matches) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, m := range matches {
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	sort.Strings(out)
	return out
}

func balancedCheckConstraint(sql string, checkStart, openParen int) (string, bool) {
	depth := 0
	inQuote := false
	for i := openParen; i < len(sql); i++ {
		switch sql[i] {
		case '\'':
			inQuote = !inQuote
		case '(':
			if !inQuote {
				depth++
			}
		case ')':
			if !inQuote {
				depth--
				if depth == 0 {
					return sql[checkStart : i+1], true
				}
			}
		}
	}
	return "", false
}

// columnHasUnique returns true if the column definition in the original CREATE
// TABLE statement contains the UNIQUE keyword.
func columnHasUnique(origSQL, colName string) bool {
	if origSQL == "" {
		return false
	}
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(colName) + `\b\s+[^,;)]+`)
	m := re.FindString(origSQL)
	return strings.Contains(strings.ToUpper(m), "UNIQUE")
}

func buildTableDDL(name string, cols []column, fks []foreignKey, composites [][]string, origSQL string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "CREATE TABLE %s (\n", name)

	fkByCol := buildFKMap(fks)
	pkCols := pkColumnList(cols)
	compositePK := len(pkCols) > 1
	checks := extractCheckConstraints(origSQL)

	for i, c := range cols {
		sb.WriteString("    ")
		sb.WriteString(c.name)
		sb.WriteString(" ")
		sb.WriteString(c.typ)

		if c.notN {
			sb.WriteString(" NOT NULL")
		}

		if c.dflt.Valid {
			sb.WriteString(" DEFAULT ")
			sb.WriteString(sqliteDefaultExpr(c.dflt.V))
		}

		if c.pk > 0 && !compositePK {
			sb.WriteString(" PRIMARY KEY")
			if hasAutoincrement(origSQL) {
				sb.WriteString(" AUTOINCREMENT")
			}
		}

		if columnHasUnique(origSQL, c.name) {
			sb.WriteString(" UNIQUE")
		}

		if fk, ok := fkByCol[c.name]; ok {
			fmt.Fprintf(&sb, " REFERENCES %s(%s)", fk.refTable, fk.to)
			if fk.onDelete != "" && !strings.EqualFold(fk.onDelete, "NO ACTION") {
				fmt.Fprintf(&sb, " ON DELETE %s", fk.onDelete)
			}
			if fk.onUpdate != "" && !strings.EqualFold(fk.onUpdate, "NO ACTION") {
				fmt.Fprintf(&sb, " ON UPDATE %s", fk.onUpdate)
			}
		}

		// Decide whether a comma is needed after this line.
		needsComma := i < len(cols)-1 || compositePK || len(checks) > 0 || len(composites) > 0
		if needsComma {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}

	if compositePK {
		sb.WriteString("    PRIMARY KEY (")
		for j, p := range pkCols {
			if j > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(p)
		}
		sb.WriteString(")")
		if len(checks) > 0 || len(composites) > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}

	for i, chk := range checks {
		sb.WriteString("    ")
		sb.WriteString(chk)
		if i < len(checks)-1 || len(composites) > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}

	for i, cols := range composites {
		fmt.Fprintf(&sb, "    UNIQUE(%s)", strings.Join(cols, ", "))
		if i < len(composites)-1 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}

	sb.WriteString(")")
	return sb.String()
}

func sqliteDefaultExpr(expr string) string {
	if strings.Contains(expr, "(") && !strings.HasPrefix(expr, "(") {
		return "(" + expr + ")"
	}
	return expr
}

func buildFKMap(fks []foreignKey) map[string]foreignKey {
	m := make(map[string]foreignKey, len(fks))
	for _, fk := range fks {
		m[fk.from] = fk
	}
	return m
}

func pkColumnList(cols []column) []string {
	type pkEntry struct {
		name string
		ord  int
	}
	var pks []pkEntry
	for _, c := range cols {
		if c.pk > 0 {
			pks = append(pks, pkEntry{c.name, c.pk})
		}
	}
	sort.Slice(pks, func(i, j int) bool { return pks[i].ord < pks[j].ord })
	var out []string
	for _, p := range pks {
		out = append(out, p.name)
	}
	return out
}
