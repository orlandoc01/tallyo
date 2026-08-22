package test

import "tallyo/internal/utils/nooplog"

// Logger discards all log output in tests. It re-exports nooplog.Logger so tests
// that already import this package for other helpers keep a single import; tests
// in packages that would import-cycle on this package import nooplog directly.
var Logger = nooplog.Logger
