package mcpserver

import (
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanBudget struct {
	ID           string      `json:"id"`
	Month        string      `json:"month"`
	CategoryID   string      `json:"categoryId"`
	CategoryName string      `json:"categoryName"`
	Amount       money.Cents `json:"amount"`
}

func mapBudget(budget *model.Budget) leanBudget {
	return leanBudget{ID: budget.ID.EncodedString(), Month: budget.Month, CategoryID: budget.Category.ID.EncodedString(), CategoryName: budget.Category.Name, Amount: budget.Amount}
}

type leanBudgetLine struct {
	ID           *string     `json:"id,omitempty"`
	CategoryID   string      `json:"categoryId"`
	CategoryName string      `json:"categoryName"`
	Budgeted     money.Cents `json:"budgeted"`
	Actual       money.Cents `json:"actual"`
	Remaining    money.Cents `json:"remaining"`
}

type leanBudgetSection struct {
	Label     string           `json:"label"`
	GroupID   string           `json:"groupId"`
	GroupName string           `json:"groupName"`
	Budgeted  money.Cents      `json:"budgeted"`
	Actual    money.Cents      `json:"actual"`
	Remaining money.Cents      `json:"remaining"`
	Lines     []leanBudgetLine `json:"lines"`
}

type leanBudgetReport struct {
	Month             string              `json:"month"`
	ExpensesBudgeted  money.Cents         `json:"expensesBudgeted"`
	ExpensesActual    money.Cents         `json:"expensesActual"`
	IncomeBudgeted    money.Cents         `json:"incomeBudgeted"`
	IncomeActual      money.Cents         `json:"incomeActual"`
	RemainingBudgeted money.Cents         `json:"remainingBudgeted"`
	RemainingActual   money.Cents         `json:"remainingActual"`
	Sections          []leanBudgetSection `json:"sections"`
}

func mapBudgetReport(report *model.BudgetReport) *leanBudgetReport {
	toLine := func(l *model.BudgetLine) leanBudgetLine {
		ref := mapCategoryRef(l.Category)
		var id *string
		if l.ID != nil {
			encoded := l.ID.EncodedString()
			id = &encoded
		}
		return leanBudgetLine{
			ID:           id,
			CategoryID:   ref.ID,
			CategoryName: ref.Name,
			Budgeted:     l.Budgeted,
			Actual:       l.Actual,
			Remaining:    l.Remaining,
		}
	}
	toSection := func(s *model.BudgetSection) leanBudgetSection {
		return leanBudgetSection{
			Label:     s.Label,
			GroupID:   s.Group.ID.EncodedString(),
			GroupName: s.Group.Name,
			Budgeted:  s.Budgeted,
			Actual:    s.Actual,
			Remaining: s.Remaining,
			Lines:     u.Map(s.Lines, toLine),
		}
	}
	return &leanBudgetReport{
		Month:             report.Month,
		ExpensesBudgeted:  report.ExpensesBudgeted,
		ExpensesActual:    report.ExpensesActual,
		IncomeBudgeted:    report.IncomeBudgeted,
		IncomeActual:      report.IncomeActual,
		RemainingBudgeted: report.RemainingBudgeted,
		RemainingActual:   report.RemainingActual,
		Sections:          u.Map(report.Sections, toSection),
	}
}
