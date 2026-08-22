package simplefin

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"

	"tallyo/internal/clients"
	"tallyo/internal/money"
)

func simpleFinAmount(value string) (float64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, nil
	}
	amount, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, fmt.Errorf("not a finite number")
	}
	return amount, nil
}

func simpleFinMoney(value string) (float64, error) {
	amount, err := simpleFinAmount(value)
	if err != nil {
		return 0, err
	}
	if _, err := money.FromDollarsChecked(amount); err != nil {
		return 0, err
	}
	return amount, nil
}

func balanceTime(account clients.SimpleFinAccount, fallback time.Time) time.Time {
	if account.BalanceDate == 0 {
		return fallback.UTC()
	}
	return time.Unix(account.BalanceDate, 0).UTC()
}

func slugify(value string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}
