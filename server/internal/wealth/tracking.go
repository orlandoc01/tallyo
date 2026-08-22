package wealth

import (
	"math"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
)

// NormalizeTracking collapses a supplied tracking ticker/multiplier into the
// canonical pair persisted everywhere: nil/1 when there is no genuine custom
// tracker (blank or self-referencing ticker), otherwise the trimmed ticker and
// the supplied multiplier. wealth/db is the common persistence sink, so this
// is exported for use there as well as in the service layer.
func NormalizeTracking(identifier string, ticker *string, multiplier float64) (*string, float64) {
	trimmed := strings.TrimSpace(lo.FromPtr(ticker))
	if trimmed == "" || strings.EqualFold(trimmed, strings.TrimSpace(identifier)) {
		return nil, 1
	}
	return &trimmed, multiplier
}

// validateTrackingMultiplier rejects non-finite and non-positive multipliers.
func validateTrackingMultiplier(multiplier float64) error {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier <= 0 {
		return apierror.Publicf("tracking multiplier must be a finite number greater than zero")
	}
	return nil
}
