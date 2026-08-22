package simplefin

import (
	"math"
	"strconv"
	"testing"
	"time"

	"tallyo/internal/clients"
)

func TestSimpleFinAmounts(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		money   bool
		want    float64
		wantErr bool
	}{
		{name: "blank", want: 0},
		{name: "ordinary", value: "42.50", want: 42.5},
		{name: "nan", value: "NaN", wantErr: true},
		{name: "positive infinity", value: "Inf", wantErr: true},
		{name: "negative infinity", value: "-Inf", wantErr: true},
		{name: "money overflow", value: "1e300", money: true, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parse := simpleFinAmount
			if test.money {
				parse = simpleFinMoney
			}
			got, err := parse(test.value)
			if (err != nil) != test.wantErr || err == nil && got != test.want {
				t.Fatalf("parse(%q) = %v, %v", test.value, got, err)
			}
		})
	}
}

func TestHoldingLineRejectsInfinitePrice(t *testing.T) {
	_, _, err := holdingLine(clients.SimpleFinHolding{
		Shares:      strconv.FormatFloat(math.SmallestNonzeroFloat64, 'g', -1, 64),
		MarketValue: "1",
	}, time.Now())
	if err == nil {
		t.Fatal("holdingLine() error = nil, want infinite price rejection")
	}
}
