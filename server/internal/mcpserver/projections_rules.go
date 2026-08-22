package mcpserver

import (
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanRecurringCharge struct {
	ID               string                      `json:"id"`
	MerchantName     string                      `json:"merchantName"`
	EstimatedAmount  money.Cents                 `json:"estimatedAmount"`
	Interval         *model.RecurrenceInterval   `json:"interval,omitempty"`
	CategoryID       *string                     `json:"categoryId,omitempty"`
	CategoryName     *string                     `json:"categoryName,omitempty"`
	Transactions     []leanTransaction           `json:"transactions"`
	FirstDate        model.Date                  `json:"firstDate"`
	LastDate         model.Date                  `json:"lastDate"`
	LastAmount       money.Cents                 `json:"lastAmount"`
	IsUserModified   bool                        `json:"isUserModified"`
	NextExpectedDate *model.Date                 `json:"nextExpectedDate,omitempty"`
	Status           model.RecurringStreamStatus `json:"status"`
	IsActive         bool                        `json:"isActive"`
}

func mapRecurringChargeList(list *model.RecurringChargeList) *leanList[leanRecurringCharge] {
	toRecurringCharge := func(rc *model.RecurringCharge) leanRecurringCharge {
		lean := leanRecurringCharge{
			ID:               rc.ID.EncodedString(),
			MerchantName:     rc.MerchantName,
			EstimatedAmount:  rc.EstimatedAmount,
			Interval:         rc.Interval,
			Transactions:     u.Map(rc.Transactions, mapTransaction),
			FirstDate:        rc.FirstDate,
			LastDate:         rc.LastDate,
			LastAmount:       rc.LastAmount,
			IsUserModified:   rc.IsUserModified,
			NextExpectedDate: rc.NextExpectedDate,
			Status:           rc.Status,
			IsActive:         rc.IsActive,
		}
		if rc.Category != nil {
			ref := mapCategoryRef(rc.Category)
			lean.CategoryID, lean.CategoryName = &ref.ID, &ref.Name
		}
		return lean
	}
	return mapList(list.Items, toRecurringCharge)
}

type leanRuleTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type leanRule struct {
	ID                string        `json:"id"`
	MerchantPattern   *string       `json:"merchantPattern,omitempty"`
	OriginalPattern   *string       `json:"originalPattern,omitempty"`
	MerchantName      *string       `json:"merchantName,omitempty"`
	CategoryID        *string       `json:"categoryId,omitempty"`
	CategoryName      *string       `json:"categoryName,omitempty"`
	Tags              []leanRuleTag `json:"tags,omitempty"`
	ShouldHide        *bool         `json:"shouldHide,omitempty"`
	ShouldBeRecurring *bool         `json:"shouldBeRecurring,omitempty"`
	Accounts          []leanAccount `json:"accounts,omitempty"`
	AmountMin         *money.Cents  `json:"amountMin,omitempty"`
	AmountMax         *money.Cents  `json:"amountMax,omitempty"`
	Priority          int32         `json:"priority"`
}

func mapRule(r *model.Rule) leanRule {
	toRuleTag := func(tag *model.Tag) leanRuleTag {
		return leanRuleTag{ID: tag.ID.EncodedString(), Name: tag.Name}
	}
	lean := leanRule{
		ID:                r.ID.EncodedString(),
		MerchantPattern:   r.MerchantPattern,
		OriginalPattern:   r.OriginalPattern,
		MerchantName:      r.MerchantName,
		ShouldHide:        r.ShouldHide,
		ShouldBeRecurring: r.ShouldBeRecurring,
		Accounts:          mapAccounts(r.Accounts),
		AmountMin:         r.AmountMin,
		AmountMax:         r.AmountMax,
		Priority:          r.Priority,
		Tags:              u.Map(r.Tags, toRuleTag),
	}
	if r.Category != nil {
		ref := mapCategoryRef(r.Category)
		lean.CategoryID, lean.CategoryName = &ref.ID, &ref.Name
	}
	return lean
}

func mapRuleList(list *model.RuleList) *leanList[leanRule] {
	return mapList(list.Items, mapRule)
}

type leanRulePayload struct {
	Rule                 leanRule `json:"rule"`
	RetroactivelyUpdated int32    `json:"retroactivelyUpdated"`
}

func mapCreateRulePayload(payload *model.CreateRulePayload) *leanRulePayload {
	return &leanRulePayload{Rule: mapRule(payload.Rule), RetroactivelyUpdated: payload.RetroactivelyUpdated}
}
