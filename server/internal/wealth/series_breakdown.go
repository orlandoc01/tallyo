package wealth

import (
	"context"
	"sort"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"

	"github.com/samber/lo"
)

var classifierSeriesOrder = []model.AssetClassifier{
	model.AssetClassifierCash,
	model.AssetClassifierPublic,
	model.AssetClassifierCompanyEquity,
	model.AssetClassifierCryptocurrency,
	model.AssetClassifierStablecoin,
	model.AssetClassifierRealEstate,
}

var liabilitySeriesOrder = []model.LiabilityCategory{
	model.LiabilityCategoryCard,
	model.LiabilityCategoryMortgage,
	model.LiabilityCategoryLoan,
	model.LiabilityCategoryOther,
}

var classifierHistoryLabels = map[model.AssetClassifier]string{
	model.AssetClassifierCash:           "Cash & Equivalents",
	model.AssetClassifierPublic:         "Public Assets",
	model.AssetClassifierCompanyEquity:  "Company Equity",
	model.AssetClassifierCryptocurrency: "Crypto",
	model.AssetClassifierStablecoin:     "Stablecoin",
	model.AssetClassifierRealEstate:     "Real Estate",
}

var liabilityHistoryLabels = map[model.LiabilityCategory]string{
	model.LiabilityCategoryCard:     "Credit Card",
	model.LiabilityCategoryMortgage: "Mortgage",
	model.LiabilityCategoryLoan:     "Loan",
}

func (s *Service) classifierSeries(ctx context.Context, input model.HistoricalNetWorthInput, dates []time.Time, tz string) ([]*model.ClassifierHistoryPoint, error) {
	if len(dates) == 0 {
		return nil, nil
	}
	startTime, endTime := seriesWindow(dates)
	raw, err := s.Store.ClassifierSnapshotValues(ctx, startTime, endTime, accountFilterFromNetWorthInput(input.Filters))
	if err != nil {
		return nil, err
	}
	byAccount := classifierSnapshotsByAccount(raw, tz)
	toPoint := func(dateKey string, classifier model.AssetClassifier, value money.Cents) *model.ClassifierHistoryPoint {
		return &model.ClassifierHistoryPoint{
			Date:       model.Date(dateKey),
			Classifier: classifier,
			Label:      labelOr(classifierHistoryLabels, classifier, string(classifier)),
			ValueUsd:   value,
		}
	}
	return historySeries(dates, byAccount, forwardFillClassifierSnapshots, classifierSeriesOrder, toPoint), nil
}

func historySeries[K comparable, S any, R any](
	dates []time.Time,
	byAccount map[int64][]S,
	forwardFill func([]S, string) map[K]money.Cents,
	order []K,
	toPoint func(string, K, money.Cents) R,
) []R {
	valuesByDate := map[string]map[K]money.Cents{}
	nonZero := map[K]bool{}
	for _, date := range dates {
		dateKey := date.Format("2006-01-02")
		valuesByDate[dateKey] = map[K]money.Cents{}
		for _, snapshots := range byAccount {
			for key, value := range forwardFill(snapshots, dateKey) {
				valuesByDate[dateKey][key] += value
			}
		}
		for key, value := range valuesByDate[dateKey] {
			if value != 0 {
				nonZero[key] = true
			}
		}
	}
	points := []R{}
	for _, date := range dates {
		dateKey := date.Format("2006-01-02")
		for _, key := range order {
			if !nonZero[key] {
				continue
			}
			points = append(points, toPoint(dateKey, key, valuesByDate[dateKey][key]))
		}
	}
	return points
}

func seriesWindow(dates []time.Time) (string, string) {
	startTime := startOfDay(dates[0]).UTC().Format(time.RFC3339)
	endTime := startOfDay(dates[len(dates)-1]).AddDate(0, 0, 1).UTC().Format(time.RFC3339)
	return startTime, endTime
}

