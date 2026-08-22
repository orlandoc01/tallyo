package yfinance

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/113.0"

const defaultHTTPTimeout = 10 * time.Second

type client struct {
	httpClient       *http.Client
	log              *slog.Logger
	cookieURL        string
	crumbURL         string
	quoteSummaryBase string

	mu           sync.Mutex
	crumb        *crumbState
	summaryCache map[string]cachedSummary
}

type crumbState struct {
	value        string
	cookieHeader string
	expiry       time.Time
}

type cachedSummary struct {
	summary *quoteSummary
	expires time.Time
}

type quoteSummary struct {
	result map[string]any
}

type YahooStatusError struct {
	StatusCode int
	Ticker     string
}

func (e YahooStatusError) Error() string {
	return fmt.Sprintf("yahoo quoteSummary status %d for %s", e.StatusCode, e.Ticker)
}

func IsNotFound(err error) bool {
	var statusErr YahooStatusError
	return errors.As(err, &statusErr) && statusErr.StatusCode == http.StatusNotFound
}

func newClient(httpClient *http.Client, cookieURL, crumbURL, quoteSummaryBase string, log *slog.Logger) *client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	return &client{httpClient: httpClient, log: log, cookieURL: cookieURL, crumbURL: crumbURL, quoteSummaryBase: strings.TrimRight(quoteSummaryBase, "/"), summaryCache: map[string]cachedSummary{}}
}

func (c *client) FetchFund(ctx context.Context, ticker string) (*FundReport, error) {
	summary, err := c.quoteSummary(ctx, ticker)
	if err != nil || summary == nil {
		return nil, err
	}
	fundProfile := object(summary.result["fundProfile"])
	category := stringValue(fundProfile["categoryName"])
	if strings.TrimSpace(category) == "" {
		return nil, nil
	}
	topHoldings := object(summary.result["topHoldings"])
	return &FundReport{
		Category:                    category,
		Group:                       morningstarGroup(category, c.log),
		CashPosition:                findFloat(topHoldings, "cashPosition"),
		StockPosition:               findFloat(topHoldings, "stockPosition"),
		BondPosition:                findFloat(topHoldings, "bondPosition"),
		PreferredPosition:           findFloat(topHoldings, "preferredPosition"),
		ConvertiblePosition:         findFloat(topHoldings, "convertiblePosition"),
		OtherPosition:               findFloat(topHoldings, "otherPosition"),
		SectorRealEstate:            findFloat(topHoldings, "realestate"),
		SectorConsumerCyclical:      findFloat(topHoldings, "consumer_cyclical"),
		SectorBasicMaterials:        findFloat(topHoldings, "basic_materials"),
		SectorConsumerDefensive:     findFloat(topHoldings, "consumer_defensive"),
		SectorTechnology:            findFloat(topHoldings, "technology"),
		SectorCommunicationServices: findFloat(topHoldings, "communication_services"),
		SectorFinancialServices:     findFloat(topHoldings, "financial_services"),
		SectorUtilities:             findFloat(topHoldings, "utilities"),
		SectorIndustrials:           findFloat(topHoldings, "industrials"),
		SectorEnergy:                findFloat(topHoldings, "energy"),
		SectorHealthcare:            findFloat(topHoldings, "healthcare"),
	}, nil
}

func (c *client) FetchEquity(ctx context.Context, ticker string) (*EquityReport, error) {
	summary, err := c.quoteSummary(ctx, ticker)
	if err != nil || summary == nil {
		return nil, err
	}
	profile := object(summary.result["summaryProfile"])
	sector := strings.TrimSpace(stringValue(profile["sector"]))
	if sector == "" {
		return nil, nil
	}
	return &EquityReport{Sector: sector}, nil
}

func (c *client) quoteSummary(ctx context.Context, ticker string) (*quoteSummary, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, nil
	}
	if summary := c.cachedSummary(ticker); summary != nil {
		return summary, nil
	}
	summary, status, err := c.fetchQuoteSummary(ctx, ticker, false)
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		c.invalidateCrumb()
		summary, status, err = c.fetchQuoteSummary(ctx, ticker, true)
	}
	if err != nil {
		return nil, err
	}
	if status >= 200 && status < 300 {
		c.cacheSummary(ticker, summary)
		return summary, nil
	}
	return nil, YahooStatusError{StatusCode: status, Ticker: ticker}
}

func (c *client) fetchQuoteSummary(ctx context.Context, ticker string, forceCrumb bool) (*quoteSummary, int, error) {
	crumb, err := c.getCrumb(ctx, forceCrumb)
	if err != nil {
		return nil, 0, err
	}
	endpoint := c.quoteSummaryBase + "/" + url.PathEscape(ticker)
	query := url.Values{}
	query.Set("modules", "quoteType,summaryProfile,fundProfile,topHoldings")
	query.Set("formatted", "false")
	query.Set("crumb", crumb.value)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	setRequestHeaders(req)
	req.Header.Set("Origin", "https://finance.yahoo.com")
	req.Header.Set("Referer", "https://finance.yahoo.com")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	if crumb.cookieHeader != "" {
		req.Header.Set("Cookie", crumb.cookieHeader)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.StatusCode, nil
	}
	summary, err := decodeQuoteSummary(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return summary, resp.StatusCode, nil
}

func (c *client) getCrumb(ctx context.Context, force bool) (crumbState, error) {
	c.mu.Lock()
	if c.crumb != nil && !force && time.Now().Before(c.crumb.expiry) {
		state := *c.crumb
		c.mu.Unlock()
		return state, nil
	}
	c.mu.Unlock()

	cookies, expiry, err := c.fetchCookies(ctx)
	if err != nil {
		return crumbState{}, fmt.Errorf("yahoo cookies: %w", err)
	}
	crumb, err := c.fetchCrumb(ctx, cookies)
	if err != nil {
		return crumbState{}, err
	}

	state := crumbState{value: crumb, cookieHeader: cookies, expiry: expiry}
	c.mu.Lock()
	c.crumb = &state
	c.mu.Unlock()
	return state, nil
}

func (c *client) fetchCookies(ctx context.Context) (string, time.Time, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cookieURL, nil)
	if err != nil {
		return "", time.Time{}, err
	}
	setRequestHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, err
	}
	defer func() { _ = resp.Body.Close() }()

	var parts []string
	expiry := time.Now().AddDate(1, 0, 0)
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "" {
			continue
		}
		parts = append(parts, cookie.Name+"="+cookie.Value)
		if cookie.MaxAge > 0 {
			cookieExpiry := time.Now().Add(time.Duration(cookie.MaxAge) * time.Second)
			if cookieExpiry.Before(expiry) {
				expiry = cookieExpiry
			}
		}
	}
	if len(parts) == 0 {
		return "", time.Time{}, fmt.Errorf("no cookies from yahoo (%s status %d)", c.cookieURL, resp.StatusCode)
	}
	return strings.Join(parts, "; "), expiry, nil
}

func (c *client) fetchCrumb(ctx context.Context, cookies string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.crumbURL, nil)
	if err != nil {
		return "", err
	}
	setRequestHeaders(req)
	req.Header.Set("Cookie", cookies)
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-site")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("yahoo crumb status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	crumb := strings.TrimSpace(string(body))
	if crumb == "" {
		return "", fmt.Errorf("empty yahoo crumb")
	}
	return crumb, nil
}

func setRequestHeaders(req *http.Request) {
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
}
