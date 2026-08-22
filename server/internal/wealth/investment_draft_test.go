package wealth

import "testing"

func TestInvestmentSnapshotDraftAddQuantityFold(t *testing.T) {
	two, three, five := 2.0, 3.0, 5.0
	tests := map[string]struct {
		holdings       []AssetDailyHolding
		wantQuantities []*float64
		wantValues     []float64
	}{
		"both quantities set": {
			holdings:       []AssetDailyHolding{draftHolding("asset", &two, 10), draftHolding("asset", &three, 20)},
			wantQuantities: []*float64{&five},
			wantValues:     []float64{30},
		},
		"first set and second nil": {
			holdings:       []AssetDailyHolding{draftHolding("asset", &two, 10), draftHolding("asset", nil, 20)},
			wantQuantities: []*float64{nil},
			wantValues:     []float64{30},
		},
		"first nil and second set": {
			holdings:       []AssetDailyHolding{draftHolding("asset", nil, 10), draftHolding("asset", &three, 20)},
			wantQuantities: []*float64{nil},
			wantValues:     []float64{30},
		},
		"both quantities nil": {
			holdings:       []AssetDailyHolding{draftHolding("asset", nil, 10), draftHolding("asset", nil, 20)},
			wantQuantities: []*float64{nil},
			wantValues:     []float64{30},
		},
		"different assets": {
			holdings:       []AssetDailyHolding{draftHolding("first", &two, 10), draftHolding("second", &three, 20)},
			wantQuantities: []*float64{&two, &three},
			wantValues:     []float64{10, 20},
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			draft := NewInvestmentSnapshotDraft()
			for _, holding := range tc.holdings {
				draft.Add(holding)
			}
			if len(draft.Holdings) != len(tc.wantQuantities) {
				t.Fatalf("len(Holdings) = %d, want %d", len(draft.Holdings), len(tc.wantQuantities))
			}
			for i, wantQuantity := range tc.wantQuantities {
				got := draft.Holdings[i]
				if got.ValueUSD != tc.wantValues[i] {
					t.Errorf("Holdings[%d].ValueUSD = %v, want %v", i, got.ValueUSD, tc.wantValues[i])
				}
				if wantQuantity == nil {
					if got.Quantity != nil {
						t.Errorf("Holdings[%d].Quantity = %v, want nil", i, *got.Quantity)
					}
					continue
				}
				if got.Quantity == nil || *got.Quantity != *wantQuantity {
					t.Errorf("Holdings[%d].Quantity = %v, want %v", i, got.Quantity, *wantQuantity)
				}
			}
		})
	}
}

func draftHolding(identifier string, quantity *float64, valueUSD float64) AssetDailyHolding {
	return AssetDailyHolding{Asset: &AssetUpsert{Identifier: identifier}, Quantity: quantity, ValueUSD: valueUSD}
}
