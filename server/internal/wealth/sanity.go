package wealth

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/samber/lo"
)

// HoldingPriceDeviates returns the detailed reason when any holding present in
// both prior and next moved in price by at least ratio in either direction.
// Holdings are matched by stable adapter source when present, then legacy
// identifier for source-less holdings. Holdings without a usable price on either
// side are skipped.
func HoldingPriceDeviates(prior, next []AssetDailyHolding, ratio float64) string {
	priorPrices := priorPricesByMatchKey(prior)

	for _, holding := range next {
		matchKey := holdingMatchKey(holding)
		priorPrice, ok := priorPrices[matchKey]
		if !ok {
			priorPrice, ok = priorPrices[legacyHoldingMatchKey(holding)]
		}
		if !ok {
			continue
		}
		nextPrice := comparableHoldingPrice(holding)
		if nextPrice == nil {
			continue
		}
		if priceDeviationRatio(priorPrice, *nextPrice) >= ratio {
			return fmt.Sprintf(
				"price %s %.2f→%.2f exceeds %.1fx deviation threshold",
				holdingIdentifier(holding),
				priorPrice,
				*nextPrice,
				ratio,
			)
		}
	}
	return ""
}

func priorPricesByMatchKey(prior []AssetDailyHolding) map[string]float64 {
	prices := map[string]float64{}
	for _, holding := range prior {
		if !positiveFinitePrice(holding.Price) {
			continue
		}
		adapterMatchKeys := adapterSourceMatchKeys(holding)
		if len(adapterMatchKeys) > 0 {
			for _, matchKey := range adapterMatchKeys {
				prices[matchKey] = *holding.Price
			}
			continue
		}
		if matchKey := holdingMatchKey(holding); matchKey != "" {
			prices[matchKey] = *holding.Price
		}
		if matchKey := legacyHoldingMatchKey(holding); matchKey != "" {
			prices[matchKey] = *holding.Price
		}
	}
	return prices
}

func adapterSourceMatchKeys(holding AssetDailyHolding) []string {
	sources := holding.AdapterSources
	if holding.AdapterSource != nil {
		sources = append(sources, *holding.AdapterSource)
	}
	if holding.Asset != nil && holding.Asset.AdapterSource != nil {
		sources = append(sources, *holding.Asset.AdapterSource)
	}
	toMatchKey := func(source AdapterSource, _ int) (string, bool) {
		matchKey := adapterSourceMatchKey(source)
		return matchKey, matchKey != ""
	}
	return lo.FilterMap(sources, toMatchKey)
}

func adapterSourceMatchKey(source AdapterSource) string {
	return lo.Ternary(source.Adapter == "" || strings.TrimSpace(source.SourceID) == "", "", source.Adapter.Str()+":"+source.SourceID)
}

func holdingMatchKey(holding AssetDailyHolding) string {
	if matchKeys := adapterSourceMatchKeys(holding); len(matchKeys) > 0 {
		return matchKeys[0]
	}
	if holding.AssetID > 0 {
		return "asset:" + strconv.FormatInt(holding.AssetID, 10)
	}
	identifier := holdingIdentifier(holding)
	return lo.Ternary(identifier != "", "identifier:"+identifier, "")
}

func legacyHoldingMatchKey(holding AssetDailyHolding) string {
	identifier := holdingIdentifier(holding)
	return lo.Ternary(identifier != "", "identifier:"+identifier, "")
}

// holdingIdentifier resolves a holding's cross-snapshot identity: stored prior
// holdings and EVM lines carry Identifier directly, while adapter-built
// holdings describe the asset via an upsert.
func holdingIdentifier(holding AssetDailyHolding) string {
	if holding.Identifier != "" {
		return holding.Identifier
	}
	if holding.Asset != nil {
		return holding.Asset.Identifier
	}
	return ""
}

// comparableHoldingPrice resolves the price to compare in deviation checks:
// the provider-reported price, the resolved holding price, or the implied
// value per unit when only quantity and value are known.
func comparableHoldingPrice(holding AssetDailyHolding) *float64 {
	if positiveFinitePrice(holding.ProviderPrice) {
		return holding.ProviderPrice
	}
	if positiveFinitePrice(holding.Price) {
		return holding.Price
	}
	if holding.Quantity == nil || *holding.Quantity == 0 {
		return nil
	}
	price := holding.ValueUSD / *holding.Quantity
	if !finitePositive(price) {
		return nil
	}
	return &price
}

func positiveFinitePrice(price *float64) bool {
	return price != nil && finitePositive(*price)
}

func finitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func priceDeviationRatio(prior, next float64) float64 {
	if next <= 0 {
		return math.Inf(1)
	}
	return math.Max(next/prior, prior/next)
}
