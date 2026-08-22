package yfinance

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
	"testing"
	"time"
)

func TestClientFetchFund(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cookie":
			http.SetCookie(w, &http.Cookie{Name: "A3", Value: "session", MaxAge: 3600})
		case "/crumb":
			if r.Header.Get("Cookie") != "A3=session" {
				t.Fatalf("crumb request missing cookies: %q", r.Header.Get("Cookie"))
			}
			_, _ = fmt.Fprint(w, "crumb")
		case "/quoteSummary/VTI":
			if r.URL.Query().Get("crumb") != "crumb" || r.Header.Get("Cookie") != "A3=session" {
				t.Fatalf("missing crumb/cookie: %s %s", r.URL.RawQuery, r.Header.Get("Cookie"))
			}
			_, _ = fmt.Fprint(w, `{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Large Blend"},"topHoldings":{"equityHoldings":{"cashPosition":0.02,"stockPosition":0.9,"bondPosition":0.08},"sectorWeightings":[{"technology":0.4},{"healthcare":{"raw":0.2}}]}}],"error":null}}`)
		default:
			http.NotFound(w, r)
		}
	})
	report, err := client.FetchFund(context.Background(), "vti")
	must.NoErr(t, err)
	if report == nil || report.Group != "US Equity" || report.StockPosition != 0.9 || report.SectorTechnology != 0.4 || report.SectorHealthcare != 0.2 {
		t.Fatalf("report = %#v", report)
	}
}

func TestClientFetchEquityAndMissingProfiles(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cookie":
			http.SetCookie(w, &http.Cookie{Name: "A3", Value: "session", MaxAge: 3600})
		case "/crumb":
			_, _ = fmt.Fprint(w, "crumb")
		case "/quoteSummary/AAPL":
			_, _ = fmt.Fprint(w, `{"quoteSummary":{"result":[{"summaryProfile":{"sector":"Technology"}}],"error":null}}`)
		case "/quoteSummary/EMPTY":
			_, _ = fmt.Fprint(w, `{"quoteSummary":{"result":[{}],"error":null}}`)
		default:
			http.NotFound(w, r)
		}
	})
	fund, err := client.FetchFund(context.Background(), "AAPL")
	if err != nil || fund != nil {
		t.Fatalf("FetchFund(AAPL) = %#v, %v", fund, err)
	}
	equity, err := client.FetchEquity(context.Background(), "AAPL")
	if err != nil || equity == nil || equity.Sector != "Technology" {
		t.Fatalf("FetchEquity(AAPL) = %#v, %v", equity, err)
	}
	missing, err := client.FetchEquity(context.Background(), "EMPTY")
	if err != nil || missing != nil {
		t.Fatalf("FetchEquity(EMPTY) = %#v, %v", missing, err)
	}
}

func TestClientRetriesAfterUnauthorized(t *testing.T) {
	var quoteCalls int
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cookie":
			http.SetCookie(w, &http.Cookie{Name: "A3", Value: "session", MaxAge: 3600})
		case "/crumb":
			_, _ = fmt.Fprint(w, "crumb")
		case "/quoteSummary/VTI":
			quoteCalls++
			if quoteCalls == 1 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = fmt.Fprint(w, `{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Unknown Category"},"topHoldings":{"stockPosition":1}}],"error":null}}`)
		default:
			http.NotFound(w, r)
		}
	})
	report, err := client.FetchFund(context.Background(), "VTI")
	must.NoErr(t, err)
	if quoteCalls != 2 {
		t.Fatalf("quote calls = %d, want 2", quoteCalls)
	}
	if report.Group != "Uncategorized" {
		t.Fatalf("unknown category group = %q", report.Group)
	}
}

func TestSmokeYahooVFFVX(t *testing.T) {
	if os.Getenv("RUN_SMOKE_TESTS") != "1" {
		t.Skip("set RUN_SMOKE_TESTS=1 to run Yahoo Finance smoke test")
	}
	c := New(&http.Client{Timeout: 30 * time.Second}, nooplog.Logger)

	fund, err := c.FetchFund(context.Background(), "VFFVX")
	must.NoErr(t, err)
	if fund == nil {
		t.Fatal("FetchFund(VFFVX) returned nil")
	}
	if fund.Category == "" {
		t.Fatal("fund.Category is empty")
	}
	if fund.Group == "" {
		t.Fatal("fund.Group is empty")
	}
	t.Logf("VFFVX: category=%q group=%q stock=%.4f bond=%.4f cash=%.4f pref=%.4f conv=%.4f other=%.4f",
		fund.Category, fund.Group, fund.StockPosition, fund.BondPosition, fund.CashPosition,
		fund.PreferredPosition, fund.ConvertiblePosition, fund.OtherPosition)
	t.Logf("VFFVX sectors: tech=%.4f health=%.4f fin=%.4f energy=%.4f real=%.4f",
		fund.SectorTechnology, fund.SectorHealthcare, fund.SectorFinancialServices, fund.SectorEnergy, fund.SectorRealEstate)
	if fund.StockPosition <= 0 {
		t.Fatalf("fund.StockPosition = %v, want > 0", fund.StockPosition)
	}

	equity, err := c.FetchEquity(context.Background(), "AAPL")
	must.NoErr(t, err)
	if equity == nil || equity.Sector == "" {
		t.Fatalf("FetchEquity(AAPL) = %#v, want non-nil with sector", equity)
	}
	t.Logf("AAPL: sector=%q", equity.Sector)
}

func TestNewUsesDefaultTimeout(t *testing.T) {
	c, ok := New(nil, nooplog.Logger).(*client)
	if !ok {
		t.Fatalf("New(nil) returned %T, want *client", c)
	}
	if c.httpClient == http.DefaultClient {
		t.Fatal("New(nil) should not use http.DefaultClient")
	}
	if c.httpClient.Timeout != defaultHTTPTimeout {
		t.Fatalf("timeout = %s, want %s", c.httpClient.Timeout, defaultHTTPTimeout)
	}
	for i := range summaryCacheMaxEntries + 1 {
		c.cacheSummary(fmt.Sprintf("TICKER-%d", i), &quoteSummary{})
	}
	if len(c.summaryCache) != 1 {
		t.Fatalf("summary cache entries = %d, want 1 after clearing at limit", len(c.summaryCache))
	}
}

func TestMorningstarGroupCaseInsensitive(t *testing.T) {
	if got := morningstarGroup(" large blend ", nooplog.Logger); got != "US Equity" {
		t.Fatalf("morningstarGroup() = %q, want US Equity", got)
	}
}

func testClient(t *testing.T, handler http.HandlerFunc) *client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return newClient(server.Client(), server.URL+"/cookie", server.URL+"/crumb", server.URL+"/quoteSummary", nooplog.Logger)
}
