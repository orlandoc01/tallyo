package wealth

import (
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

func (s *Service) series(dates []time.Time, now time.Time, tz string, currentAssets money.Cents, currentLiabilities money.Cents, rows []SnapshotValue) []*model.NetWorthPoint {
	assetsByDate, liabilitiesByDate := snapshotValuesByDate(rows, dates, tz)
	today := now.Format("2006-01-02")
	toPoint := func(date time.Time) *model.NetWorthPoint {
		dateKey := date.Format("2006-01-02")
		assets, liabilities := assetsByDate[dateKey], liabilitiesByDate[dateKey]
		if dateKey == today {
			assets, liabilities = currentAssets, currentLiabilities
		}
		return netWorthPoint(date, assets, liabilities)
	}
	return u.Map(dates, toPoint)
}

func netWorthPoint(date time.Time, assets money.Cents, liabilities money.Cents) *model.NetWorthPoint {
	return &model.NetWorthPoint{Date: model.Date(date.Format("2006-01-02")), TotalAssetsUsd: assets, TotalLiabilitiesUsd: liabilities, NetWorthUsd: assets - liabilities}
}

type accountSnapshot struct {
	LocalDate      string
	SyncedAt       string
	Value          money.Cents
	Liability      bool
	Closed         bool
	Manual         bool
	AccountType    model.AccountType
	AccountSubtype *string
}

// snapshotValuesByDate converts each snapshot's synced_at to a local date, then
// forward-fills the latest snapshot per account into asset and liability totals.
func snapshotValuesByDate(raw []SnapshotValue, dates []time.Time, tz string) (assetsByDate, liabilitiesByDate map[string]money.Cents) {
	assetsByDate = map[string]money.Cents{}
	liabilitiesByDate = map[string]money.Cents{}
	if len(dates) == 0 {
		return assetsByDate, liabilitiesByDate
	}
	byAccount := accountSnapshotsByAccount(raw, tz)
	for _, date := range dates {
		dateKey := date.Format("2006-01-02")
		for _, snaps := range byAccount {
			accAssets, accLiabilities := forwardFillSnapshot(snaps, dateKey)
			assetsByDate[dateKey] += accAssets
			liabilitiesByDate[dateKey] += accLiabilities
		}
	}
	return assetsByDate, liabilitiesByDate
}

func accountSnapshotsByAccount(rows []SnapshotValue, tz string) map[int64][]accountSnapshot {
	toSnapshot := func(row SnapshotValue) accountSnapshot {
		return accountSnapshot{
			LocalDate:      syncedAtToLocalDate(row.SyncedAt, tz),
			SyncedAt:       row.SyncedAt,
			Value:          row.BalanceUSD,
			Liability:      isLiabilitySnapshot(row),
			Closed:         row.AccountClosed,
			Manual:         row.AccountManual,
			AccountType:    model.AccountType(row.AccountType),
			AccountSubtype: row.AccountSubtype,
		}
	}
	less := func(left, right accountSnapshot) bool {
		return lo.Ternary(left.LocalDate != right.LocalDate, left.LocalDate < right.LocalDate, left.SyncedAt < right.SyncedAt)
	}
	return snapshotsByAccount(rows, func(row SnapshotValue) int64 { return row.AccountID }, toSnapshot, less)
}

func isLiabilitySnapshot(row SnapshotValue) bool {
	return IsLiabilityType(model.AccountType(row.AccountType))
}

func forwardFillSnapshot(snaps []accountSnapshot, dateKey string) (assets, liabilities money.Cents) {
	current, ok := forwardFilledSnapshot(snaps, dateKey)
	if !ok {
		return 0, 0
	}
	if current.Liability {
		return 0, current.Value
	}
	return current.Value, 0
}

func forwardFilledSnapshot(snaps []accountSnapshot, dateKey string) (*accountSnapshot, bool) {
	var current *accountSnapshot
	for i := range snaps {
		if snaps[i].LocalDate > dateKey {
			break
		}
		current = &snaps[i]
	}
	if current == nil || (current.Closed && dateKey > snaps[len(snaps)-1].LocalDate) {
		return nil, false
	}
	return current, true
}

func sampleDates(input model.HistoricalNetWorthInput, earliestTS *time.Time, now time.Time) []time.Time {
	start := addMonthsClamped(now, -1)
	switch input.Range {
	case model.NetWorthRangeThreeMonth:
		start = addMonthsClamped(now, -3)
	case model.NetWorthRangeYtd:
		start = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	case model.NetWorthRangeOneYear:
		start = addMonthsClamped(now, -12)
	case model.NetWorthRangeAll:
		if earliestTS != nil {
			start = earliestTS.In(now.Location())
		}
	}
	if earliestTS != nil {
		earliest := earliestTS.In(now.Location())
		if earliest.After(start) {
			start = earliest
		}
	}
	dates := []time.Time{}
	for step := 0; ; step++ {
		d := sampleDate(start, input.Granularity, step)
		if d.After(now) {
			break
		}
		dates = append(dates, d)
	}
	if len(dates) == 0 || dates[len(dates)-1].Format("2006-01-02") != now.Format("2006-01-02") {
		dates = append(dates, now)
	}
	return dates
}

func sampleDate(start time.Time, granularity *model.Granularity, step int) time.Time {
	if granularity == nil {
		return start.AddDate(0, 0, step)
	}
	switch *granularity {
	case model.GranularityWeekly:
		return start.AddDate(0, 0, step*7)
	case model.GranularityMonthly:
		return addMonthsClamped(start, step)
	case model.GranularityQuarterly:
		return addMonthsClamped(start, step*3)
	case model.GranularityYearly:
		return addMonthsClamped(start, step*12)
	default:
		return start.AddDate(0, 0, step)
	}
}

func addMonthsClamped(start time.Time, months int) time.Time {
	target := time.Date(start.Year(), start.Month()+time.Month(months), 1, start.Hour(), start.Minute(), start.Second(), start.Nanosecond(), start.Location())
	if isLastDayOfMonth(start) {
		return endOfMonth(target)
	}
	day := min(start.Day(), endOfMonth(target).Day())
	return time.Date(target.Year(), target.Month(), day, start.Hour(), start.Minute(), start.Second(), start.Nanosecond(), start.Location())
}

func isLastDayOfMonth(date time.Time) bool {
	return date.Day() == endOfMonth(date).Day()
}

func endOfMonth(date time.Time) time.Time {
	return time.Date(date.Year(), date.Month()+1, 1, date.Hour(), date.Minute(), date.Second(), date.Nanosecond(), date.Location()).AddDate(0, 0, -1)
}

func syncedAtToLocalDate(syncedAt string, tz string) string {
	t, err := time.Parse(time.RFC3339, syncedAt)
	if err != nil {
		return syncedAt
	}
	return LocalDate(t, tz)
}
