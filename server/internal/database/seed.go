package database

import (
	"context"
	"database/sql"
	_ "embed"
	"strings"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/transactions/pfc2"
)

//go:embed seed-categories.md
var seedData string

type seedCategory struct {
	Name           string
	Emoji          string
	GroupName      string
	GroupEmoji     string
	Kind           string // "EXPENSE", "INCOME", or "TRANSFER"
	PlaidPFC2Codes []string
}

const (
	SentinelCategoryGroupID = 0
	SentinelCategoryID      = 0
	SentinelSortOrder       = 2147483647
	sentinelEmoji           = "❓"
)

func (s *DB) seedReferenceCategories(ctx context.Context) error {
	q := dbgen.New(s.db)
	count, err := q.CountSentinelCategories(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := upsertSentinelCategories(ctx, q); err != nil {
			return err
		}
		if err := seedCategories(ctx, q); err != nil {
			return err
		}
		return seedPlaidMappings(ctx, q)
	})
}

func upsertSentinelCategories(ctx context.Context, q *dbgen.Queries) error {
	if err := q.UpsertSentinelCategoryGroup(ctx, dbgen.UpsertSentinelCategoryGroupParams{
		ID:        SentinelCategoryGroupID,
		Name:      "Other",
		Emoji:     sentinelEmoji,
		Kind:      "EXPENSE",
		SortOrder: SentinelSortOrder,
	}); err != nil {
		return err
	}
	return q.UpsertSentinelCategory(ctx, dbgen.UpsertSentinelCategoryParams{
		ID:        SentinelCategoryID,
		Name:      "uncategorized",
		Emoji:     sentinelEmoji,
		SortOrder: SentinelSortOrder,
		GroupID:   SentinelCategoryGroupID,
	})
}

func seedCategories(ctx context.Context, q *dbgen.Queries) error {
	count, err := q.CountNonSentinelCategories(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	categories := parseSeedCategories(seedData)

	groupOrder, groups := seedCategoryGroups(categories)
	groupIDs := map[string]int64{}
	for _, name := range groupOrder {
		if name == "Other" {
			groupIDs[name] = SentinelCategoryGroupID
			continue
		}
		g := groups[name]
		id, err := q.CreateCategoryGroup(ctx, dbgen.CreateCategoryGroupParams{Name: g.Name, Emoji: g.Emoji, Kind: g.Kind, SortOrder: int64(g.SortOrder + 1)})
		if err != nil {
			return err
		}
		groupIDs[name] = id
	}

	for i, category := range categories {
		groupID := groupIDs[category.GroupName]
		categoryID, err := q.CreateSeedCategory(ctx, dbgen.CreateSeedCategoryParams{
			Name:      category.Name,
			Emoji:     category.Emoji,
			GroupID:   groupID,
			SortOrder: int64(i),
		})
		if err != nil {
			return err
		}
		for _, code := range category.PlaidPFC2Codes {
			if err := q.UpsertCategoryPlaidMapping(ctx, dbgen.UpsertCategoryPlaidMappingParams{PlaidDetailed: code, CategoryID: categoryID}); err != nil {
				return err
			}
		}
	}
	return nil
}

func seedPlaidMappings(ctx context.Context, q *dbgen.Queries) error {
	categories := parseSeedCategories(seedData)
	if err := q.UpsertCategoryPlaidMapping(ctx, dbgen.UpsertCategoryPlaidMappingParams{PlaidDetailed: "OTHER_OTHER", CategoryID: SentinelCategoryID}); err != nil {
		return err
	}
	for _, cat := range categories {
		for _, code := range cat.PlaidPFC2Codes {
			if err := q.UpsertCategoryPlaidMappingByCategoryName(ctx, dbgen.UpsertCategoryPlaidMappingByCategoryNameParams{PlaidDetailed: code, CategoryName: cat.Name}); err != nil {
				return err
			}
		}
	}
	return nil
}

type seedGroup struct {
	Name      string
	Emoji     string
	Kind      string
	SortOrder int
}

func seedCategoryGroups(categories []seedCategory) ([]string, map[string]seedGroup) {
	groupOrder := []string{}
	groups := map[string]seedGroup{}
	for i, cat := range categories {
		if _, seen := groups[cat.GroupName]; !seen {
			groups[cat.GroupName] = seedGroup{Name: cat.GroupName, Emoji: cat.GroupEmoji, Kind: cat.Kind, SortOrder: i}
			groupOrder = append(groupOrder, cat.GroupName)
		}
	}
	return groupOrder, groups
}

func parseSeedCategories(markdown string) []seedCategory {
	var categories []seedCategory
	groupName, groupEmoji := "Other", "?"
	for raw := range strings.SplitSeq(markdown, "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(line, "## "):
			groupEmoji, groupName = splitEmojiName(strings.TrimPrefix(line, "## "))
		case strings.HasPrefix(line, "- "):
			categoryText, codesText, _ := strings.Cut(strings.TrimPrefix(line, "- "), "|")
			emoji, name := splitEmojiName(strings.TrimSpace(categoryText))
			if name == "Uncategorized" {
				continue
			}
			kind := categoryKindForGroup(groupName)
			categories = append(categories, seedCategory{
				Name:           name,
				Emoji:          emoji,
				GroupName:      groupName,
				GroupEmoji:     groupEmoji,
				Kind:           kind,
				PlaidPFC2Codes: pfc2.Normalize(strings.Split(codesText, ",")),
			})
		}
	}
	return categories
}

func categoryKindForGroup(groupName string) string {
	switch groupName {
	case "Income":
		return "INCOME"
	case "Transfers":
		return "TRANSFER"
	default:
		return "EXPENSE"
	}
}

func splitEmojiName(s string) (string, string) {
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return "?", s
	}
	return parts[0], strings.TrimSpace(strings.TrimPrefix(s, parts[0]))
}
