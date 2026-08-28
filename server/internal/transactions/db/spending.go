package transactionsdb

import (
	"cmp"
	"context"
	"fmt"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
)

type spendingTransaction struct {
	AmountCents money.Cents
	Datetime    time.Time
	Category    *model.Category
}

func (s *Store) CashFlow(ctx context.Context, filter model.SpendingFilter) ([]*model.CashFlowPeriod, error) {
	rows, err := s.spendingRows(ctx, filter, transactions.SpendingMode{ByCategory: true})
	if err != nil {
		return nil, err
	}
	return buildCashFlowPeriods(rows), nil
}

// SpendingRows exposes the aggregated spending data publicly. Used by BudgetReport.
func (s *Store) SpendingRows(ctx context.Context, filter model.SpendingFilter, mode transactions.SpendingMode) ([]transactions.SpendingRow, error) {
	return s.spendingRows(ctx, filter, mode)
}

func buildCashFlowPeriods(rows []transactions.SpendingRow) []*model.CashFlowPeriod {
	periods := map[string]*model.CashFlowPeriod{}
	order := []string{}
	for _, row := range rows {
		period := periods[row.PeriodLabel]
		if period == nil {
			period = &model.CashFlowPeriod{PeriodLabel: row.PeriodLabel, PeriodStart: row.PeriodStart, PeriodEnd: row.PeriodEnd, Summary: &model.CashFlowSummary{}}
			periods[row.PeriodLabel] = period
			order = append(order, row.PeriodLabel)
		}
		isIncome := row.Category != nil && row.Category.Kind == model.CategoryKindIncome
		totalCents := row.TotalCents
		if isIncome {
			totalCents = -totalCents
		}
		breakdown := &model.CashFlowBreakdown{Category: row.Category, Total: totalCents, TransactionCount: row.TransactionCount}
		if isIncome {
			period.Summary.Income += totalCents
			period.IncomeByCategory = append(period.IncomeByCategory, breakdown)
		} else {
			period.Summary.Expenses += totalCents
			period.ExpensesByCategory = append(period.ExpensesByCategory, breakdown)
		}
	}
	result := make([]*model.CashFlowPeriod, 0, len(order))
	for _, label := range order {
		p := periods[label]
		p.Summary.Savings = p.Summary.Income - p.Summary.Expenses
		if p.Summary.Income != 0 {
			p.Summary.SavingsRate = p.Summary.Savings.Dollars() / p.Summary.Income.Dollars() * 100
		}
		for _, b := range p.IncomeByCategory {
			if p.Summary.Income != 0 {
				b.PercentOfTotal = b.Total.Dollars() / p.Summary.Income.Dollars() * 100
			}
		}
		for _, b := range p.ExpensesByCategory {
			if p.Summary.Expenses != 0 {
				b.PercentOfTotal = b.Total.Dollars() / p.Summary.Expenses.Dollars() * 100
			}
		}
		result = append(result, p)
	}
	return result
}

