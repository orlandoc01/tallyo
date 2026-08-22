package budgetsdb

import (
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func categoryFromRow(row dbgen.CategoryRow) *model.Category {
	return &model.Category{
		ID:             model.New(model.GlobalIDCategory, row.CatID),
		Name:           row.CatName,
		Emoji:          row.CatEmoji,
		GroupName:      row.GroupName,
		GroupEmoji:     row.GroupEmoji,
		Kind:           model.CategoryKind(row.GroupKind),
		SortOrder:      int32(row.SortOrder),
		PlaidPFC2Codes: dbutil.SplitCSV(row.PlaidPfc2Codes),
	}
}
