package middleware

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/httprate"
)

type ClientIPResolver struct {
	state *clientIPResolverState
}

type clientIPResolverState struct {
	mu             sync.RWMutex
	trustedProxies []netip.Prefix
}

func NewClientIPResolver(trustedProxyCIDRs []string) (ClientIPResolver, error) {
	trustedProxies, err := ParseTrustedProxyCIDRs(trustedProxyCIDRs)
	if err != nil {
		return ClientIPResolver{}, err
	}
	return ClientIPResolver{state: &clientIPResolverState{trustedProxies: trustedProxies}}, nil
}

func (r ClientIPResolver) SetTrustedProxyCIDRs(trustedProxyCIDRs []string) error {
	trustedProxies, err := ParseTrustedProxyCIDRs(trustedProxyCIDRs)
	if err != nil {
		return err
	}
	r.state.mu.Lock()
	r.state.trustedProxies = trustedProxies
	r.state.mu.Unlock()
	return nil
}

// ParseTrustedProxyCIDRs parses trusted-proxy IPs or CIDRs using the same
// rules as the runtime client-IP resolver.
func ParseTrustedProxyCIDRs(trustedProxyCIDRs []string) ([]netip.Prefix, error) {
	trustedProxies := make([]netip.Prefix, 0, len(trustedProxyCIDRs))
	for _, value := range trustedProxyCIDRs {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := parseProxyPrefix(value)
		if err != nil {
			return nil, err
		}
		trustedProxies = append(trustedProxies, prefix)
	}
	return trustedProxies, nil
}

func RateLimitWithClientIP(
	requestLimit int,
	windowLength time.Duration,
	resolver ClientIPResolver,
) func(http.Handler) http.Handler {
	return httprate.LimitBy(
		requestLimit,
		windowLength,
		func(req *http.Request) (string, error) {
			return httprate.CanonicalizeIP(resolver.ClientIP(req)), nil
		},
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
		}),
	)
}

func (r ClientIPResolver) ClientIP(req *http.Request) string {
	remote := remoteAddr(req.RemoteAddr)
	remoteIP, err := netip.ParseAddr(remote)
	if err != nil || !r.isTrustedProxy(remoteIP) {
		return remote
	}
	if ip, ok := r.forwardedClientIP(req.Header.Get("X-Forwarded-For")); ok {
		return ip
	}
	if ip, ok := parseIPHeader(req.Header.Get("X-Real-IP")); ok {
		return ip
	}
	return remote
}

func remoteAddr(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return strings.TrimSpace(remoteAddr)
}

func parseProxyPrefix(value string) (netip.Prefix, error) {
	if addr, err := netip.ParseAddr(value); err == nil {
		return netip.PrefixFrom(addr, addr.BitLen()), nil
	}
	prefix, err := netip.ParsePrefix(value)
	if err != nil {
		return netip.Prefix{}, fmt.Errorf("parse trusted proxy CIDR %q: %w", value, err)
	}
	return prefix.Masked(), nil
}

func (r ClientIPResolver) forwardedClientIP(forwarded string) (string, bool) {
	if forwarded == "" {
		return "", false
	}
	addrs := []netip.Addr{}
	for part := range strings.SplitSeq(forwarded, ",") {
		addr, err := netip.ParseAddr(strings.TrimSpace(part))
		if err == nil {
			addrs = append(addrs, addr)
		}
	}
	if len(addrs) == 0 {
		return "", false
	}
	for _, addr := range slices.Backward(addrs) {
		if !r.isTrustedProxy(addr) {
			return addr.String(), true
		}
	}
	return addrs[0].String(), true
}

func (r ClientIPResolver) isTrustedProxy(addr netip.Addr) bool {
	r.state.mu.RLock()
	defer r.state.mu.RUnlock()
	for _, prefix := range r.state.trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func parseIPHeader(value string) (string, bool) {
	addr, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}
	return addr.String(), true
}
