package transactionsdb

import (
	"context"
	"regexp"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

var tagColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (s *Store) Tags(ctx context.Context) ([]*model.Tag, error) {
	rows, err := s.q.ListTags(ctx, dbgen.ListTagsParams{})
	return dbutil.MapRows(rows, err, tagFromRow)
}

func (s *Store) TagByID(ctx context.Context, id int64) (*model.Tag, error) {
	rows, err := s.q.ListTags(ctx, dbgen.ListTagsParams{ID: &id})
	return dbutil.MapFirstRow(rows, err, tagFromRow)
}

func (s *Store) CreateTag(ctx context.Context, input model.CreateTagInput) (*model.Tag, error) {
	if err := validateTagColor(input.Color); err != nil {
		return nil, err
	}
	row, err := s.q.CreateTag(ctx, dbgen.CreateTagParams{Name: input.Name, Color: input.Color})
	if err != nil {
		return nil, err
	}
	return tagFromRow(row), nil
}

func (s *Store) UpdateTag(ctx context.Context, input model.UpdateTagInput) (*model.Tag, error) {
	if err := validateTagColor(input.Color); err != nil {
		return nil, err
	}
	id := input.ID.Int64()
	row, err := s.q.UpdateTag(ctx, dbgen.UpdateTagParams{ID: id, Name: input.Name, Color: input.Color})
	return dbutil.MapRow(row, err, tagFromRow)
}

func (s *Store) DeleteTag(ctx context.Context, id int64) (bool, error) {
	rows, err := s.q.DeleteTag(ctx, dbgen.DeleteTagParams{ID: id})
	return dbutil.RowsAffected(rows, err)
}

func (s *Store) TagsByTransactionIDs(ctx context.Context, transactionIDs []int64) (map[int64][]*model.Tag, error) {
	rows, err := s.q.TagsByTransactionIDs(ctx, dbgen.TagsByTransactionIDsParams{TransactionIds: transactionIDs})
	toTransactionTag := func(row dbgen.TagsByTransactionIDsRow) (int64, *model.Tag) {
		return row.TransactionID, tagFromRow(row.Tag)
	}
	return dbutil.GroupRows(rows, err, toTransactionTag)
}

func (s *Store) TagsByRuleIDs(ctx context.Context, ruleIDs []int64) (map[int64][]*model.Tag, error) {
	rows, err := s.q.TagsByRuleIDs(ctx, dbgen.TagsByRuleIDsParams{RuleIds: ruleIDs})
	toRuleTag := func(row dbgen.TagsByRuleIDsRow) (int64, *model.Tag) {
		return row.RuleID, tagFromRow(row.Tag)
	}
	return dbutil.GroupRows(rows, err, toRuleTag)
}

func tagFromRow(row dbgen.Tag) *model.Tag {
	return &model.Tag{
		ID:               model.New(model.GlobalIDTag, row.ID),
		Name:             row.Name,
		Color:            row.Color,
		TransactionCount: int32(row.TransactionCount),
	}
}

func validateTagColor(color string) error {
	if !tagColorPattern.MatchString(color) {
		return apierror.Publicf("tag color must be a #RRGGBB hex value")
	}
	return nil
}
