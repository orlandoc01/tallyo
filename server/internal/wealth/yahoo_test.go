package wealth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	testutil "tallyo/internal/utils/test"
)

func makeYahooResponse(price float64, ts int64) map[string]any {
	r := map[string]any{"chart": map[string]any{"result": []map[string]any{{}}}}
	result := r["chart"].(map[string]any)["result"].([]map[string]any)
	result[0]["meta"] = map[string]any{"regularMarketPrice": price, "regularMarketTime": ts}
	closeVal := price
	result[0]["indicators"] = map[string]any{"quote": []map[string]any{{"close": []*float64{&closeVal}}}}
	result[0]["timestamp"] = []int64{ts}
	return r
}

func newYahooServer(t *testing.T, callCount *atomic.Int64) *httptest.Server {
	t.Helper()
	return newYahooServerAt(t, 123.45, time.Now().Unix(), callCount)
}

func newYahooServerAt(t *testing.T, price float64, ts int64, callCount *atomic.Int64) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if callCount != nil {
			callCount.Add(1)
		}
		_ = json.NewEncoder(w).Encode(makeYahooResponse(price, ts))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newYahooProvider(t *testing.T, srv *httptest.Server) *YahooPriceProvider {
	t.Helper()
	return &YahooPriceProvider{
		Client: &apiClients.Yahoo{HTTP: srv.Client(), BaseURL: srv.URL},
		Log:    testutil.Logger,
		Store:  noopAssetPriceStore{},
		Now:    time.Now,
	}
}

func newDefaultYahooProvider(t *testing.T) *YahooPriceProvider {
	t.Helper()
	return &YahooPriceProvider{
		Client: apiClients.NewYahoo(nil),
		Log:    testutil.Logger,
		Store:  noopAssetPriceStore{},
		Now:    time.Now,
	}
}

// noopAssetPriceStore is the Null Object for AssetPriceStore: it satisfies the
// dependency so the provider never needs a nil check before writing back prices.
type noopAssetPriceStore struct{}

func (noopAssetPriceStore) UpdateAssetPrice(context.Context, int64, float64, time.Time) error {
	return nil
}

func (noopAssetPriceStore) UpdateAssetPriceConnectivity(context.Context, int64, model.ConnectivityStatus) error {
	return nil
}

func TestYahooPriceProviderUSD(t *testing.T) {
	p := newDefaultYahooProvider(t)
	got, err := p.PriceAt(context.Background(), &model.Asset{AssetType: model.AssetTypeCurrency, Identifier: "USD"}, time.Now())
	if err != nil || got != 1 {
		t.Fatalf("PriceAt(USD) = %v, %v", got, err)
	}
}

func TestYahooPriceProviderNilAsset(t *testing.T) {
	p := newDefaultYahooProvider(t)
	_, err := p.PriceAt(context.Background(), nil, time.Now())
	if err == nil {
		t.Fatal("expected error for nil asset")
	}
}

