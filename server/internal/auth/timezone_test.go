package auth

import (
	"testing"

	u "tallyo/internal/utils"
)

func TestTimezoneCache(t *testing.T) {
	cache := NewTimezoneCache("America/New_York")
	if got := cache.Get(); got != "America/New_York" {
		t.Fatalf("initial cache = %q", got)
	}
	cache.Set("America/Los_Angeles")
	if got := cache.Get(); got != "America/Los_Angeles" {
		t.Fatalf("updated cache = %q", got)
	}
	cache.Set("Not/AZone")
	if got := cache.Get(); got != u.FallbackTimezone {
		t.Fatalf("invalid cache = %q", got)
	}
}