func (s *Service) liabilitySeries(dates []time.Time, tz string, rows []SnapshotValue) []*model.LiabilityHistoryPoint {
	if len(dates) == 0 {
		return nil
	}
	raw := lo.Filter(rows, func(row SnapshotValue, _ int) bool { return isLiabilitySnapshot(row) })
	byAccount := accountSnapshotsByAccount(raw, tz)
	toPoint := func(dateKey string, category model.LiabilityCategory, value money.Cents) *model.LiabilityHistoryPoint {
		return &model.LiabilityHistoryPoint{
			Date:     model.Date(dateKey),
			Category: category,
			Label:    labelOr(liabilityHistoryLabels, category, "Other Liabilities"),
			ValueUsd: value,
		}
	}
	return historySeries(dates, byAccount, forwardFillLiabilitySnapshotValues, liabilitySeriesOrder, toPoint)
}

type classifierSnapshot struct {
	LocalDate  string
	SyncedAt   string
	Classifier model.AssetClassifier
	Value      money.Cents
	Closed     bool
}

func classifierSnapshotsByAccount(rows []ClassifierSnapshotValue, tz string) map[int64][]classifierSnapshot {
	toSnapshot := func(row ClassifierSnapshotValue) classifierSnapshot {
		return classifierSnapshot{
			LocalDate:  syncedAtToLocalDate(row.SyncedAt, tz),
			SyncedAt:   row.SyncedAt,
			Classifier: row.Classifier,
			Value:      row.ValueUSD,
			Closed:     row.AccountClosed,
		}
	}
	less := func(left, right classifierSnapshot) bool {
		if left.LocalDate != right.LocalDate {
			return left.LocalDate < right.LocalDate
		}
		if left.SyncedAt != right.SyncedAt {
			return left.SyncedAt < right.SyncedAt
		}
		return left.Classifier < right.Classifier
	}
	return snapshotsByAccount(rows, func(row ClassifierSnapshotValue) int64 { return row.AccountID }, toSnapshot, less)
}

func snapshotsByAccount[Row any, Snapshot any](
	rows []Row,
	accountID func(Row) int64,
	toSnapshot func(Row) Snapshot,
	less func(Snapshot, Snapshot) bool,
) map[int64][]Snapshot {
	toAccountSnapshot := func(row Row) (int64, Snapshot) { return accountID(row), toSnapshot(row) }
	byAccount := lo.GroupByMap(rows, toAccountSnapshot)
	for accountID := range byAccount {
		sort.Slice(byAccount[accountID], func(i, j int) bool {
			return less(byAccount[accountID][i], byAccount[accountID][j])
		})
	}
	return byAccount
}

func forwardFillClassifierSnapshots(snaps []classifierSnapshot, dateKey string) map[model.AssetClassifier]money.Cents {
	current := map[model.AssetClassifier]money.Cents{}
	for i := 0; i < len(snaps); {
		localDate, syncedAt := snaps[i].LocalDate, snaps[i].SyncedAt
		if localDate > dateKey {
			break
		}
		next := map[model.AssetClassifier]money.Cents{}
		for i < len(snaps) && snaps[i].LocalDate == localDate && snaps[i].SyncedAt == syncedAt {
			next[snaps[i].Classifier] += snaps[i].Value
			i++
		}
		current = next
	}
	if len(snaps) > 0 && snaps[0].Closed && dateKey > snaps[len(snaps)-1].LocalDate {
		// Classifier history intentionally keeps its original first-row closed check.
		return map[model.AssetClassifier]money.Cents{}
	}
	return current
}

func forwardFillLiabilitySnapshotValues(snaps []accountSnapshot, dateKey string) map[model.LiabilityCategory]money.Cents {
	category, value, ok := forwardFillLiabilitySnapshots(snaps, dateKey)
	return lo.Ternary(ok, map[model.LiabilityCategory]money.Cents{category: -value}, map[model.LiabilityCategory]money.Cents{})
}

func forwardFillLiabilitySnapshots(snaps []accountSnapshot, dateKey string) (model.LiabilityCategory, money.Cents, bool) {
	current, ok := forwardFilledSnapshot(snaps, dateKey)
	if !ok {
		return model.LiabilityCategoryOther, 0, false
	}
	return liabilitySnapshotCategory(*current), current.Value, true
}

func liabilitySnapshotCategory(snap accountSnapshot) model.LiabilityCategory {
	if snap.Manual {
		return model.LiabilityCategoryOther
	}
	return liabilityCategoryFor(snap.AccountType, snap.AccountSubtype)
}

func labelOr[K comparable](labels map[K]string, key K, fallback string) string {
	label, ok := labels[key]
	return lo.Ternary(ok, label, fallback)
}