func TestYahooPriceProviderCurrentPrice(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	p := newYahooProvider(t, srv)

	asset := &model.Asset{Identifier: "AAPL", AssetType: model.AssetTypeSecurity}
	got, err := p.PriceAt(context.Background(), asset, time.Now())
	if err != nil || got != 123.45 {
		t.Fatalf("PriceAt(current) = %v, %v", got, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 HTTP call, got %d", calls.Load())
	}

	// Second call should hit cache.
	got2, err := p.PriceAt(context.Background(), asset, time.Now())
	if err != nil || got2 != 123.45 {
		t.Fatalf("PriceAt(cached) = %v, %v", got2, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected still 1 HTTP call after cache hit, got %d", calls.Load())
	}
	for i := range yahooPriceCacheMaxEntries {
		p.cachePrice(strconv.Itoa(i), 1)
	}
	p.cacheMu.Lock()
	defer p.cacheMu.Unlock()
	if len(p.cache) != 1 {
		t.Fatalf("price cache entries = %d, want 1 after clearing at limit", len(p.cache))
	}
}

func TestYahooPriceProviderRefetchesExpiredCache(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	cacheNow := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	p := newYahooProvider(t, srv)
	p.Now = func() time.Time { return cacheNow }
	asset := &model.Asset{Identifier: "AAPL", AssetType: model.AssetTypeSecurity}
	date := time.Now()

	if _, err := p.PriceAt(context.Background(), asset, date); err != nil {
		t.Fatalf("PriceAt(first) error = %v", err)
	}
	cacheNow = cacheNow.Add(yahooCacheTTL + time.Second)
	if _, err := p.PriceAt(context.Background(), asset, date); err != nil {
		t.Fatalf("PriceAt(expired) error = %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("HTTP calls = %d, want 2", calls.Load())
	}
}

func TestYahooPriceProviderSkipsNotFoundAsset(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	p := newYahooProvider(t, srv)
	price := 55.0
	asset := &model.Asset{
		Identifier:        "BAD",
		AssetType:         model.AssetTypeSecurity,
		CurrentPrice:      &price,
		PriceConnectivity: model.ConnectivityStatusNotFound,
	}

	got, err := p.PriceAt(context.Background(), asset, time.Now())
	if err != nil || got != price {
		t.Fatalf("PriceAt(not found) = %v, %v", got, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("HTTP calls = %d, want 0", calls.Load())
	}
}

func TestYahooPriceProviderSkipsSyntheticTickers(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	p := newYahooProvider(t, srv)
	fallback := 55.0
	tracking := "simplefin:security-id"

	for _, asset := range []*model.Asset{
		{Identifier: "PLAID:security-id", AssetType: model.AssetTypeSecurity, CurrentPrice: &fallback},
		{Identifier: "ignored", TrackingTicker: &tracking, AssetType: model.AssetTypeSecurity, CurrentPrice: &fallback},
	} {
		got, err := p.PriceAt(context.Background(), asset, time.Now())
		if err != nil || got != fallback {
			t.Fatalf("PriceAt(%#v) = %v, %v", asset, got, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("HTTP calls = %d, want 0", calls.Load())
	}
}

func TestYahooPriceProviderTrackingTickerOverridesSyntheticIdentifier(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	p := newYahooProvider(t, srv)
	tracking := "VTI"
	got, err := p.PriceAt(context.Background(), &model.Asset{
		Identifier:     "PLAID:security-id",
		TrackingTicker: &tracking,
		AssetType:      model.AssetTypeSecurity,
	}, time.Now())
	if err != nil || got != 123.45 || calls.Load() != 1 {
		t.Fatalf("PriceAt(tracking override) = %v, %v calls=%d", got, err, calls.Load())
	}
}

func TestYahooPriceProviderValidateTickerSkipsSyntheticTickers(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	p := newYahooProvider(t, srv)

	for _, ticker := range []string{"PLAID:security-id", "simplefin:security-id"} {
		if err := p.ValidateTicker(context.Background(), ticker); err != nil {
			t.Fatalf("ValidateTicker(%q) error = %v", ticker, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("HTTP calls = %d, want 0", calls.Load())
	}
}

func TestValidateTickerPriceableUsesTrackingTickerOverSyntheticIdentifier(t *testing.T) {
	var calls atomic.Int64
	srv := newYahooServer(t, &calls)
	tracking := "VTI"
	service := &Service{Log: testutil.Logger, PriceProvider: newYahooProvider(t, srv)}
	asset := &model.Asset{
		Identifier:     "PLAID:security-id",
		TrackingTicker: &tracking,
		AssetType:      model.AssetTypeSecurity,
	}

	if err := service.validateTickerPriceable(context.Background(), asset); err != nil {
		t.Fatalf("validateTickerPriceable() error = %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("HTTP calls = %d, want 1", calls.Load())
	}
}

func TestYahooPriceProviderHistoricalPrice(t *testing.T) {
	historical := time.Now().UTC().AddDate(0, 0, -2)
	srv := newYahooServerAt(t, 99.0, historical.Truncate(24*time.Hour).Add(20*time.Hour).Unix(), nil)
	p := newYahooProvider(t, srv)

	asset := &model.Asset{Identifier: "MSFT", AssetType: model.AssetTypeSecurity}
	got, err := p.PriceAt(context.Background(), asset, historical)
	if err != nil || got != 99.0 {
		t.Fatalf("PriceAt(historical) = %v, %v", got, err)
	}
}

func TestYahooPriceProviderHistoricalUsesPriorTradingClose(t *testing.T) {
	requested := previousHistoricalSunday()
	requestedDay := requested.Truncate(24 * time.Hour)
	friday := requestedDay.AddDate(0, 0, -2).Add(20 * time.Hour)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		period1, err := strconv.ParseInt(r.URL.Query().Get("period1"), 10, 64)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if period1 >= requestedDay.Unix() {
			_ = json.NewEncoder(w).Encode(map[string]any{"chart": map[string]any{"result": []map[string]any{{}}}})
			return
		}
		_ = json.NewEncoder(w).Encode(makeYahooResponse(101.50, friday.Unix()))
	}))
	defer srv.Close()
	p := newYahooProvider(t, srv)
	currentPrice := 200.0
	asset := &model.Asset{Identifier: "MSFT", AssetType: model.AssetTypeSecurity, CurrentPrice: &currentPrice}

	got, err := p.PriceAt(context.Background(), asset, requested)
	if err != nil || got != 101.50 {
		t.Fatalf("PriceAt(non-trading historical) = %v, %v, want 101.50, nil", got, err)
	}
}

func previousHistoricalSunday() time.Time {
	day := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -1)
	for day.Weekday() != time.Sunday {
		day = day.AddDate(0, 0, -1)
	}
	return day.Add(12 * time.Hour)
}

func TestYahooPriceProviderFallbackOnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	p := newYahooProvider(t, srv)

	price := 55.0
	asset := &model.Asset{Identifier: "TSLA", AssetType: model.AssetTypeSecurity, CurrentPrice: &price}
	got, err := p.PriceAt(context.Background(), asset, time.Now())
	if err != nil || got != 55.0 {
		t.Fatalf("PriceAt(error fallback) = %v, %v", got, err)
	}
}

func TestYahooPriceProviderNonUSDCurrencyFallback(t *testing.T) {
	p := newDefaultYahooProvider(t)
	price := 0.95
	asset := &model.Asset{AssetType: model.AssetTypeCurrency, Identifier: "EUR", CurrentPrice: &price}
	got, err := p.PriceAt(context.Background(), asset, time.Now())
	if err != nil || got != 0.95 {
		t.Fatalf("PriceAt(EUR) = %v, %v", got, err)
	}
}
