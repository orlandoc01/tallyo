package wealth

import "strconv"

type InvestmentSnapshotDraft struct {
	Holdings []AssetDailyHolding
	Total    float64
	indexes  map[string]int
}

func NewInvestmentSnapshotDraft() *InvestmentSnapshotDraft {
	return &InvestmentSnapshotDraft{Holdings: []AssetDailyHolding{}, indexes: map[string]int{}}
}

func (d *InvestmentSnapshotDraft) Add(holding AssetDailyHolding) {
	assetID := strconv.FormatInt(holding.AssetID, 10)
	if holding.Asset != nil {
		assetID = holding.Asset.Identifier
	}
	if idx, ok := d.indexes[assetID]; ok {
		existing := &d.Holdings[idx]
		if existing.Quantity == nil || holding.Quantity == nil {
			existing.Quantity = nil
		} else {
			sum := *existing.Quantity + *holding.Quantity
			existing.Quantity = &sum
		}
		existing.ValueUSD += holding.ValueUSD
		// Keep the first non-nil per-share price; lots can share a symbol with different prices.
		if existing.Price == nil {
			existing.Price = holding.Price
		}
		d.Total += holding.ValueUSD
		return
	}
	d.indexes[assetID] = len(d.Holdings)
	d.Holdings = append(d.Holdings, holding)
	d.Total += holding.ValueUSD
}
