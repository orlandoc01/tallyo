package plaid

import (
	"cmp"
	"strings"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func assetFromSecurity(security plaidapi.Security) wealth.AssetUpsert {
	identifier := cmp.Or(security.GetTickerSymbol(), "plaid:"+security.GetSecurityId())
	identifier = strings.ToUpper(identifier)
	classifier := securityToClassifier(string(security.GetType()), security.GetIsCashEquivalent())
	price, priceAt := securityPrice(security)
	securityType := lo.EmptyableToPtr(string(security.GetType()))
	return wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         identifier,
		Name:               lo.EmptyableToPtr(security.GetName()),
		Classifier:         classifier,
		TrackingMultiplier: 1,
		AdapterSource:      adapterSourceForSecurityID(security.GetSecurityId()),
		PlaidSecurityType:  securityType,
		CUSIP:              lo.EmptyableToPtr(security.GetCusip()),
		ISIN:               lo.EmptyableToPtr(security.GetIsin()),
		LastPrice:          price,
		LastPriceAt:        priceAt,
	}
}

func modelAssetFromSecurity(asset wealth.AssetUpsert) *model.Asset {
	return &model.Asset{
		Identifier:         asset.Identifier,
		AssetType:          asset.AssetType,
		Name:               asset.Name,
		Classifier:         asset.Classifier,
		CurrentPrice:       asset.LastPrice,
		TrackingTicker:     asset.TrackingTicker,
		TrackingMultiplier: asset.TrackingMultiplier,
		ForcedUsdPrice:     asset.ForcedUSDPrice,
	}
}

func securityToClassifier(securityType string, cashEquivalent bool) model.AssetClassifier {
	return lo.Ternary(cashEquivalent || strings.Contains(strings.ToLower(securityType), "cash"), model.AssetClassifierCash, model.AssetClassifierPublic)
}

func securityPrice(security plaidapi.Security) (*float64, *time.Time) {
	price, ok := security.GetClosePriceOk()
	if !ok || price == nil {
		return nil, nil
	}
	priceDate := security.GetClosePriceAsOf()
	if priceDate == "" {
		now := time.Now().UTC()
		return price, &now
	}
	parsed, err := time.Parse("2006-01-02", priceDate)
	if err != nil {
		return price, nil
	}
	return price, &parsed
}

func adapterSourceForSecurityID(securityID string) *wealth.AdapterSource {
	if securityID == "" {
		return nil
	}
	return &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: securityID}
}
