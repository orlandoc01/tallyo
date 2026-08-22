// Package must provides fail-fast helpers for test fixture setup.
package must

import "testing"

// NoErr fails the test immediately when err is non-nil.
func NoErr(tb testing.TB, err error) {
	tb.Helper()
	if err != nil {
		tb.Fatal(err)
	}
}
