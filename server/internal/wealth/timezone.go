package wealth

import "time"

// LocalDate converts a UTC timestamp to a YYYY-MM-DD date string in the given
// IANA timezone. Falls back to UTC when the zone is empty or invalid.
func LocalDate(t time.Time, tz string) string {
	return t.In(loadLoc(tz)).Format("2006-01-02")
}

// UTCDate returns the UTC calendar-day bucket used for persisted snapshots.
func UTCDate(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// localNow returns the current instant in the given timezone, or UTC if the
// zone is empty/invalid.
func localNow(tz string) time.Time {
	return time.Now().In(loadLoc(tz))
}

// startOfDay returns midnight (00:00:00) of the given time's date in its
// location. Useful for converting a local date to a UTC boundary.
func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func loadLoc(tz string) *time.Location {
	if tz == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}
