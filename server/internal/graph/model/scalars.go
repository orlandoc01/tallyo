package model

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/99designs/gqlgen/graphql"

	"tallyo/internal/apierror"
	"tallyo/internal/money"
)

type Date string

func (d Date) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(string(d)))
}

func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(strconv.Quote(string(d))), nil
}

func (d *Date) UnmarshalGQL(v any) error {
	s, ok := v.(string)
	if !ok {
		return apierror.Publicf("date must be a string")
	}
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return apierror.Public(fmt.Errorf("date must use YYYY-MM-DD: %w", err))
	}
	*d = Date(s)
	return nil
}

func (d *Date) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return fmt.Errorf("date must use YYYY-MM-DD: %w", err)
	}
	*d = Date(s)
	return nil
}

// MarshalMoney writes a Money value as a JSON number of dollars —
// byte-identical to the Float wire format it replaced.
func MarshalMoney(c money.Cents) graphql.Marshaler {
	return graphql.MarshalFloat(c.Dollars())
}

func UnmarshalMoney(v any) (money.Cents, error) {
	dollars, err := graphql.UnmarshalFloat(v)
	if err != nil {
		return 0, apierror.Public(err)
	}
	cents, err := money.FromDollarsChecked(dollars)
	return cents, apierror.Public(err)
}

func MarshalDateTime(t time.Time) graphql.Marshaler {
	if t.IsZero() {
		return graphql.Null
	}
	return graphql.WriterFunc(func(w io.Writer) {
		_, _ = io.WriteString(w, strconv.Quote(t.UTC().Format(time.RFC3339)))
	})
}

func UnmarshalDateTime(v any) (time.Time, error) {
	parsed, err := graphql.UnmarshalTime(v)
	return parsed, apierror.Public(err)
}
