package yfinance

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	_ "embed"

	"github.com/samber/lo"
)

//go:embed category_map.csv
var categoryMapCSV string

var (
	categoryMapOnce sync.Once
	categoryMap     map[string]string
	categoryMapErr  error
)

func morningstarGroup(category string, log *slog.Logger) string {
	categoryMapOnce.Do(func() {
		categoryMap, categoryMapErr = loadCategoryMap(categoryMapCSV)
	})
	if categoryMapErr != nil {
		log.Warn("load Morningstar category map", "error", categoryMapErr)
		return "Uncategorized"
	}
	group, ok := categoryMap[normalizeCategory(category)]
	if !ok {
		log.Warn("unknown Morningstar category", "category", category)
		return "Uncategorized"
	}
	return group
}

func loadCategoryMap(raw string) (map[string]string, error) {
	reader := csv.NewReader(strings.NewReader(raw))
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read category map: %w", err)
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("category map is empty")
	}
	toGroupByCategory := func(record []string) (string, string, bool) {
		if len(record) < 2 {
			return "", "", false
		}
		category := normalizeCategory(record[0])
		group := strings.TrimSpace(record[1])
		if category != "" && group != "" {
			return category, group, true
		}
		return "", "", false
	}
	return lo.FilterSliceToMap(records[1:], toGroupByCategory), nil
}

func normalizeCategory(category string) string {
	return strings.ToLower(strings.TrimSpace(category))
}
