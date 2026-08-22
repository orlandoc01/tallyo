package wealthdb

import (
	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
)

func snapshotValue(row dbgen.AccountBalanceSnapshotValuesRow) wealth.SnapshotValue {
	return wealth.SnapshotValue{
		AccountID:      row.AccountID,
		AccountType:    row.AccountType,
		AccountManual:  row.AccountManual,
		AccountSubtype: row.AccountSubtype,
		AccountClosed:  row.AccountIsClosed,
		SyncedAt:       formatSnapshotTimestamp(row.SyncedAt),
		BalanceUSD:     row.BalanceUsdCents,
	}
}

func classifierSnapshotValue(row dbgen.ClassifierSnapshotValuesRow) wealth.ClassifierSnapshotValue {
	return wealth.ClassifierSnapshotValue{
		AccountID:     row.AccountID,
		AccountClosed: row.AccountIsClosed,
		SyncedAt:      formatSnapshotTimestamp(row.SyncedAt),
		Classifier:    model.AssetClassifier(row.Classifier),
		ValueUSD:      money.Cents(row.ValueUsdCents),
	}
}
