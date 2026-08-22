package clients

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"tallyo/internal/utils/must"
	"testing"
	"time"
)

func TestSimpleFinHTTPClientClaimAndGetAccounts(t *testing.T) {
	var sawAuth bool
	var sawQuery bool
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/claim":
			if r.Method != http.MethodPost {
				t.Fatalf("claim method = %s", r.Method)
			}
			_, _ = w.Write([]byte(strings.Replace(server.URL, "://", "://user:pass@", 1) + "/simplefin"))
		case "/simplefin/accounts":
			user, pass, ok := r.BasicAuth()
			sawAuth = ok && user == "user" && pass == "pass"
			sawQuery = r.URL.Query().Get("version") == "2" &&
				r.URL.Query().Get("pending") == "1" &&
				r.URL.Query().Get("start-date") != ""
			_, _ = w.Write([]byte(simpleFinAccountsWithHoldingsResponse))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := &SimpleFinHTTPClient{HTTP: server.Client()}
	setupToken := base64.StdEncoding.EncodeToString([]byte(server.URL + "/claim"))
	accessURL, err := client.Claim(context.Background(), setupToken)
	must.NoErr(t, err)
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	accounts, err := client.GetAccounts(context.Background(), accessURL, GetAccountsOpts{StartDate: &start, Pending: true})
	must.NoErr(t, err)
	if !sawAuth || !sawQuery || len(accounts.Connections) != 1 || len(accounts.Accounts) != 1 {
		t.Fatalf("auth=%v query=%v accounts=%#v", sawAuth, sawQuery, accounts)
	}
	if len(accounts.Accounts[0].Holdings) != 1 {
		t.Fatalf("holdings = %d, want 1", len(accounts.Accounts[0].Holdings))
	}
	holding := accounts.Accounts[0].Holdings[0]
	if holding.Shares != "3539.578" ||
		holding.MarketValue != "100736.38" ||
		holding.CostBasis != "155506.10" {
		t.Fatalf("holding numeric strings = %#v", holding)
	}
}

const simpleFinAccountsWithHoldingsResponse = `{
  "connections": [{"conn_id": "conn-1", "name": "Bank"}],
  "accounts": [{
    "id": "acc",
    "conn_id": "conn-1",
    "name": "Checking",
    "holdings": [{
      "id": "holding-1",
      "symbol": "VGIT",
      "description": "Vanguard Intermediate-Term Treasury Index Fund",
      "shares": "3539.578",
      "market_value": "100736.38",
      "cost_basis": "155506.10",
      "purchase_price": "21.9506",
      "currency": "USD",
      "created": 1780000000
    }]
  }]
}`

func TestSimpleFinHTTPClientClaimErrors(t *testing.T) {
	client := NewSimpleFinClient()
	if _, err := client.Claim(context.Background(), "not-base64"); err == nil {
		t.Fatal("Claim() expected decode error")
	}
	_, err := client.GetAccounts(context.Background(), "http://user:secret@bad host/simplefin", GetAccountsOpts{})
	if err == nil || err.Error() != "invalid simplefin access URL" || strings.Contains(err.Error(), "secret") {
		t.Fatalf("GetAccounts(unparseable) error = %v", err)
	}
}

func TestSimpleFinHTTPClientRejectsNonUSDCurrencies(t *testing.T) {
	var response string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(response))
	}))
	defer srv.Close()

	client := &SimpleFinHTTPClient{HTTP: srv.Client()}
	for _, response = range []string{
		`{"accounts":[{"currency":"EUR"}]}`,
		`{"accounts":[{"holdings":[{"currency":"EUR"}]}]}`,
	} {
		if _, err := client.GetAccounts(context.Background(), srv.URL, GetAccountsOpts{}); err == nil {
			t.Fatal("GetAccounts() expected currency error")
		}
	}
	client = &SimpleFinHTTPClient{HTTP: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusBadGateway, Body: failingBody{}, Header: http.Header{}}, nil
	})}}
	setupToken := base64.StdEncoding.EncodeToString([]byte("http://example.com"))
	if _, err := client.Claim(context.Background(), setupToken); !errors.Is(err, errResponseRead) {
		t.Fatalf("Claim() error = %v, want response read error", err)
	}
}

var errResponseRead = errors.New("response read failed")

type failingBody struct{}

func (failingBody) Read([]byte) (int, error) { return 0, errResponseRead }
func (failingBody) Close() error             { return nil }

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
