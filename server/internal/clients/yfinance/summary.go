package yfinance

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// summaryCacheMaxEntries bounds the short-lived per-ticker cache.
const summaryCacheMaxEntries = 256

func decodeQuoteSummary(body io.Reader) (*quoteSummary, error) {
	var payload map[string]any
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		return nil, err
	}
	root := object(payload["quoteSummary"])
	if errValue := root["error"]; errValue != nil {
		return nil, fmt.Errorf("yahoo quoteSummary error: %v", errValue)
	}
	results := array(root["result"])
	if len(results) == 0 {
		return nil, nil
	}
	result := object(results[0])
	if len(result) == 0 {
		return nil, nil
	}
	return &quoteSummary{result: result}, nil
}

func (c *client) cachedSummary(ticker string) *quoteSummary {
	c.mu.Lock()
	defer c.mu.Unlock()
	cached, ok := c.summaryCache[ticker]
	if !ok || time.Now().After(cached.expires) {
		delete(c.summaryCache, ticker)
		return nil
	}
	return cached.summary
}

func (c *client) cacheSummary(ticker string, summary *quoteSummary) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.summaryCache[ticker]; !exists && len(c.summaryCache) == summaryCacheMaxEntries {
		clear(c.summaryCache)
	}
	c.summaryCache[ticker] = cachedSummary{summary: summary, expires: time.Now().Add(30 * time.Second)}
}

func (c *client) invalidateCrumb() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.crumb = nil
}
