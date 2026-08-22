package pfc2

import (
	_ "embed"
	"sort"
	"strings"
	"sync"

	"github.com/samber/lo"
)

//go:embed codes.csv
var codesCSV string

var (
	codesOnce sync.Once
	codes     []string
	codeSet   map[string]struct{}
)

func Codes() []string {
	loadCodes()
	return append([]string(nil), codes...)
}

func Valid(code string) bool {
	loadCodes()
	_, ok := codeSet[normalizeCode(code)]
	return ok
}

func Normalize(input []string) []string {
	normalize := func(code string, _ int) (string, bool) {
		code = normalizeCode(code)
		return code, code != ""
	}
	return lo.Uniq(lo.FilterMap(input, normalize))
}

func loadCodes() {
	codesOnce.Do(func() {
		loaded := Normalize(strings.Split(codesCSV, "\n"))
		sort.Strings(loaded)
		codes = loaded
		codeSet = lo.Keyify(loaded)
	})
}

func normalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}
