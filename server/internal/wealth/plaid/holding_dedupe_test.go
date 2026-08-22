package plaid

import (
	"testing"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

func holding(accountID, securityID string, quantity, value, costBasis float64) plaidapi.Holding {
	h := plaidapi.NewHoldingWithDefaults()
	h.SetAccountId(accountID)
	h.SetSecurityId(securityID)
	h.SetQuantity(quantity)
	h.SetInstitutionValue(value)
	h.SetCostBasis(costBasis)
	return *h
}

func holdingNoCostBasis(quantity, value float64) plaidapi.Holding {
	h := plaidapi.NewHoldingWithDefaults()
	h.SetAccountId("acc")
	h.SetSecurityId("vgit")
	h.SetQuantity(quantity)
	h.SetInstitutionValue(value)
	return *h
}

func sumQuantities(holdings []plaidapi.Holding) float64 {
	var total float64
	for _, h := range holdings {
		total += h.GetQuantity()
	}
	return total
}

func TestDedupeAggregateHoldingsRollupCases(t *testing.T) {
	tests := map[string]struct {
		holdings     []plaidapi.Holding
		balances     map[string]*float64
		wantRows     int
		wantQuantity float64
		failure      string
	}{
		// Tax lots 74 + 100 + 121 = 295, plus a roll-up row of 295. The account
		// balance (17405) matches the de-duped value, so the roll-up is dropped.
		"DropsReconciledRollup": {
			holdings: []plaidapi.Holding{
				holding("acc", "vgit", 74, 4366, 4451),
				holding("acc", "vgit", 100, 5900, 6016),
				holding("acc", "vgit", 121, 7139, 7012),
				holding("acc", "vgit", 295, 17405, 17479),
			},
			balances:     map[string]*float64{"acc": new(17405.0)},
			wantRows:     3,
			wantQuantity: 295,
			failure:      "expected roll-up dropped (3 rows, qty 295), got %d rows qty %v",
		},
		// The motivating false positive: three genuine lots a, b, a+b. The a+b row
		// matches the roll-up signature on quantity, value, AND cost basis, but the
		// account balance is the full 60000 (all three are real positions). Dropping
		// the a+b row would leave 30000 != 60000, so the drop is rejected.
		"KeepsGenuineLotsWhenBalanceDisagrees": {
			holdings: []plaidapi.Holding{
				holding("acc", "vti", 100, 10000, 9000),
				holding("acc", "vti", 200, 20000, 18000),
				holding("acc", "vti", 300, 30000, 27000),
			},
			balances:     map[string]*float64{"acc": new(60000.0)},
			wantRows:     3,
			wantQuantity: 600,
			failure:      "genuine a,b,a+b lots must be kept (3 rows, qty 600), got %d rows qty %v",
		},
		// Two identical lots with no roll-up: both rows match the half-of-total
		// signature, so the group is ambiguous and no row is nominated; the real
		// 200-share position is preserved.
		"KeepsEqualValueLotsWithoutRollup": {
			holdings: []plaidapi.Holding{
				holding("acc", "vti", 100, 36365, 30000),
				holding("acc", "vti", 100, 36365, 30000),
			},
			balances:     map[string]*float64{"acc": new(72730.0)},
			wantRows:     2,
			wantQuantity: 200,
			failure:      "ambiguous equal lots must be kept, got %d rows qty %v",
		},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			got := dedupeAggregateHoldings(tc.holdings, tc.balances)
			if len(got) != tc.wantRows || sumQuantities(got) != tc.wantQuantity {
				t.Fatalf(tc.failure, len(got), sumQuantities(got))
			}
		})
	}
}

func TestDedupeAggregateHoldingsKeepsRollupWhenNoBalanceToArbitrate(t *testing.T) {
	holdings := []plaidapi.Holding{
		holding("acc", "vgit", 74, 4366, 4451),
		holding("acc", "vgit", 100, 5900, 6016),
		holding("acc", "vgit", 121, 7139, 7012),
		holding("acc", "vgit", 295, 17405, 17479),
	}

	got := dedupeAggregateHoldings(holdings, map[string]*float64{}) // no balance for "acc"

	if len(got) != 4 {
		t.Fatalf("without a balance to arbitrate, rows must be kept, got %d rows", len(got))
	}
}

func TestDedupeAggregateHoldingsDropsRollupWithoutCostBasis(t *testing.T) {
	// cost_basis absent on every row: detection falls back to quantity + value,
	// and the balance still arbitrates the drop.
	holdings := []plaidapi.Holding{
		holdingNoCostBasis(74, 4366),
		holdingNoCostBasis(100, 5900),
		holdingNoCostBasis(121, 7139),
		holdingNoCostBasis(295, 17405),
	}
	balances := map[string]*float64{"acc": new(17405.0)}

	got := dedupeAggregateHoldings(holdings, balances)

	if len(got) != 3 || sumQuantities(got) != 295 {
		t.Fatalf("expected roll-up dropped without cost basis, got %d rows qty %v", len(got), sumQuantities(got))
	}
}

func TestDedupeAggregateHoldingsLeavesSingleRow(t *testing.T) {
	holdings := []plaidapi.Holding{holding("acc", "usd", 4028.9, 4028.9, 4028.9)}

	got := dedupeAggregateHoldings(holdings, map[string]*float64{"acc": new(4028.9)})

	if len(got) != 1 || sumQuantities(got) != 4028.9 {
		t.Fatalf("single-row group must be untouched, got %d rows qty %v", len(got), sumQuantities(got))
	}
}

func TestDedupeAggregateHoldingsIsolatesPerAccountAndSecurity(t *testing.T) {
	holdings := []plaidapi.Holding{
		holding("acc1", "vti", 50, 18000, 15000),
		holding("acc1", "vti", 50, 18000, 16000),
		holding("acc1", "vti", 100, 36000, 31000), // roll-up for acc1/vti
		holding("acc2", "vti", 100, 36000, 31000), // different account, single lot
		holding("acc1", "vxus", 30, 2500, 2400),   // different security, single lot
	}
	balances := map[string]*float64{
		"acc1": new(38500.0), // 36000 de-duped vti + 2500 vxus
		"acc2": new(36000.0),
	}

	got := dedupeAggregateHoldings(holdings, balances)

	if len(got) != 4 {
		t.Fatalf("expected only acc1/vti roll-up dropped, got %d rows", len(got))
	}
	var acc1vti float64
	for _, h := range got {
		if h.GetAccountId() == "acc1" && h.GetSecurityId() == "vti" {
			acc1vti += h.GetQuantity()
		}
	}
	if acc1vti != 100 {
		t.Fatalf("expected acc1/vti de-duped to 100, got %v", acc1vti)
	}
}
