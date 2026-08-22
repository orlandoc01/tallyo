package wealth

import (
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth/syncerids"
)

func TestBalanceReviewProviderHoldingsJSON(t *testing.T) {
	quantity := 2.0
	price := 25.0
	assetName := "Provider Token"
	raw, err := MarshalBalanceReviewProviderHoldings([]AssetDailyHolding{{
		AssetID: 1,
		Asset: &AssetUpsert{
			AssetType:  model.AssetTypeCrypto,
			Identifier: "base:0xtoken",
			Name:       &assetName,
			Classifier: model.AssetClassifierStablecoin,
			AdapterSource: &AdapterSource{
				Adapter:  syncerids.Debank,
				SourceID: "base:0xtoken",
			},
		},
		Quantity:          &quantity,
		Price:             &price,
		ValueUSD:          50,
		CountsTowardValue: true,
	}})
	must.NoErr(t, err)
	if raw == nil {
		t.Fatal("MarshalBalanceReviewProviderHoldings() = nil")
	}

	holdings, err := BalanceReviewProviderHoldingsFromJSON(raw)
	must.NoErr(t, err)
	if len(holdings) != 1 || holdings[0].AssetID != "1" || holdings[0].Quantity == nil || *holdings[0].Quantity != quantity {
		t.Fatalf("BalanceReviewProviderHoldingsFromJSON() = %#v", holdings)
	}
	if holdings[0].Asset == nil || holdings[0].Asset.Identifier != "base:0xtoken" {
		t.Fatalf("BalanceReviewProviderHoldingsFromJSON() = %#v", holdings)
	}
}

func TestBalanceReviewProviderHoldingsJSONEmpty(t *testing.T) {
	raw, err := MarshalBalanceReviewProviderHoldings(nil)
	must.NoErr(t, err)
	if raw == nil || *raw != "[]" {
		t.Fatalf("MarshalBalanceReviewProviderHoldings(nil) = %v", raw)
	}

	holdings, err := BalanceReviewProviderHoldingsFromJSON(nil)
	must.NoErr(t, err)
	if len(holdings) != 0 {
		t.Fatalf("BalanceReviewProviderHoldingsFromJSON(nil) = %#v", holdings)
	}

	empty := ""
	holdings, err = BalanceReviewProviderHoldingsFromJSON(&empty)
	must.NoErr(t, err)
	if len(holdings) != 0 {
		t.Fatalf("BalanceReviewProviderHoldingsFromJSON(empty) = %#v", holdings)
	}
}

func TestBalanceReviewProviderHoldingsJSONRejectsInvalid(t *testing.T) {
	raw := `{"asset_id"`
	if _, err := BalanceReviewProviderHoldingsFromJSON(&raw); err == nil {
		t.Fatal("BalanceReviewProviderHoldingsFromJSON() error = nil")
	}
}
