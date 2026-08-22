package wealth

import (
	"context"
	"log/slog"
	"sync"
	"time"

	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
)

type PriceProvider interface {
	PriceAt(ctx context.Context, asset *model.Asset, date time.Time) (float64, error)
}

// tickerValidator is an optional capability for price providers that can
// definitively distinguish an unknown ticker from a transient upstream failure.
// Providers that cannot tell the two apart should not implement it, so callers
// fall back to a price probe.
type tickerValidator interface {
	ValidateTicker(ctx context.Context, ticker string) error
}

// Compile-time checks that each provider satisfies PriceProvider.
var (
	_ PriceProvider = (*YahooPriceProvider)(nil)

	// The Yahoo provider can distinguish an unknown ticker from a transient
	// failure, so it also implements the optional tickerValidator capability.
	_ tickerValidator = (*YahooPriceProvider)(nil)
)

type YahooPriceProvider struct {
	Store   AssetPriceStore
	Log     *slog.Logger
	Client  *apiClients.Yahoo
	cacheMu sync.Mutex
	cache   map[string]yahooCachedPrice
	Now     func() time.Time
}
