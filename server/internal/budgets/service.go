package budgets

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

var monthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// maxBudgetReportHistoryMonths bounds distinct months per history request;
// an unbounded range otherwise assembles one full BudgetReport per month.
const maxBudgetReportHistoryMonths = 120

type Service struct {
	Store
	Spending   SpendingProvider
	Categories CategoryProvider
}

// BudgetReportHistory assembles one BudgetReport per month that has budget
// rows in the requested range, fully populated (including sections) so the
// GraphQL BudgetReport.sections field never needs a per-item resolver query.
func (s *Service) BudgetReportHistory(ctx context.Context, input model.BudgetReportHistoryInput) (*model.BudgetReportHistory, error) {
	if input.StartMonth != nil {
		if err := validateMonth(*input.StartMonth); err != nil {
			return nil, apierror.Public(fmt.Errorf("startMonth: %w", err))
		}
	}
	if input.EndMonth != nil {
		if err := validateMonth(*input.EndMonth); err != nil {
			return nil, apierror.Public(fmt.Errorf("endMonth: %w", err))
		}
	}
	if input.StartMonth != nil && input.EndMonth != nil && *input.StartMonth >= *input.EndMonth {
		return nil, apierror.Publicf("startMonth must be before endMonth")
	}

	budgetedByMonth, err := s.BudgetsInRange(ctx, input.StartMonth, input.EndMonth)
	if err != nil {
		return nil, fmt.Errorf("load budgets: %w", err)
	}
	if len(budgetedByMonth) == 0 {
		return &model.BudgetReportHistory{Items: []*model.BudgetReport{}}, nil
	}

	loc, err := budgetReportLocation(ctx)
	if err != nil {
		return nil, err
	}
	months := lo.Keys(budgetedByMonth)
	slices.Sort(months)
	if len(months) > maxBudgetReportHistoryMonths {
		return nil, apierror.Publicf("budget report history spans %d months (max %d); narrow the startMonth/endMonth range", len(months), maxBudgetReportHistoryMonths)
	}
	firstStart, _, err := monthRange(months[0], loc)
	if err != nil {
		return nil, err
	}
	_, lastEnd, err := monthRange(months[len(months)-1], loc)
	if err != nil {
		return nil, err
	}

	actualByMonth, err := s.actualAmountsByMonthCategory(ctx, model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: &firstStart, To: &lastEnd}, Granularity: lo.ToPtr(model.GranularityMonthly)})
	if err != nil {
		return nil, fmt.Errorf("compute actual spend: %w", err)
	}
	groups, err := s.Categories.CategoryGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("load category groups: %w", err)
	}

	slices.Reverse(months)
	toReport := func(month string) *model.BudgetReport {
		return assembleBudgetReport(month, groups, budgetedByMonth[month], actualByMonth[month])
	}
	return &model.BudgetReportHistory{Items: u.Map(months, toReport)}, nil
}

func (s *Service) SetBudget(ctx context.Context, input model.SetBudgetInput) (*model.Budget, error) {
	if err := validateMonth(input.Month); err != nil {
		return nil, apierror.Public(err)
	}
	categoryID := input.CategoryID.Int64()
	if input.Amount < 0 {
		return nil, apierror.Publicf("budget amount must be non-negative")
	}
	category, err := s.Categories.Category(ctx, categoryID)
	if err != nil {
		return nil, fmt.Errorf("load budget category: %w", err)
	}
	if category == nil {
		return nil, apierror.Publicf("category %d not found", categoryID)
	}
	budgetID, err := s.Store.SetBudget(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.Budget{
		ID:       model.New(model.GlobalIDBudget, budgetID),
		Month:    input.Month,
		Category: category,
		Amount:   input.Amount,
	}, nil
}

func (s *Service) CopyBudgets(ctx context.Context, input model.CopyBudgetsInput) (int32, error) {
	if err := validateMonth(input.FromMonth); err != nil {
		return 0, apierror.Public(fmt.Errorf("fromMonth: %w", err))
	}
	if err := validateMonth(input.ToMonth); err != nil {
		return 0, apierror.Public(fmt.Errorf("toMonth: %w", err))
	}
	if input.FromMonth == input.ToMonth {
		return 0, apierror.Publicf("fromMonth and toMonth must differ")
	}
	return s.Store.CopyBudgets(ctx, input)
}

func (s *Service) BudgetReport(ctx context.Context, input model.BudgetReportInput) (*model.BudgetReport, error) {
	if err := validateMonth(input.Month); err != nil {
		return nil, apierror.Public(err)
	}
	loc, err := budgetReportLocation(ctx)
	if err != nil {
		return nil, err
	}
	from, to, err := monthRange(input.Month, loc)
	if err != nil {
		return nil, err
	}

	spendingFilter := model.SpendingFilter{
		DatetimeRange: &model.DateTimeRange{From: &from, To: &to},
	}

	actualByCategory, err := s.actualAmountsByCategory(ctx, input.Month, spendingFilter)
	if err != nil {
		return nil, fmt.Errorf("compute actual spend: %w", err)
	}
	groups, err := s.Categories.CategoryGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("load category groups: %w", err)
	}
	startMonth := input.Month
	endMonth := to.Format("2006-01")
	budgetedByMonth, err := s.BudgetsInRange(ctx, &startMonth, &endMonth)
	if err != nil {
		return nil, fmt.Errorf("load budgets: %w", err)
	}
	budgeted := budgetedByMonth[input.Month]
	if budgeted == nil {
		budgeted = map[int64]BudgetEntry{}
	}
	return assembleBudgetReport(input.Month, groups, budgeted, actualByCategory), nil
}

