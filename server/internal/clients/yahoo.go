package clients

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

const yahooBaseURL = "https://query1.finance.yahoo.com"

type Yahoo struct {
	HTTP    *http.Client
	BaseURL string
}

type yahooStatusError struct {
	StatusCode int
	Ticker     string
}

func (e yahooStatusError) Error() string {
	return fmt.Sprintf("yahoo returned %d for %s", e.StatusCode, e.Ticker)
}

func IsNotFound(err error) bool {
	var statusErr yahooStatusError
	return errors.As(err, &statusErr) && statusErr.StatusCode == http.StatusNotFound
}

func IsSyntheticYahooTicker(ticker string) bool {
	upper := strings.ToUpper(strings.TrimSpace(ticker))
	return strings.HasPrefix(upper, "PLAID:") || strings.HasPrefix(upper, "SIMPLEFIN:")
}

func NewYahoo(httpClient *http.Client) *Yahoo {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Yahoo{HTTP: httpClient, BaseURL: yahooBaseURL}
}

func (c *Yahoo) FetchPrice(ctx context.Context, ticker string, date time.Time) (float64, time.Time, error) {
	dateDay := date.UTC().Truncate(24 * time.Hour)
	endpoint := c.priceURL(ticker, dateDay, date)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "tallyo/1.0")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("http get: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return 0, time.Time{}, yahooStatusError{StatusCode: resp.StatusCode, Ticker: ticker}
	}

	var payload yahooChartResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return 0, time.Time{}, fmt.Errorf("decode response: %w", err)
	}
	if payload.Chart.Error != nil {
		return 0, time.Time{}, fmt.Errorf("yahoo error %s: %s", payload.Chart.Error.Code, payload.Chart.Error.Description)
	}
	if len(payload.Chart.Result) == 0 {
		return 0, time.Time{}, fmt.Errorf("no chart result for %s", ticker)
	}
	result := payload.Chart.Result[0]
	if yahooCurrentPriceDate(date) {
		price := result.Meta.RegularMarketPrice
		if price == 0 {
			return 0, time.Time{}, fmt.Errorf("zero regularMarketPrice for %s", ticker)
		}
		return price, time.Unix(result.Meta.RegularMarketTime, 0).UTC(), nil
	}

	return historicalClose(result, dateDay, ticker)
}

func (c *Yahoo) priceURL(ticker string, dateDay, date time.Time) string {
	ticker = url.PathEscape(ticker)
	if yahooCurrentPriceDate(date) {
		return fmt.Sprintf("%s/v8/finance/chart/%s?interval=1d&range=1d", c.BaseURL, ticker)
	}
	from := dateDay.AddDate(0, 0, -7).Unix()
	to := dateDay.Add(24 * time.Hour).Unix()
	return fmt.Sprintf("%s/v8/finance/chart/%s?interval=1d&period1=%d&period2=%d", c.BaseURL, ticker, from, to)
}

func yahooCurrentPriceDate(date time.Time) bool {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	return !date.UTC().Truncate(24 * time.Hour).Before(today)
}

type yahooChartResponse struct {
	Chart struct {
		Result []yahooChartResult `json:"result"`
		Error  *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

type yahooChartResult struct {
	Meta struct {
		RegularMarketPrice float64 `json:"regularMarketPrice"`
		RegularMarketTime  int64   `json:"regularMarketTime"`
	} `json:"meta"`
	Indicators struct {
		Quote []struct {
			Close []*float64 `json:"close"`
		} `json:"quote"`
	} `json:"indicators"`
	Timestamps []int64 `json:"timestamp"`
}

func historicalClose(result yahooChartResult, dateDay time.Time, ticker string) (float64, time.Time, error) {
	if len(result.Indicators.Quote) == 0 || len(result.Indicators.Quote[0].Close) == 0 {
		return 0, time.Time{}, fmt.Errorf("no historical quote data for %s on %s", ticker, dateDay.Format("2006-01-02"))
	}
	closes := result.Indicators.Quote[0].Close
	dayEnd := dateDay.Add(24 * time.Hour)
	for i, v := range slices.Backward(closes) {
		closeVal := v
		if closeVal == nil {
			continue
		}
		priceAt := historicalPriceTime(result.Timestamps, i, dateDay)
		if priceAt.Before(dayEnd) {
			return *closeVal, priceAt, nil
		}
	}
	return 0, time.Time{}, fmt.Errorf("no historical close for %s on or before %s", ticker, dateDay.Format("2006-01-02"))
}

func historicalPriceTime(timestamps []int64, index int, fallback time.Time) time.Time {
	if index >= 0 && index < len(timestamps) {
		return time.Unix(timestamps[index], 0).UTC()
	}
	return fallback.UTC()
}
