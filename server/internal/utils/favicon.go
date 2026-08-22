package utils

import (
	"net/url"
	"strings"
)

// DuckDuckGoFaviconURL returns the DuckDuckGo favicon service URL for the
// given website. The domain may include or omit a scheme; only the host is
// used. Returns nil if the website cannot be parsed to a valid host.
func DuckDuckGoFaviconURL(website string) *string {
	website = strings.TrimSpace(website)
	if website == "" {
		return nil
	}
	if strings.HasPrefix(website, "//") {
		website = "https:" + website
	} else if !strings.Contains(website, "://") {
		website = "https://" + website
	}
	u, err := url.Parse(website)
	if err != nil || u.Host == "" {
		return nil
	}
	faviconURL := "https://icons.duckduckgo.com/ip3/" + u.Hostname() + ".ico"
	return &faviconURL
}
