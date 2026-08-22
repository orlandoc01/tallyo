package dbutil

import (
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/samber/lo"
)

func IsUniqueConstraintViolation(err error) bool {
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// UsesFTS reports whether every whitespace-delimited search term is long enough
// for a trigram FTS MATCH query (trigram cannot index terms shorter than 3
// runes). Used by trigram-backed indexes (assets) to decide between FTS and a
// literal substring fallback. Token-based indexes (unicode61, e.g. transactions) have no such
// floor and query FTS unconditionally.
func UsesFTS(search string) bool {
	terms := strings.Fields(search)
	if len(terms) == 0 {
		return false
	}
	tooShort := func(term string) bool { return utf8.RuneCountInString(term) < 3 }
	return !slices.ContainsFunc(terms, tooShort)
}

// FTSQuery builds an order-insensitive AND query from literal search terms,
// e.g. `"foo" AND "bar"`. Each term must match exactly (per the tokenizer).
func FTSQuery(search string) string { return ftsTermsQuery(search, "") }

// FTSPrefixQuery builds an order-insensitive AND query where each term is a
// prefix token, e.g. `"foo"* AND "bar"*` — search-as-you-type matching. Requires
// a token-based tokenizer (unicode61); trigram does not support prefix tokens.
func FTSPrefixQuery(search string) string { return ftsTermsQuery(search, "*") }

func ftsTermsQuery(search, suffix string) string {
	quoteTerm := func(term string, _ int) string {
		return `"` + strings.ReplaceAll(term, `"`, `""`) + `"` + suffix
	}
	return strings.Join(lo.Map(strings.Fields(search), quoteTerm), " AND ")
}