// actualAmountsByCategory returns one month's actual-spend-by-category map
// from a filter already scoped to that single month.
func (s *Service) actualAmountsByCategory(ctx context.Context, month string, filter model.SpendingFilter) (map[int64]money.Cents, error) {
	byMonth, err := s.actualAmountsByMonthCategory(ctx, filter)
	if err != nil {
		return nil, err
	}
	return byMonth[month], nil
}

// actualAmountsByMonthCategory aggregates actual spend by month then
// category over filter's full date range in one SpendingRows call (monthly
// granularity, the default), so a multi-month history needs no per-month
// query.
func (s *Service) actualAmountsByMonthCategory(ctx context.Context, filter model.SpendingFilter) (map[string]map[int64]money.Cents, error) {
	rows, err := s.Spending.SpendingRows(ctx, filter, transactions.SpendingMode{ByCategory: true})
	if err != nil {
		return nil, err
	}
	byMonth := make(map[string]map[int64]money.Cents)
	for _, row := range rows {
		if row.Category == nil {
			continue
		}
		total := row.TotalCents
		if row.Category.Kind == model.CategoryKindIncome {
			total = -total
		}
		monthEntries := byMonth[row.PeriodLabel]
		if monthEntries == nil {
			monthEntries = make(map[int64]money.Cents)
			byMonth[row.PeriodLabel] = monthEntries
		}
		monthEntries[row.Category.ID.Int64()] = total
	}
	return byMonth, nil
}

func assembleBudgetReport(month string, groups []*model.CategoryGroup, budgeted map[int64]BudgetEntry, actual map[int64]money.Cents) *model.BudgetReport {
	report := &model.BudgetReport{Month: month, Sections: []*model.BudgetSection{}}
	var incomeBudgeted, incomeActual, expensesBudgeted, expensesActual money.Cents
	for _, group := range groups {
		if group.Kind == model.CategoryKindTransfer {
			continue
		}
		section := &model.BudgetSection{Label: group.Name, Group: group}
		var sectionBudgeted, sectionActual money.Cents
		for _, category := range group.Categories {
			categoryID := category.ID.Int64()
			entry := budgeted[categoryID]
			actualAmount := actual[categoryID]
			if entry.AmountCents == 0 && actualAmount == 0 {
				continue
			}
			var budgetID *model.GlobalID
			if entry.ID != 0 {
				id := model.New(model.GlobalIDBudget, entry.ID)
				budgetID = &id
			}
			line := &model.BudgetLine{ID: budgetID, Category: category, Budgeted: entry.AmountCents, Actual: actualAmount, Remaining: (entry.AmountCents - actualAmount)}
			section.Lines = append(section.Lines, line)
			sectionBudgeted += entry.AmountCents
			sectionActual += actualAmount
		}
		section.Budgeted = sectionBudgeted
		section.Actual = sectionActual
		section.Remaining = (sectionBudgeted - sectionActual)
		if len(section.Lines) == 0 && sectionBudgeted == 0 {
			continue
		}
		report.Sections = append(report.Sections, section)
		if group.Kind == model.CategoryKindIncome {
			incomeBudgeted += sectionBudgeted
			incomeActual += sectionActual
		} else {
			expensesBudgeted += sectionBudgeted
			expensesActual += sectionActual
		}
	}
	report.IncomeBudgeted = incomeBudgeted
	report.IncomeActual = incomeActual
	report.ExpensesBudgeted = expensesBudgeted
	report.ExpensesActual = expensesActual
	report.RemainingBudgeted = (incomeBudgeted - expensesBudgeted)
	report.RemainingActual = (incomeActual - expensesActual)
	return report
}

func validateMonth(month string) error {
	if !monthPattern.MatchString(month) {
		return fmt.Errorf("month must be in YYYY-MM format, got %q", month)
	}
	return nil
}

func budgetReportLocation(ctx context.Context) (*time.Location, error) {
	loc, err := time.LoadLocation(u.TimezoneFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("load budget timezone: %w", err)
	}
	return loc, nil
}

func monthRange(month string, loc *time.Location) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation("2006-01", month, loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("parse month %q: %w", month, err)
	}
	return start, start.AddDate(0, 1, 0), nil
}
