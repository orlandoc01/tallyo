package clients

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"tallyo/internal/utils/must"
	"testing"
	"time"
)

func TestComputeSign(t *testing.T) {
	sig := computeSign(
		"GET",
		"/portfolio/project_list",
		"user_addr=0xf7462c16f1eea90bc62cee10b4c66c656a752e18",
		"5pEP9tZtR3FrPS4GXw9CtBIOwdCcuIUt4q8uWalg",
		1772823398,
	)
	const want = "8feafea5421746b160e84bdcaaec8549f69c5588198f6d66b1e3b4ded2783d0b"
	if sig != want {
		t.Errorf("computeSign = %q, want %q", sig, want)
	}
}

func TestDebankNonce(t *testing.T) {
	n := debankNonce()
	if len(n) != 40 {
		t.Errorf("nonce length = %d, want 40", len(n))
	}
	for _, ch := range n {
		if !strings.ContainsRune(nonceChars, ch) {
			t.Errorf("nonce contains invalid char %q", ch)
		}
	}
}

func TestDebankHex(t *testing.T) {
	var b [32]byte
	b[0] = 0xde
	b[1] = 0xad
	b[31] = 0xff
	got := debankHex(b)
	if !strings.HasPrefix(got, "dead") {
		t.Errorf("debankHex prefix = %q, want 'dead...'", got[:4])
	}
	if !strings.HasSuffix(got, "ff") {
		t.Errorf("debankHex suffix = %q, want '...ff'", got[len(got)-2:])
	}
	if len(got) != 64 {
		t.Errorf("debankHex length = %d, want 64", len(got))
	}
}

func TestXorHexBytes(t *testing.T) {
	if xorHexBytes("ab", 0) != "ab" {
		t.Error("xorHexBytes with key 0 should be identity")
	}
	if xorHexBytes(xorHexBytes("hello", 54), 54) != "hello" {
		t.Error("xor roundtrip failed")
	}
}

func TestDebankBalanceListAndTokenParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-sign") == "" {
			http.Error(w, "missing auth header", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/token/balance_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"chain": "eth", "id": "eth", "symbol": "ETH", "name": "Ethereum", "price": 2000.0, "amount": 1.5, "usd_value": 3000.0}}}) //nolint:errcheck
		case "/token":
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"chain": "base", "id": "0xpool", "symbol": "POOL", "name": "Pool Token", "price": 12.5}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	client := &Debank{HTTP: srv.Client(), BaseURL: srv.URL}
	tokens, err := client.BalanceList(context.Background(), "0xabc", "eth")
	if err != nil || len(tokens) != 1 || tokens[0].Symbol != "ETH" {
		t.Fatalf("BalanceList() = %#v, %v", tokens, err)
	}
	metadata, err := client.Token(context.Background(), "base", "0xpool")
	if err != nil || metadata.Symbol != "POOL" || metadata.Price != 12.5 {
		t.Fatalf("Token() = %#v, %v", metadata, err)
	}
}

func TestDebankProjectList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []json.RawMessage{json.RawMessage(`{"chain":"base","id":"beefy","name":"Beefy","portfolio_item_list":[{"pool":{"id":"0xpool"},"stats":{"net_usd_value":12.5}}]}`)}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	client := &Debank{HTTP: srv.Client(), BaseURL: srv.URL}
	projects, raw, err := client.ProjectList(context.Background(), "0xABC")
	if err != nil || len(projects) != 1 || raw == "" {
		t.Fatalf("ProjectList() = %#v raw=%q err=%v", projects, raw, err)
	}
}

func TestDebankChainList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"chains": []map[string]any{ //nolint:errcheck
			{"id": "eth", "name": "Ethereum", "network_id": 1},
			{"id": "base", "name": "Base", "network_id": 8453},
		}}})
	}))
	defer srv.Close()

	chains, err := (&Debank{HTTP: srv.Client(), BaseURL: srv.URL}).ChainList(context.Background())
	must.NoErr(t, err)
	if len(chains) != 2 || chains[0] != (DebankChain{ID: "eth", Name: "Ethereum"}) {
		t.Fatalf("ChainList() = %#v", chains)
	}
}

func TestDebankSignedGetSetsHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-nonce") == "" || r.Header.Get("x-api-sign") == "" || r.Header.Get("x-api-ts") == "" || r.Header.Get("x-api-ver") != "v2" {
			http.Error(w, "missing auth header", http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
	}))
	defer srv.Close()

	client := &Debank{HTTP: srv.Client(), BaseURL: srv.URL}
	if _, err := client.signedGet(context.Background(), "/token/balance_list", "chain=eth&user_addr=0xtest"); err != nil {
		t.Fatalf("signedGet() error = %v", err)
	}

	nonce, ts, sig := debankSign("GET", "/token/balance_list", "chain=eth&user_addr=0xtest")
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/token/balance_list?chain=eth&user_addr=0xtest", nil)
	req.Header.Set("x-api-nonce", "n_"+nonce)
	req.Header.Set("x-api-sign", sig)
	req.Header.Set("x-api-ts", strconv.FormatInt(ts, 10))
	req.Header.Set("x-api-ver", "v2")
	resp, err := client.HTTP.Do(req)
	if err != nil {
		t.Fatalf("manual request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
}

func TestSmokeDebankVitalikWallet(t *testing.T) {
	if os.Getenv("RUN_SMOKE_TESTS") != "1" {
		t.Skip("set RUN_SMOKE_TESTS=1 to run Debank smoke test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	debank := NewDebank(&http.Client{Timeout: 30 * time.Second})
	debankWallet := "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"

	tokens, err := debank.BalanceList(ctx, debankWallet, "eth")
	must.NoErr(t, err)
	if len(tokens) == 0 {
		t.Fatalf("BalanceList(%s, eth) returned no tokens", debankWallet)
	}

	eth, err := debank.Token(ctx, "eth", "eth")
	must.NoErr(t, err)
	if eth == nil || eth.Symbol == "" || eth.Price <= 0 {
		t.Fatalf("Token(eth, eth) = %#v, want symbol and positive price", eth)
	}
	t.Logf("Debank ETH token: symbol=%q price=%.2f", eth.Symbol, eth.Price)
}

func TestSmokeDebankChainList(t *testing.T) {
	if os.Getenv("RUN_SMOKE_TESTS") != "1" {
		t.Skip("set RUN_SMOKE_TESTS=1 to run Debank smoke test")
	}
	live, err := NewDebank(&http.Client{Timeout: 30 * time.Second}).ChainList(context.Background())
	must.NoErr(t, err)
	liveByID := make(map[string]string, len(live))
	for _, chain := range live {
		liveByID[chain.ID] = chain.Name
	}
	staticByID := make(map[string]string, len(DebankChains))
	for _, chain := range DebankChains {
		staticByID[chain.ID] = chain.Name
	}
	added := []string{}
	removed := []string{}
	renamed := []string{}
	for id, name := range liveByID {
		staticName, found := staticByID[id]
		switch {
		case !found:
			added = append(added, id+"="+name)
		case staticName != name:
			renamed = append(renamed, id+"="+staticName+" -> "+name)
		}
	}
	for id, name := range staticByID {
		if _, found := liveByID[id]; !found {
			removed = append(removed, id+"="+name)
		}
	}
	slices.Sort(added)
	slices.Sort(removed)
	slices.Sort(renamed)
	if len(added)+len(removed)+len(renamed) > 0 {
		t.Fatalf("Debank chain list drifted\nadded: %s\nremoved: %s\nrenamed: %s", strings.Join(added, ", "), strings.Join(removed, ", "), strings.Join(renamed, ", "))
	}
}
