package utils

import (
	"context"
	"strings"
	"time"
)

const FallbackTimezone = "America/New_York"

type timezoneContextKey struct{}

func ContextWithTimezone(ctx context.Context, tz string) context.Context {
	return context.WithValue(ctx, timezoneContextKey{}, NormalizeTimezone(tz))
}

func TimezoneFromContext(ctx context.Context) string {
	if tz, ok := ctx.Value(timezoneContextKey{}).(string); ok && tz != "" {
		return tz
	}
	return FallbackTimezone
}

func NormalizeTimezone(tz string) string {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		return FallbackTimezone
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return FallbackTimezone
	}
	return tz
}
