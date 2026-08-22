package auth

import (
	"net"
	"net/url"
	"slices"
	"strings"
)

// isAllowedDynamicRedirectURI accepts issuer/allowlisted HTTPS hosts, local HTTP,
// and private native-app schemes. This prevents arbitrary web callbacks while
// preserving explicit third-party MCP clients.
func isAllowedDynamicRedirectURI(uri string, issuerURL string, allowedHosts []string) bool {
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme == "" || parsed.Fragment != "" || parsed.User != nil {
		return false
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		return isAllowedHTTPSRedirectHost(parsed.Hostname(), issuerURL, allowedHosts)
	case "http":
		return isLocalRedirectHost(parsed.Hostname())
	case "javascript", "data", "file", "vbscript", "about", "blob", "mailto":
		return false
	default:
		// Native and desktop OAuth clients commonly use private URI schemes.
		return true
	}
}

func isAllowedHTTPSRedirectHost(host string, issuerURL string, allowedHosts []string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if issuerHost := issuerHostname(issuerURL); issuerHost != "" && host == issuerHost {
		return true
	}
	isAllowedHost := func(allowed string) bool { return host == strings.ToLower(strings.TrimSpace(allowed)) }
	return slices.ContainsFunc(allowedHosts, isAllowedHost)
}

func issuerHostname(issuerURL string) string {
	parsed, err := url.Parse(issuerURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

func isLocalRedirectHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
