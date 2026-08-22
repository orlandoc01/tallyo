// Package syncerids holds canonical balance-sync adapter identifiers.
package syncerids

// ID identifies a balance-sync adapter and its snapshot source string.
type ID string

const (
	Plaid      ID = "plaid"
	SimpleFin  ID = "simplefin"
	Debank     ID = "debank"
	Manual     ID = "manual"
	RealEstate ID = "realestate"
)

func (i ID) Str() string {
	return string(i)
}
