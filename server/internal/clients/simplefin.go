package clients

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SimpleFinConnection is the v2 connection object from the SimpleFIN bridge.
type SimpleFinConnection struct {
	ConnID  string `json:"conn_id"`
	Name    string `json:"name"`
	OrgID   string `json:"org_id"`
	OrgName string `json:"org_name"`
	OrgURL  string `json:"org_url"`
	SfinURL string `json:"sfin_url"`
}

// SimpleFinAccount is a single account from GET /accounts?version=2.
type SimpleFinAccount struct {
	ID               string                 `json:"id"`
	ConnID           string                 `json:"conn_id"`
	Name             string                 `json:"name"`
	Currency         string                 `json:"currency"`
	Balance          string                 `json:"balance"`
	AvailableBalance string                 `json:"available-balance"`
	BalanceDate      int64                  `json:"balance-date"`
	Transactions     []SimpleFinTransaction `json:"transactions"`
	Holdings         []SimpleFinHolding     `json:"holdings"`
	Extra            map[string]any         `json:"extra"`
}

// SimpleFinTransaction is one transaction from the SimpleFIN API.
type SimpleFinTransaction struct {
	ID           string         `json:"id"`
	Posted       int64          `json:"posted"`
	TransactedAt int64          `json:"transacted_at"`
	Amount       string         `json:"amount"`
	Description  string         `json:"description"`
	Payee        string         `json:"payee"`
	Memo         string         `json:"memo"`
	Pending      bool           `json:"pending"`
	Extra        map[string]any `json:"extra"`
}

// SimpleFinHolding is a portfolio holding (investment accounts only).
type SimpleFinHolding struct {
	ID            string `json:"id"`
	Symbol        string `json:"symbol"`
	Description   string `json:"description"`
	Shares        string `json:"shares"`
	MarketValue   string `json:"market_value"`
	CostBasis     string `json:"cost_basis"`
	PurchasePrice string `json:"purchase_price"`
	Currency      string `json:"currency"`
	Created       int64  `json:"created"`
}

// SimpleFinAccountSet is the v2 response from GET /accounts.
type SimpleFinAccountSet struct {
	Connections []SimpleFinConnection `json:"connections"`
	Accounts    []SimpleFinAccount    `json:"accounts"`
	Errors      []SimpleFinError      `json:"errlist"`
}

// SimpleFinError is a per-connection error from the SimpleFIN errlist.
type SimpleFinError struct {
	ConnID  string `json:"conn_id"`
	Message string `json:"message"`
}

// GetAccountsOpts carries optional parameters for GetAccounts.
type GetAccountsOpts struct {
	StartDate *time.Time
	Pending   bool
}

// SimpleFinClient is the interface for the SimpleFIN HTTP adapter.
type SimpleFinClient interface {
	// Claim decodes the Setup Token and POSTs to the claim URL to obtain the Access URL.
	Claim(ctx context.Context, setupToken string) (string, error)
	// GetAccounts calls GET /accounts?version=2 on the Access URL.
	GetAccounts(ctx context.Context, accessURL string, opts GetAccountsOpts) (SimpleFinAccountSet, error)
}

// SimpleFinHTTPClient is a stateless HTTP adapter for the SimpleFIN protocol.
type SimpleFinHTTPClient struct {
	HTTP *http.Client
}

var _ SimpleFinClient = (*SimpleFinHTTPClient)(nil)

func NewSimpleFinClient() *SimpleFinHTTPClient {
	return &SimpleFinHTTPClient{HTTP: &http.Client{Timeout: 30 * time.Second}}
}

// Claim decodes the base64 Setup Token to get the claim URL, then POSTs to it.
func (c *SimpleFinHTTPClient) Claim(ctx context.Context, setupToken string) (string, error) {
	claimURLBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(setupToken))
	if err != nil {
		return "", fmt.Errorf("decode setup token: %w", err)
	}
	claimURL := strings.TrimSpace(string(claimURLBytes))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claimURL, http.NoBody)
	if err != nil {
		return "", fmt.Errorf("build claim request: %w", err)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("claim request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusForbidden {
		return "", fmt.Errorf("setup token already claimed (HTTP 403)")
	}
	if resp.StatusCode != http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", fmt.Errorf("read claim error response: %w", err)
		}
		return "", fmt.Errorf("claim failed with HTTP %d: %s", resp.StatusCode, string(body))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read claim response: %w", err)
	}
	accessURL := strings.TrimSpace(string(body))
	if accessURL == "" {
		return "", fmt.Errorf("empty access URL returned by claim endpoint")
	}
	if _, err := url.Parse(accessURL); err != nil {
		return "", errors.New("invalid simplefin access URL")
	}
	return accessURL, nil
}

// GetAccounts calls GET /accounts?version=2 on the Access URL.
func (c *SimpleFinHTTPClient) GetAccounts(ctx context.Context, accessURL string, opts GetAccountsOpts) (SimpleFinAccountSet, error) {
	endpoint, err := buildAccountsURL(accessURL, opts)
	if err != nil {
		return SimpleFinAccountSet{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return SimpleFinAccountSet{}, fmt.Errorf("build accounts request: %w", err)
	}
	injectBasicAuth(req, accessURL)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return SimpleFinAccountSet{}, fmt.Errorf("accounts request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return SimpleFinAccountSet{}, fmt.Errorf("read accounts error response: %w", err)
		}
		return SimpleFinAccountSet{}, fmt.Errorf("accounts request failed with HTTP %d: %s", resp.StatusCode, string(body))
	}
	var result SimpleFinAccountSet
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return SimpleFinAccountSet{}, fmt.Errorf("decode accounts response: %w", err)
	}
	if err := validateSimpleFinCurrencies(result); err != nil {
		return SimpleFinAccountSet{}, err
	}
	return result, nil
}

// buildAccountsURL appends the /accounts path and query params to the Access URL.
func buildAccountsURL(accessURL string, opts GetAccountsOpts) (string, error) {
	// Sanitized error: the raw URL can embed Basic Auth credentials and
	// url.Parse errors echo their input.
	u, err := url.Parse(accessURL)
	if err != nil {
		return "", errors.New("invalid simplefin access URL")
	}
	// Clear credentials from URL; they go in the Authorization header.
	u.User = nil
	// Ensure path ends with /accounts.
	if !strings.HasSuffix(u.Path, "/accounts") {
		u.Path = strings.TrimRight(u.Path, "/") + "/accounts"
	}
	q := u.Query()
	q.Set("version", "2")
	if opts.Pending {
		q.Set("pending", "1")
	}
	if opts.StartDate != nil {
		q.Set("start-date", fmt.Sprintf("%d", opts.StartDate.Unix()))
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func validateSimpleFinCurrencies(accountSet SimpleFinAccountSet) error {
	for _, account := range accountSet.Accounts {
		if account.Currency != "" && !strings.EqualFold(account.Currency, "USD") {
			return fmt.Errorf("unsupported simplefin account currency %q", account.Currency)
		}
		for _, holding := range account.Holdings {
			if holding.Currency != "" && !strings.EqualFold(holding.Currency, "USD") {
				return fmt.Errorf("unsupported simplefin holding currency %q", holding.Currency)
			}
		}
	}
	return nil
}

// injectBasicAuth extracts userinfo from the Access URL and sets the Authorization header.
func injectBasicAuth(req *http.Request, accessURL string) {
	u, err := url.Parse(accessURL)
	if err != nil || u.User == nil {
		return
	}
	user := u.User.Username()
	pass, _ := u.User.Password()
	req.SetBasicAuth(user, pass)
}
