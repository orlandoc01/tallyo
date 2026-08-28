package transactionsdb

import (
	"cmp"
	"context"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

const maxSpendingPeriods = 400

func (s *Store) SpendingByCategory(ctx context.Context, filter model.SpendingFilter) (*model.SpendingByCategoryReport, error) {
	loc, err := spendingLocation(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateSpendingPeriodCount(filter, loc); err != nil {
		return nil, err
	}
	transactions, err := s.spendingTransactions(ctx, filter, true)
	if err != nil {
		return nil, err
	}
	categories, err := s.spendingReportCategories(ctx, filter)
	if err != nil {
		return nil, err
	}
	return buildSpendingReport(transactions, categories, filter, loc), nil
}

func (s *Store) spendingReportCategories(ctx context.Context, filter model.SpendingFilter) ([]*model.Category, error) {
	params := dbgen.ListCategoriesParams{ExpenseOnly: true, CategoryIds: model.LocalInt64IDsPtr(filter.CategoryIds)}
	rows, err := s.q.ListCategories(ctx, params)
	return dbutil.MapRows(rows, err, CategoryFromRow)
}

func buildSpendingReport(transactions []spendingTransaction, categories []*model.Category, filter model.SpendingFilter, loc *time.Location) *model.SpendingByCategoryReport {
	periods := spendingReportPeriods(filter, loc)
	report := &model.SpendingByCategoryReport{Periods: periods}
	periodsByLabel := spendingPeriodsByLabel(periods)
	categoriesByID, categoryPeriodsByID, categoryOrder := spendingCategoryAggregates(categories, periods)

	for _, transaction := range transactions {
		report.TotalAmount += transaction.AmountCents
		report.TransactionCount++
		category, added := addSpendingCategoryAggregate(categoriesByID, categoryPeriodsByID, transaction.Category, periods)
		if added {
			categoryOrder = append(categoryOrder, category.Category.ID.Int64())
		}
		if category != nil {
			category.TotalAmount += transaction.AmountCents
			category.TransactionCount++
		}
		if filter.Granularity != nil {
			addTransactionPeriod(transaction, *filter.Granularity, loc, periodsByLabel, categoryPeriodsByID)
		}
	}

	report.Categories = make([]*model.CategorySpendingAggregate, 0, len(categoryOrder))
	for _, categoryID := range categoryOrder {
		category := categoriesByID[categoryID]
		if report.TotalAmount != 0 {
			category.PercentOfTotal = category.TotalAmount.Dollars() / report.TotalAmount.Dollars() * 100
		}
		for _, period := range category.Periods {
			if rootPeriod := periodsByLabel[period.PeriodLabel]; rootPeriod != nil && rootPeriod.TotalAmount != 0 {
				period.PercentOfTotal = period.TotalAmount.Dollars() / rootPeriod.TotalAmount.Dollars() * 100
			}
		}
		report.Categories = append(report.Categories, category)
	}
	return report
}

func validateSpendingPeriodCount(filter model.SpendingFilter, loc *time.Location) error {
	if spendingPeriodCount(filter, loc) <= maxSpendingPeriods {
		return nil
	}
	return apierror.Publicf("spending report supports at most %d periods", maxSpendingPeriods)
}

func spendingPeriodCount(filter model.SpendingFilter, loc *time.Location) int {
	if filter.Granularity == nil || filter.DatetimeRange == nil || filter.DatetimeRange.From == nil || filter.DatetimeRange.To == nil {
		return 0
	}
	from := filter.DatetimeRange.From.In(loc)
	toDay := periodStart(filter.DatetimeRange.To.In(loc), model.GranularityDaily)
	to := toDay.Add(-time.Nanosecond)
	if to.Before(from) {
		return 0
	}
	granularity := *filter.Granularity
	end := periodStart(to, granularity)
	count := 0
	for current := periodStart(from, granularity); !current.After(end); current = nextPeriodStart(current, granularity) {
		count++
		if count > maxSpendingPeriods {
			return count
		}
	}
	return count
}

func spendingReportPeriods(filter model.SpendingFilter, loc *time.Location) []*model.SpendingAggregatePeriod {
	if filter.Granularity == nil || filter.DatetimeRange == nil || filter.DatetimeRange.From == nil || filter.DatetimeRange.To == nil {
		return nil
	}
	from := filter.DatetimeRange.From.In(loc)
	toLocal := filter.DatetimeRange.To.In(loc)
	// The to datetime is an exclusive upper bound ("start of day after dateTo").
	// Truncate to local midnight before subtracting one instant so that a timezone
	// difference between the client and server does not push to into the next period.
	toDay := periodStart(toLocal, model.GranularityDaily)
	to := toDay.Add(-time.Nanosecond)
	if to.Before(from) {
		return nil
	}

	granularity := *filter.Granularity
	end := periodStart(to, granularity)
	periods := []*model.SpendingAggregatePeriod{}
	for current := periodStart(from, granularity); !current.After(end); current = nextPeriodStart(current, granularity) {
		label, start, end := periodForTime(current, granularity)
		periods = append(periods, &model.SpendingAggregatePeriod{PeriodLabel: label, PeriodStart: start, PeriodEnd: end})
	}
	return periods
}

func spendingPeriodsByLabel(periods []*model.SpendingAggregatePeriod) map[string]*model.SpendingAggregatePeriod {
	toPeriodByLabel := func(period *model.SpendingAggregatePeriod) (string, *model.SpendingAggregatePeriod) {
		return period.PeriodLabel, period
	}
	return lo.SliceToMap(periods, toPeriodByLabel)
}

func spendingCategoryAggregates(categories []*model.Category, periods []*model.SpendingAggregatePeriod) (map[int64]*model.CategorySpendingAggregate, map[int64]map[string]*model.CategorySpendingPeriod, []int64) {
	categoriesByID := make(map[int64]*model.CategorySpendingAggregate, len(categories))
	periodsByCategoryID := make(map[int64]map[string]*model.CategorySpendingPeriod, len(categories))
	categoryOrder := make([]int64, 0, len(categories))
	for _, category := range categories {
		if _, added := addSpendingCategoryAggregate(categoriesByID, periodsByCategoryID, category, periods); added {
			categoryOrder = append(categoryOrder, category.ID.Int64())
		}
	}
	return categoriesByID, periodsByCategoryID, categoryOrder
}

func addSpendingCategoryAggregate(
	categoriesByID map[int64]*model.CategorySpendingAggregate,
	periodsByCategoryID map[int64]map[string]*model.CategorySpendingPeriod,
	category *model.Category,
	periods []*model.SpendingAggregatePeriod,
) (*model.CategorySpendingAggregate, bool) {
	if category == nil {
		return nil, false
	}
	categoryID := category.ID.Int64()
	if aggregate := categoriesByID[categoryID]; aggregate != nil {
		return aggregate, false
	}
	aggregate := &model.CategorySpendingAggregate{Category: category, Periods: categoryPeriodCopies(periods)}
	categoriesByID[categoryID] = aggregate
	periodsByCategoryID[categoryID] = categoryPeriodsByLabel(aggregate.Periods)
	return aggregate, true
}

func addTransactionPeriod(
	transaction spendingTransaction,
	granularity model.Granularity,
	loc *time.Location,
	periodsByLabel map[string]*model.SpendingAggregatePeriod,
	periodsByCategoryID map[int64]map[string]*model.CategorySpendingPeriod,
) {
	label, _, _ := periodForTime(transaction.Datetime.In(loc), granularity)
	if period := periodsByLabel[label]; period != nil {
		period.TotalAmount += transaction.AmountCents
		period.TransactionCount++
	}
	if transaction.Category == nil {
		return
	}
	if categoryPeriod := periodsByCategoryID[transaction.Category.ID.Int64()][label]; categoryPeriod != nil {
		categoryPeriod.TotalAmount += transaction.AmountCents
		categoryPeriod.TransactionCount++
	}
}

func categoryPeriodCopies(periods []*model.SpendingAggregatePeriod) []*model.CategorySpendingPeriod {
	toCategoryPeriod := func(period *model.SpendingAggregatePeriod) *model.CategorySpendingPeriod {
		return &model.CategorySpendingPeriod{PeriodLabel: period.PeriodLabel, PeriodStart: period.PeriodStart, PeriodEnd: period.PeriodEnd}
	}
	return u.Map(periods, toCategoryPeriod)
}

func categoryPeriodsByLabel(periods []*model.CategorySpendingPeriod) map[string]*model.CategorySpendingPeriod {
	toPeriodByLabel := func(period *model.CategorySpendingPeriod) (string, *model.CategorySpendingPeriod) {
		return period.PeriodLabel, period
	}
	return lo.SliceToMap(periods, toPeriodByLabel)
}

func periodStart(t time.Time, granularity model.Granularity) time.Time {
	year, month, day := t.Date()
	switch granularity {
	case model.GranularityDaily:
		return time.Date(year, month, day, 0, 0, 0, 0, t.Location())
	case model.GranularityWeekly:
		dow := cmp.Or(int(t.Weekday()), 7)
		monday := t.AddDate(0, 0, 1-dow)
		return time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, t.Location())
	case model.GranularityQuarterly:
		startMonth := time.Month(((int(month)-1)/3)*3 + 1)
		return time.Date(year, startMonth, 1, 0, 0, 0, 0, t.Location())
	case model.GranularityYearly:
		return time.Date(year, 1, 1, 0, 0, 0, 0, t.Location())
	default:
		return time.Date(year, month, 1, 0, 0, 0, 0, t.Location())
	}
}

func nextPeriodStart(t time.Time, granularity model.Granularity) time.Time {
	switch granularity {
	case model.GranularityDaily:
		return t.AddDate(0, 0, 1)
	case model.GranularityWeekly:
		return t.AddDate(0, 0, 7)
	case model.GranularityQuarterly:
		return t.AddDate(0, 3, 0)
	case model.GranularityYearly:
		return t.AddDate(1, 0, 0)
	default:
		return t.AddDate(0, 1, 0)
	}
}