func (s *Store) spendingRows(ctx context.Context, filter model.SpendingFilter, mode transactions.SpendingMode) ([]transactions.SpendingRow, error) {
	loc, err := spendingLocation(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateSpendingPeriodCount(filter, loc); err != nil {
		return nil, err
	}
	txns, err := s.spendingTransactions(ctx, filter, mode.ExcludeIncome)
	if err != nil {
		return nil, err
	}
	return aggregateSpendingRows(txns, spendingGranularity(filter), loc, mode.ByCategory), nil
}

func (s *Store) spendingTransactions(ctx context.Context, filter model.SpendingFilter, excludeIncome bool) ([]spendingTransaction, error) {
	if filter.DatetimeRange == nil || filter.DatetimeRange.From == nil || filter.DatetimeRange.To == nil {
		return nil, fmt.Errorf("datetimeRange.from and datetimeRange.to are required")
	}
	params := dbgen.SpendingTransactionsParams{
		DatetimeFrom:  filter.DatetimeRange.From.UTC(),
		DatetimeTo:    filter.DatetimeRange.To.UTC(),
		IsHidden:      filter.IsHidden != nil && *filter.IsHidden,
		Untagged:      filter.Untagged != nil && *filter.Untagged,
		ExcludeIncome: excludeIncome,
		CategoryIds:   model.LocalInt64IDsPtr(filter.CategoryIds),
		TagIds:        model.LocalInt64IDsPtr(filter.TagIds),
	}
	ownerIDs, err := model.LocalInt64IDsOfTypePtr(filter.OwnerIds, model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	params.OwnerIds = ownerIDs
	accountIDs, err := model.LocalInt64IDsOfTypePtr(filter.AccountIds, model.GlobalIDAccount)
	if err != nil {
		return nil, err
	}
	params.AccountIds = accountIDs
	rows, err := s.q.SpendingTransactions(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("query spending transactions: %w", err)
	}
	toTransaction := func(row dbgen.SpendingTransactionsRow) spendingTransaction {
		return spendingTransaction{AmountCents: row.AmountCents, Datetime: row.Datetime, Category: CategoryFromRow(row.CategoryRow)}
	}
	return u.Map(rows, toTransaction), nil
}

func aggregateSpendingRows(txns []spendingTransaction, granularity model.Granularity, loc *time.Location, byCategory bool) []transactions.SpendingRow {
	type key struct {
		Period     string
		CategoryID int64
	}
	rows := map[key]*transactions.SpendingRow{}
	order := []key{}
	for _, transaction := range txns {
		periodLabel, periodStart, periodEnd := periodForTime(transaction.Datetime.In(loc), granularity)
		var categoryID int64
		if byCategory && transaction.Category != nil {
			categoryID = transaction.Category.ID.Int64()
		}
		rowKey := key{Period: periodLabel, CategoryID: categoryID}
		row := rows[rowKey]
		if row == nil {
			row = &transactions.SpendingRow{PeriodLabel: periodLabel, PeriodStart: periodStart, PeriodEnd: periodEnd}
			if byCategory {
				row.Category = transaction.Category
			}
			rows[rowKey] = row
			order = append(order, rowKey)
		}
		row.TotalCents += transaction.AmountCents
		row.TransactionCount++
	}
	toSpendingRow := func(rowKey key) transactions.SpendingRow { return *rows[rowKey] }
	return u.Map(order, toSpendingRow)
}

func spendingGranularity(filter model.SpendingFilter) model.Granularity {
	if filter.Granularity == nil {
		return model.GranularityMonthly
	}
	return *filter.Granularity
}

func spendingLocation(ctx context.Context) (*time.Location, error) {
	loc, err := time.LoadLocation(u.TimezoneFromContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("load spending timezone: %w", err)
	}
	return loc, nil
}

func periodForTime(t time.Time, granularity model.Granularity) (string, model.Date, model.Date) {
	year, month, day := t.Date()
	switch granularity {
	case model.GranularityDaily:
		start := time.Date(year, month, day, 0, 0, 0, 0, t.Location())
		label := start.Format(time.DateOnly)
		return label, model.Date(label), model.Date(label)
	case model.GranularityWeekly:
		dow := cmp.Or(int(t.Weekday()), 7)
		monday := t.AddDate(0, 0, 1-dow)
		start := time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, t.Location())
		end := start.AddDate(0, 0, 6)
		return start.Format(time.DateOnly), model.Date(start.Format(time.DateOnly)), model.Date(end.Format(time.DateOnly))
	case model.GranularityQuarterly:
		quarter := (int(month)-1)/3 + 1
		startMonth := time.Month((quarter-1)*3 + 1)
		start := time.Date(year, startMonth, 1, 0, 0, 0, 0, t.Location())
		end := start.AddDate(0, 3, -1)
		return fmt.Sprintf("%04d-Q%d", year, quarter), model.Date(start.Format(time.DateOnly)), model.Date(end.Format(time.DateOnly))
	case model.GranularityYearly:
		start := time.Date(year, 1, 1, 0, 0, 0, 0, t.Location())
		end := start.AddDate(1, 0, -1)
		return fmt.Sprintf("%04d", year), model.Date(start.Format(time.DateOnly)), model.Date(end.Format(time.DateOnly))
	default:
		start := time.Date(year, month, 1, 0, 0, 0, 0, t.Location())
		end := start.AddDate(0, 1, -1)
		return start.Format("2006-01"), model.Date(start.Format(time.DateOnly)), model.Date(end.Format(time.DateOnly))
	}
}
