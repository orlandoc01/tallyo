package transactionsdb

import (
	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

type ruleChanges struct {
	categoryID        *int64
	merchantName      *string
	tagIDs            []int64
	shouldHide        *bool
	shouldBeRecurring *bool
}

func ruleChangesFromUpdates(updates *model.TransactionUpdates) (ruleChanges, error) {
	if updates == nil {
		return ruleChanges{}, apierror.Publicf("changes is required")
	}
	var categoryID *int64
	if updates.CategoryID != nil {
		id := updates.CategoryID.Int64()
		categoryID = &id
	}
	tagIDs, err := model.LocalInt64IDsOfTypePtr(updates.TagIds, model.GlobalIDTag)
	if err != nil {
		return ruleChanges{}, err
	}
	return ruleChanges{
		categoryID:        categoryID,
		merchantName:      lo.EmptyableToPtr(trimmed(updates.MerchantName)),
		tagIDs:            tagIDs,
		shouldHide:        updates.IsHidden,
		shouldBeRecurring: updates.IsRecurring,
	}, nil
}

func (c ruleChanges) hasAction() bool {
	return c.categoryID != nil || c.merchantName != nil || len(c.tagIDs) > 0 || c.shouldHide != nil || c.shouldBeRecurring != nil
}
