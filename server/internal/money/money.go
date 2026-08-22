package money

import (
	"cmp"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Cents is an exact USD amount in cents.
type Cents int64

// FromDollars rounds dollars to cents, half away from zero. Only use at
// trusted provider/calculation edges; parsing boundaries should use
// FromDollarsChecked.
func FromDollars(dollars float64) Cents {
	return Cents(math.Round(dollars * 100))
}

// FromDollarsChecked rounds dollars to cents, rejecting NaN, infinities, and
// magnitudes that would overflow int64 cents. Use at JSON/GraphQL/query
// parsing boundaries.
func FromDollarsChecked(dollars float64) (Cents, error) {
	if math.IsNaN(dollars) || math.IsInf(dollars, 0) {
		return 0, fmt.Errorf("parse money %v: not a finite number", dollars)
	}
	cents := math.Round(dollars * 100)
	if cents < math.MinInt64 || cents >= math.MaxInt64 {
		return 0, fmt.Errorf("parse money %v: cents overflow", dollars)
	}
	return Cents(cents), nil
}

// Dollars returns the amount in dollars.
func (c Cents) Dollars() float64 {
	return float64(c) / 100
}

// MarshalJSON serializes as a JSON number of dollars: every wire format
// (GraphQL, MCP, cursors) speaks dollars while Go and the DB keep cents.
func (c Cents) MarshalJSON() ([]byte, error) {
	return strconv.AppendFloat(nil, c.Dollars(), 'f', -1, 64), nil
}

func (c *Cents) UnmarshalJSON(data []byte) error {
	dollars, err := strconv.ParseFloat(string(data), 64)
	if err != nil {
		return fmt.Errorf("parse money %q: %w", data, err)
	}
	cents, err := FromDollarsChecked(dollars)
	if err != nil {
		return fmt.Errorf("parse money %q: %w", data, err)
	}
	*c = cents
	return nil
}

// ParseDecimal parses a decimal USD amount with at most two fractional digits.
func ParseDecimal(value string) (Cents, error) {
	if value == "" {
		return 0, fmt.Errorf("parse money: empty value")
	}

	negative := false
	switch value[0] {
	case '-':
		negative = true
		value = value[1:]
	case '+':
		value = value[1:]
	}
	if value == "" {
		return 0, fmt.Errorf("parse money: missing digits")
	}

	dollars, fraction, _ := strings.Cut(value, ".")
	dollars = cmp.Or(dollars, "0")
	if len(fraction) > 2 {
		return 0, fmt.Errorf("parse money %q: more than two fractional digits", value)
	}
	if fraction == "" {
		fraction = "00"
	} else if len(fraction) == 1 {
		fraction += "0"
	}
	if !decimalDigits(dollars) || !decimalDigits(fraction) {
		return 0, fmt.Errorf("parse money %q: invalid decimal", value)
	}

	magnitude, err := strconv.ParseUint(dollars+fraction, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse money %q: %w", value, err)
	}
	maxMagnitude := uint64(math.MaxInt64)
	if negative {
		maxMagnitude++
	}
	if magnitude > maxMagnitude {
		return 0, fmt.Errorf("parse money %q: cents overflow", value)
	}
	if negative {
		if magnitude == maxMagnitude {
			return Cents(math.MinInt64), nil
		}
		return -Cents(magnitude), nil
	}
	return Cents(magnitude), nil
}

func decimalDigits(value string) bool {
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return value != ""
}
