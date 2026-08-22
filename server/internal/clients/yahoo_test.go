package clients

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestYahooFetchPriceCurrent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "interval=1d&range=1d" || r.URL.EscapedPath() != "/v8/finance/chart/AAPL%3Fnot-query" {
			t.Fatalf("url = %s", r.URL)
		}
		json.NewEncoder(w).Encode(map[string]any{"chart": map[string]any{"result": []map[string]any{{"meta": map[string]any{"regularMarketPrice": 123.45, "regularMarketTime": time.Now().Unix()}}}}}) //nolint:errcheck
	}))
	defer srv.Close()

	client := &Yahoo{HTTP: srv.Client(), BaseURL: srv.URL}
	price, _, err := client.FetchPrice(context.Background(), "AAPL?not-query", time.Now())
	if err != nil || price != 123.45 {
		t.Fatalf("FetchPrice() = %v, %v", price, err)
	}
}

func TestYahooFetchPriceHistorical(t *testing.T) {
	ts := time.Now().UTC().AddDate(0, 0, -2).Truncate(24 * time.Hour).Add(20 * time.Hour).Unix()
	closeVal := 99.0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"chart": map[string]any{"result": []map[string]any{{"indicators": map[string]any{"quote": []map[string]any{{"close": []*float64{&closeVal}}}}, "timestamp": []int64{ts}}}}}) //nolint:errcheck
	}))
	defer srv.Close()

	client := &Yahoo{HTTP: srv.Client(), BaseURL: srv.URL}
	price, _, err := client.FetchPrice(context.Background(), "MSFT", time.Unix(ts, 0).UTC())
	if err != nil || price != 99.0 {
		t.Fatalf("FetchPrice() = %v, %v", price, err)
	}
}
