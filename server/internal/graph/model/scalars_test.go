package model

import (
	"bytes"
	"testing"
	"time"

	"tallyo/internal/money"
	"tallyo/internal/utils/must"
)

func TestDateScalarValidatesDateOnly(t *testing.T) {
	var d Date
	must.NoErr(t, d.UnmarshalGQL("2026-05-20"))
	if err := d.UnmarshalGQL("2026-05-20T00:00:00Z"); err == nil {
		t.Fatalf("expected invalid date error")
	}
}

func TestMoneyScalar(t *testing.T) {
	var buf bytes.Buffer
	MarshalMoney(money.Cents(123)).MarshalGQL(&buf)
	value, err := UnmarshalMoney(1.23)
	if err != nil || value != 123 || buf.String() != "1.23" {
		t.Fatalf("Money = %d, %q, %v", value, buf.String(), err)
	}
}

func TestDateScalarMarshalsString(t *testing.T) {
	buf := bytes.Buffer{}
	Date("2026-05-20").MarshalGQL(&buf)
	if got := buf.String(); got != `"2026-05-20"` {
		t.Fatalf("MarshalGQL = %s", got)
	}
}

func TestDateTimeScalarMarshalsRFC3339(t *testing.T) {
	buf := bytes.Buffer{}
	MarshalDateTime(time.Date(2026, 5, 20, 12, 30, 0, 123, time.UTC)).MarshalGQL(&buf)
	if got := buf.String(); got != `"2026-05-20T12:30:00Z"` {
		t.Fatalf("MarshalDateTime = %s", got)
	}
}

func TestDateTimeScalarUnmarshal(t *testing.T) {
	dt, err := UnmarshalDateTime("2026-05-20T12:30:00Z")
	must.NoErr(t, err)
	if got := dt.Format(time.RFC3339); got != "2026-05-20T12:30:00Z" {
		t.Fatalf("UnmarshalDateTime() = %s", got)
	}
	if _, err := UnmarshalDateTime("2026-05-20T12:30:00.000Z"); err != nil {
		t.Fatalf("UnmarshalDateTime() milliseconds error = %v", err)
	}
	if _, err := UnmarshalDateTime("not-a-time"); err == nil {
		t.Fatalf("expected invalid datetime error")
	}
}

func TestDateScalarRejectsNonString(t *testing.T) {
	var d Date
	if err := d.UnmarshalGQL(20260520); err == nil {
		t.Fatalf("expected non-string date error")
	}
}

func TestDateMarshalJSON(t *testing.T) {
	got, err := Date("2026-05-20").MarshalJSON()
	must.NoErr(t, err)
	if string(got) != `"2026-05-20"` {
		t.Fatalf("MarshalJSON = %s", got)
	}
}

func TestDateUnmarshalJSON(t *testing.T) {
	var d Date
	must.NoErr(t, d.UnmarshalJSON([]byte(`"2026-05-20"`)))
	if string(d) != "2026-05-20" {
		t.Fatalf("UnmarshalJSON() result = %s", d)
	}
	if err := d.UnmarshalJSON([]byte(`"2026-05-20T00:00:00Z"`)); err == nil {
		t.Fatalf("expected invalid date error")
	}
	if err := d.UnmarshalJSON([]byte(`invalid`)); err == nil {
		t.Fatalf("expected non-string error")
	}
}
