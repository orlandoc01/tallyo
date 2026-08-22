package wealth

import (
	"testing"

	"tallyo/internal/graph/model"
)

func TestForwardFillClassifierSnapshots(t *testing.T) {
	tests := map[string]struct {
		snaps    []ClassifierSnapshotValue
		timezone string
		date     string
		want     map[model.AssetClassifier]int64
		failure  string
	}{
		"ReplacesSnapshotComposition": {
			snaps: []ClassifierSnapshotValue{
				{AccountID: 1, SyncedAt: "2026-01-01T12:00:00Z", Classifier: model.AssetClassifierCash, ValueUSD: 100},
				{AccountID: 1, SyncedAt: "2026-01-02T12:00:00Z", Classifier: model.AssetClassifierPublic, ValueUSD: 250},
			},
			date:    "2026-01-02",
			want:    map[model.AssetClassifier]int64{model.AssetClassifierCash: 0, model.AssetClassifierPublic: 250},
			failure: "forwardFillClassifierSnapshots = %#v, want only public 250",
		},
		"UsesLatestSnapshot": {
			snaps: []ClassifierSnapshotValue{
				{AccountID: 1, SyncedAt: "2026-01-01T12:00:00Z", Classifier: model.AssetClassifierPublic, ValueUSD: 100},
				{AccountID: 1, SyncedAt: "2026-01-01T13:00:00Z", Classifier: model.AssetClassifierPublic, ValueUSD: 200},
			},
			date:    "2026-01-01",
			want:    map[model.AssetClassifier]int64{model.AssetClassifierPublic: 200},
			failure: "forwardFillClassifierSnapshots = %#v, want latest 200",
		},
		"UsesLatestSnapshotOnSameLocalDate": {
			snaps: []ClassifierSnapshotValue{
				{AccountID: 1, SyncedAt: "2026-06-22T21:47:39Z", Classifier: model.AssetClassifierCompanyEquity, ValueUSD: 100},
				{AccountID: 1, SyncedAt: "2026-06-23T01:42:09Z", Classifier: model.AssetClassifierCompanyEquity, ValueUSD: 120},
			},
			timezone: "America/New_York",
			date:     "2026-06-22",
			want:     map[model.AssetClassifier]int64{model.AssetClassifierCompanyEquity: 120},
			failure:  "forwardFillClassifierSnapshots = %#v, want latest company equity 120",
		},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			byAccount := classifierSnapshotsByAccount(tc.snaps, tc.timezone)
			got := forwardFillClassifierSnapshots(byAccount[1], tc.date)
			for classifier, want := range tc.want {
				if int64(got[classifier]) != want {
					t.Fatalf(tc.failure, got)
				}
			}
		})
	}
}

func TestLiabilitySnapshotCategory(t *testing.T) {
	mortgage := "mortgage"
	category := liabilitySnapshotCategory(accountSnapshot{AccountType: model.AccountTypeLoan, AccountSubtype: &mortgage})
	if category != model.LiabilityCategoryMortgage {
		t.Fatalf("liabilitySnapshotCategory(mortgage) = %s", category)
	}
	manual := liabilitySnapshotCategory(accountSnapshot{Manual: true, AccountType: model.AccountTypeDepository})
	if manual != model.LiabilityCategoryOther {
		t.Fatalf("liabilitySnapshotCategory(manual) = %s", manual)
	}
}

func TestHistoryLabels(t *testing.T) {
	classifier := model.AssetClassifierCryptocurrency
	classifierLabel := labelOr(classifierHistoryLabels, classifier, string(classifier))
	if classifierLabel != "Crypto" {
		t.Fatalf("classifierHistoryLabel(CRYPTOCURRENCY) = %q", classifierLabel)
	}
	liabilityLabel := labelOr(liabilityHistoryLabels, model.LiabilityCategoryCard, "Other Liabilities")
	if liabilityLabel != "Credit Card" {
		t.Fatalf("liabilityHistoryLabel(CARD) = %q", liabilityLabel)
	}
}
