package wealth

import (
	"math"
	"strings"
	"testing"

	"tallyo/internal/wealth/syncerids"
)

func TestHoldingPriceDeviates(t *testing.T) {
	cases := []struct {
		name     string
		prior    []AssetDailyHolding
		next     []AssetDailyHolding
		wantTrip bool
	}{
		{
			name:     "100x price spike flags",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:eth", 1)},
			next:     []AssetDailyHolding{holdingWithImpliedPrice("eth:eth", 100)},
			wantTrip: true,
		},
		{
			name:     "100x price drop flags",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:eth", 100)},
			next:     []AssetDailyHolding{holdingWithImpliedPrice("eth:eth", 1)},
			wantTrip: true,
		},
		{
			name:     "new asset without baseline passes",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:eth", 1)},
			next:     []AssetDailyHolding{holdingWithImpliedPrice("eth:eth", 1), holdingWithImpliedPrice("base:beefy", 1_000_000)},
			wantTrip: false,
		},
		{
			name:     "price-less holding is skipped",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:project", 1)},
			next:     []AssetDailyHolding{{Identifier: "eth:project", ValueUSD: 10_000}},
			wantTrip: false,
		},
		{
			name:     "stable prices pass",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:eth", 2500)},
			next:     []AssetDailyHolding{holdingWithImpliedPrice("eth:eth", 2510)},
			wantTrip: false,
		},
		{
			name:     "provider price takes precedence",
			prior:    []AssetDailyHolding{priorPriceHolding("eth:eth", 1)},
			next:     []AssetDailyHolding{{Identifier: "eth:eth", ProviderPrice: new(150.0)}},
			wantTrip: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason := HoldingPriceDeviates(tc.prior, tc.next, 100)
			tripped := reason != ""
			if tripped != tc.wantTrip {
				t.Fatalf("HoldingPriceDeviates() = %q, want trip %v", reason, tc.wantTrip)
			}
			if tripped && !strings.Contains(reason, "price eth:eth") {
				t.Fatalf("reason = %q, want asset identifier", reason)
			}
		})
	}
}

func TestHoldingPriceDeviatesUsesIdentifierOnlyWithoutStableSource(t *testing.T) {
	prior := []AssetDailyHolding{{
		Identifier:     "USDC",
		Price:          new(1.0),
		AdapterSources: []AdapterSource{{Adapter: syncerids.Debank, SourceID: "base:usdc"}},
	}}
	next := []AssetDailyHolding{{
		Identifier: "USDC",
		Price:      new(150.0),
		Asset: &AssetUpsert{
			Identifier: "USDC",
			AdapterSource: &AdapterSource{
				Adapter:  syncerids.Debank,
				SourceID: "polygon:usdc",
			},
		},
	}}

	if reason := HoldingPriceDeviates(prior, next, 100); reason != "" {
		t.Fatalf("HoldingPriceDeviates() = %q, want no cross-source ticker match", reason)
	}

	legacyPrior := []AssetDailyHolding{priorPriceHolding("USDC", 1)}
	if reason := HoldingPriceDeviates(legacyPrior, []AssetDailyHolding{{Identifier: "USDC", Price: new(150.0)}}, 100); reason == "" {
		t.Fatal("HoldingPriceDeviates() = empty, want source-less identifier match")
	}
}

func TestHoldingPriceDeviatesMatchesEditedIdentifierBySource(t *testing.T) {
	prior := []AssetDailyHolding{{
		Identifier:     "edited-token-name",
		Price:          new(1.0),
		AdapterSources: []AdapterSource{{Adapter: syncerids.Debank, SourceID: "base:token"}},
	}}
	next := []AssetDailyHolding{{
		Identifier: "provider-token-name",
		Price:      new(150.0),
		AdapterSource: &AdapterSource{
			Adapter:  syncerids.Debank,
			SourceID: "base:token",
		},
	}}

	reason := HoldingPriceDeviates(prior, next, 100)
	if !strings.Contains(reason, "price provider-token-name") {
		t.Fatalf("HoldingPriceDeviates() = %q, want source-backed reason", reason)
	}
}

func TestHoldingPriceDeviatesSkipsInvalidImpliedPrices(t *testing.T) {
	quantity := 1.0
	cases := map[string]float64{
		"zero":     0,
		"negative": -1,
		"nan":      math.NaN(),
		"infinite": math.Inf(1),
	}

	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			reason := HoldingPriceDeviates(
				[]AssetDailyHolding{priorPriceHolding("eth:zero", 1)},
				[]AssetDailyHolding{{Identifier: "eth:zero", Quantity: &quantity, ValueUSD: value}},
				100,
			)
			if reason != "" {
				t.Fatalf("HoldingPriceDeviates() = %q, want invalid implied price skipped", reason)
			}
		})
	}
}

func TestHoldingPriceDeviatesMatchesAssetUpsertIdentifier(t *testing.T) {
	// Adapter-built holdings (plaid/simplefin) carry identity on the asset
	// upsert rather than the transient Identifier field.
	prior := []AssetDailyHolding{priorPriceHolding("VTI", 2)}
	next := []AssetDailyHolding{{Asset: &AssetUpsert{Identifier: "VTI"}, Price: new(250.0)}}
	reason := HoldingPriceDeviates(prior, next, 100)
	if reason == "" {
		t.Fatal("expected deviation for asset-upsert-identified holding")
	}
	if !strings.Contains(reason, "price VTI") {
		t.Fatalf("reason = %q, want asset identifier", reason)
	}
}

func priorPriceHolding(identifier string, price float64) AssetDailyHolding {
	return AssetDailyHolding{Identifier: identifier, Price: &price}
}

func holdingWithImpliedPrice(identifier string, price float64) AssetDailyHolding {
	quantity := 1.0
	return AssetDailyHolding{
		Identifier: identifier,
		Quantity:   &quantity,
		ValueUSD:   price,
	}
}
