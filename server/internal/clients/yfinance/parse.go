package yfinance

import (
	"strconv"

	"github.com/samber/lo"
)

func object(value any) map[string]any {
	typed, ok := value.(map[string]any)
	return lo.Ternary(ok, typed, map[string]any{})
}

func array(value any) []any {
	typed, _ := value.([]any)
	return typed
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case map[string]any:
		if raw, ok := typed["raw"]; ok {
			return stringValue(raw)
		}
		if fmtValue, ok := typed["fmt"]; ok {
			return stringValue(fmtValue)
		}
	}
	return ""
}

func findFloat(value any, key string) float64 {
	found, _ := findFloatValue(value, key)
	return found
}

func findFloatValue(value any, key string) (float64, bool) {
	switch typed := value.(type) {
	case map[string]any:
		if candidate, ok := typed[key]; ok {
			if parsed, ok := floatValue(candidate); ok {
				return parsed, true
			}
		}
		for _, nested := range typed {
			if parsed, ok := findFloatValue(nested, key); ok {
				return parsed, true
			}
		}
	case []any:
		for _, nested := range typed {
			if parsed, ok := findFloatValue(nested, key); ok {
				return parsed, true
			}
		}
	}
	return 0, false
}

func floatValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return parsed, err == nil
	case map[string]any:
		if raw, ok := typed["raw"]; ok {
			return floatValue(raw)
		}
	}
	return 0, false
}
