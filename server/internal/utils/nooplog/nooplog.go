// Package nooplog provides a no-op *slog.Logger to satisfy a logger dependency
// without producing output. It has zero domain dependencies, so any package can
// import it without risking an import cycle (unlike internal/utils/test, which
// pulls in domain stores). Inject nooplog.Logger wherever a *slog.Logger is
// required so call sites never need a `if log != nil` guard.
package nooplog

import "log/slog"

// Logger discards every record. It is the Null Object for *slog.Logger: always
// safe to call, never nil.
var Logger = slog.New(slog.DiscardHandler)
