package dbutil

import "strings"

func SplitCSV(value string) []string {
	if value == "" {
		return []string{}
	}
	return strings.Split(value, ",")
}
