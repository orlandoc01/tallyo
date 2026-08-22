package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/ncruces/go-sqlite3"
	sqlite3driver "github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
)

type queryDiagnostics struct {
	FullScanSteps      int
	AutomaticIndexRows int
	Duration           time.Duration
}

type queryDiagnosticsConnector struct {
	driver.Connector
	initialize func(*sqlite3.Conn) error
}

type queryDiagnosticsDriverConn interface {
	sqlite3driver.Conn
	driver.ExecerContext
	driver.NamedValueChecker
}

type queryDiagnosticsConn struct {
	queryDiagnosticsDriverConn
}

type queryDiagnosticsResult struct {
	lastInsertID int64
	rowsAffected int64
}

func openSQLite(dsn string, options OpenOptions) (*sql.DB, error) {
	if !options.WarnFullScans {
		return sqlite3driver.Open(dsn, connectionInitializer(options))
	}
	connector, err := (&sqlite3driver.SQLite{}).OpenConnector(dsn)
	if err != nil {
		return nil, err
	}
	return sql.OpenDB(&queryDiagnosticsConnector{
		Connector:  connector,
		initialize: connectionInitializer(options),
	}), nil
}

func (c *queryDiagnosticsConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	diagnosticConn, ok := conn.(queryDiagnosticsDriverConn)
	if !ok {
		return nil, errors.Join(fmt.Errorf("unexpected sqlite connection type %T", conn), conn.Close())
	}
	if err := c.initialize(diagnosticConn.Raw()); err != nil {
		return nil, errors.Join(err, conn.Close())
	}
	return &queryDiagnosticsConn{queryDiagnosticsDriverConn: diagnosticConn}, nil
}

func (c *queryDiagnosticsConn) ExecContext(
	ctx context.Context,
	query string,
	args []driver.NamedValue,
) (driver.Result, error) {
	if len(args) != 0 || query == "" {
		return c.queryDiagnosticsDriverConn.ExecContext(ctx, query, args)
	}
	raw := c.Raw()
	if old := raw.SetInterrupt(ctx); old != ctx {
		defer raw.SetInterrupt(old)
	}
	for query != "" {
		stmt, tail, err := raw.Prepare(query)
		if err != nil {
			return nil, err
		}
		if stmt == nil {
			break
		}
		err = errors.Join(stmt.Exec(), stmt.Close())
		if err != nil {
			return nil, err
		}
		query = tail
	}
	return newQueryDiagnosticsResult(raw), nil
}

func newQueryDiagnosticsResult(conn *sqlite3.Conn) queryDiagnosticsResult {
	rowsAffected := conn.Changes()
	var lastInsertID int64
	if rowsAffected != 0 {
		lastInsertID = conn.LastInsertRowID()
	}
	return queryDiagnosticsResult{lastInsertID: lastInsertID, rowsAffected: rowsAffected}
}

func (r queryDiagnosticsResult) LastInsertId() (int64, error) { return r.lastInsertID, nil }

func (r queryDiagnosticsResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }

func connectionInitializer(options OpenOptions) func(*sqlite3.Conn) error {
	return func(conn *sqlite3.Conn) error {
		if err := fts5.Register(conn); err != nil {
			return err
		}
		if !options.WarnFullScans {
			return nil
		}
		return conn.Trace(sqlite3.TRACE_PROFILE, traceQueryDiagnostics(options.Logger))
	}
}

func traceQueryDiagnostics(logger *slog.Logger) func(sqlite3.TraceEvent, any, any) error {
	return func(_ sqlite3.TraceEvent, arg1, arg2 any) error {
		stmt := arg1.(*sqlite3.Stmt)
		warnQueryDiagnostics(logger, stmt.SQL(), queryDiagnostics{
			FullScanSteps:      stmt.Status(sqlite3.STMTSTATUS_FULLSCAN_STEP, true),
			AutomaticIndexRows: stmt.Status(sqlite3.STMTSTATUS_AUTOINDEX, true),
			Duration:           time.Duration(arg2.(int64)),
		})
		return nil
	}
}

func warnQueryDiagnostics(logger *slog.Logger, query string, diagnostics queryDiagnostics) {
	if diagnostics.FullScanSteps == 0 && diagnostics.AutomaticIndexRows == 0 {
		return
	}
	logger.Warn("sqlite query used non-indexed work",
		"query", query,
		"full_scan_steps", diagnostics.FullScanSteps,
		"automatic_index_rows", diagnostics.AutomaticIndexRows,
		"duration", diagnostics.Duration,
	)
}
