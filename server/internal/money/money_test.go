package money

import (
	"encoding/json"
	"math"
	"tallyo/internal/utils/must"
	"testing"
)

func TestCentsJSONRoundTrip(t *testing.T) {
	tests := []struct {
		cents Cents
		wire  string
	}{
		{cents: 1234, wire: "12.34"},
		{cents: -1, wire: "-0.01"},
		{cents: 0, wire: "0"},
		{cents: 100000, wire: "1000"},
	}
	for _, test := range tests {
		t.Run(test.wire, func(t *testing.T) {
			raw, err := json.Marshal(test.cents)
			must.NoErr(t, err)
			if string(raw) != test.wire {
				t.Errorf("Marshal(%d) = %s, want %s", test.cents, raw, test.wire)
			}
			var got Cents
			must.NoErr(t, json.Unmarshal(raw, &got))
			if got != test.cents {
				t.Errorf("round trip = %d, want %d", got, test.cents)
			}
		})
	}
}

func TestCentsUnmarshalJSONRejectsNonNumbers(t *testing.T) {
	var c Cents
	if err := json.Unmarshal([]byte(`"12.34"`), &c); err == nil {
		t.Fatal("expected error for quoted string")
	}
}

func TestFromDollars(t *testing.T) {
	tests := []struct {
		name    string
		dollars float64
		want    Cents
	}{
		{name: "positive", dollars: 12.345, want: 1235},
		{name: "negative", dollars: -12.345, want: -1235},
		{name: "float dust", dollars: 4.5600000000000005, want: 456},
		{name: "zero", dollars: 0, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := FromDollars(test.dollars); got != test.want {
				t.Errorf("FromDollars(%v) = %d, want %d", test.dollars, got, test.want)
			}
		})
	}
}

func TestFromDollarsCheckedRejectsPositiveOverflow(t *testing.T) {
	if _, err := FromDollarsChecked(float64(math.MaxInt64) / 100); err == nil {
		t.Fatal("expected cents overflow")
	}
}

func TestCentsDollars(t *testing.T) {
	if got := Cents(-12345).Dollars(); got != -123.45 {
		t.Errorf("Dollars() = %v, want -123.45", got)
	}
}

func TestParseDecimal(t *testing.T) {
	tests := []struct {
		value string
		want  Cents
	}{
		{value: "12", want: 1200},
		{value: "12.3", want: 1230},
		{value: "12.34", want: 1234},
		{value: "-0.01", want: -1},
		{value: "+.5", want: 50},
		{value: "92233720368547758.07", want: Cents(math.MaxInt64)},
		{value: "-92233720368547758.08", want: Cents(math.MinInt64)},
	}
	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, err := ParseDecimal(test.value)
			must.NoErr(t, err)
			if got != test.want {
				t.Errorf("ParseDecimal(%q) = %d, want %d", test.value, got, test.want)
			}
		})
	}
}

func TestParseDecimalRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"", "+", "1.234", "1.2.3", " 1.00", "1e2", "92233720368547758.08", "-92233720368547758.09"} {
		t.Run(value, func(t *testing.T) {
			if _, err := ParseDecimal(value); err == nil {
				t.Fatalf("ParseDecimal(%q): expected error", value)
			}
		})
	}
}
