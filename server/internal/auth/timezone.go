package auth

import (
	"sync"

	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

type TimezoneCache struct {
	mu sync.RWMutex
	tz string
}

func NewTimezoneCache(tz string) *TimezoneCache {
	c := &TimezoneCache{}
	c.Set(tz)
	return c
}

func (c *TimezoneCache) Get() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return lo.Ternary(c.tz == "", u.FallbackTimezone, c.tz)
}

func (c *TimezoneCache) Set(tz string) {
	tz = u.NormalizeTimezone(tz)
	c.mu.Lock()
	c.tz = tz
	c.mu.Unlock()
}

func (s *Service) SetTimezone(tz string) {
	s.timezones.Set(tz)
}

func (s *Service) Timezone() string {
	return s.timezones.Get()
}

func timezoneFromConfig(cfg Config) string {
	if cfg.Timezone == nil {
		return u.FallbackTimezone
	}
	return u.NormalizeTimezone(cfg.Timezone())
}
