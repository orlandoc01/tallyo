package authdb

import (
	"strings"
)

func joinSpace(values []string) string { return strings.Join(values, " ") }

func splitSpace(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.Fields(value)
}
