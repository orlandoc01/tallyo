package wealth

import (
	"cmp"
	"context"
	"fmt"
	"time"

	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

const (
	yahooCacheTTL = 30 * time.Minute
	// yahooPriceCacheMaxEntries bounds ticker/date keys across price refreshes.
	yahooPriceCacheMaxEntries = 256
)

type yahooCachedPrice struct {
	price  float64
	expiry time.Time
}

func (p *YahooPriceProvider) PriceAt(ctx context.Context, asset *model.Asset, date time.Time) (float64, error) {
	if asset == nil {
		return 0, fmt.Errorf("asset is nil")
	}
	if asset.AssetType == model.AssetTypeCurrency && asset.Identifier == "USD" {
		return 1, nil
	}
	if asset.AssetType == model.AssetTypeCurrency {
		return p.fallback(asset), nil
	}
	if asset.PriceConnectivity == model.ConnectivityStatusIgnore || asset.PriceConnectivity == model.ConnectivityStatusNotFound {
		return p.fallback(asset), nil
	}

	ticker := effectiveTicker(asset)
	if apiClients.IsSyntheticYahooTicker(ticker) {
		return p.fallback(asset), nil
	}
	dateStr := date.UTC().Format("2006-01-02")
	cacheKey := ticker + "|" + dateStr
	if price, ok := p.cachedPrice(cacheKey); ok {
		return adjustedPrice(price, asset), nil
	}

	price, priceAt, err := p.Client.FetchPrice(ctx, ticker, date)
	if err != nil {
		if apiClients.IsNotFound(err) {
			p.updatePriceConnectivity(ctx, asset, model.ConnectivityStatusNotFound)
		}
		p.Log.Warn("yahoo price fetch failed, using last known", "ticker", ticker, "error", err)
		return p.fallback(asset), nil
	}

	p.cachePrice(cacheKey, price)
	price = adjustedPrice(price, asset)
	p.updatePriceConnectivity(ctx, asset, model.ConnectivityStatusHealthy)
	if p.isCurrentPriceDate(date) && asset.ID.Int64() != 0 {
		p.writeAssetPrice(ctx, asset.ID.Int64(), price, priceAt)
	}
	return price, nil
}

func (p *YahooPriceProvider) cachedPrice(key string) (float64, bool) {
	p.cacheMu.Lock()
	defer p.cacheMu.Unlock()
	cached, ok := p.cache[key]
	if !ok || !p.now().Before(cached.expiry) {
		delete(p.cache, key)
		return 0, false
	}
	return cached.price, true
}

func (p *YahooPriceProvider) cachePrice(key string, price float64) {
	p.cacheMu.Lock()
	defer p.cacheMu.Unlock()
	if p.cache == nil {
		p.cache = make(map[string]yahooCachedPrice)
	}
	if _, exists := p.cache[key]; !exists && len(p.cache) == yahooPriceCacheMaxEntries {
		clear(p.cache)
	}
	p.cache[key] = yahooCachedPrice{price: price, expiry: p.now().Add(yahooCacheTTL)}
}

// ValidateTicker reports whether the ticker is known to Yahoo. It returns an
// error only when Yahoo definitively reports the symbol as not found; transient
// failures (network, rate limiting) return nil so they don't block asset edits.
func (p *YahooPriceProvider) ValidateTicker(ctx context.Context, ticker string) error {
	if apiClients.IsSyntheticYahooTicker(ticker) {
		return nil
	}
	if _, _, err := p.Client.FetchPrice(ctx, ticker, time.Now()); err != nil && apiClients.IsNotFound(err) {
		return fmt.Errorf("ticker %q not found", ticker)
	}
	return nil
}

func effectiveTicker(asset *model.Asset) string {
	if lo.FromPtr(asset.TrackingTicker) != "" {
		return *asset.TrackingTicker
	}
	return asset.Identifier
}

func adjustedPrice(price float64, asset *model.Asset) float64 {
	multiplier := cmp.Or(asset.TrackingMultiplier, 1)
	return price * multiplier
}

func (p *YahooPriceProvider) writeAssetPrice(ctx context.Context, assetID int64, price float64, priceAt time.Time) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := p.Store.UpdateAssetPrice(ctx, assetID, price, priceAt); err != nil {
		p.Log.Warn("yahoo: failed to write back asset price", "asset_id", assetID, "error", err)
	}
}

func (p *YahooPriceProvider) updatePriceConnectivity(ctx context.Context, asset *model.Asset, status model.ConnectivityStatus) {
	assetID := asset.ID.Int64()
	if assetID == 0 {
		return
	}
	if asset.PriceConnectivity == status {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := p.Store.UpdateAssetPriceConnectivity(ctx, assetID, status); err != nil {
		p.Log.Warn("yahoo: failed to update price connectivity", "asset_id", assetID, "status", status, "error", err)
	}
}

func (p *YahooPriceProvider) now() time.Time {
	return p.Now()
}

func (p *YahooPriceProvider) isCurrentPriceDate(date time.Time) bool {
	today := p.now().UTC().Truncate(24 * time.Hour)
	return !date.UTC().Truncate(24 * time.Hour).Before(today)
}

func (p *YahooPriceProvider) fallback(asset *model.Asset) float64 {
	return lo.FromPtr(asset.CurrentPrice)
}
