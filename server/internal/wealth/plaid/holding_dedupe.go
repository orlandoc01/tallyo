package plaid

import (
	"math"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

// reconcileTolerance bounds how far the de-duplicated holdings total may sit
// from the account's provider-reported current balance and still be accepted.
// The signal we discriminate (a roll-up doubles the total) is ~100%, so a 1%
// band comfortably absorbs cent-rounding across many lots without ever
// confusing a genuine 2x gap.
const reconcileTolerance = 0.01

// dedupeAggregateHoldings removes institution roll-up rows that some providers
// (e.g. Vanguard via Plaid) emit alongside per-tax-lot rows for the same
// security. Plaid's contract is one consolidated holding per (account,
// security); when an institution instead returns each tax lot as its own row
// PLUS a roll-up row, summing every row double-counts the position.
//
// Plaid exposes no field distinguishing a lot from a roll-up, and under
// Plaid-Version 2020-09-14 (the latest) the response carries no nested tax-lot
// data either, so detection is two-layered:
//
//  1. Candidate detector (aggregateRowIndex) — within a (account, security)
//     group, a row is a suspected roll-up when its quantity, value, and cost
//     basis each equal the sum of the other rows. cost_basis participates only
//     when present on every row in the group.
//  2. Arbiter — candidates are dropped only when doing so brings the account's
//     holdings total into agreement with the provider-reported account balance
//     (balances.current). If the de-duped total no longer matches that balance,
//     the rows are genuinely separate positions and are kept intact.
//
// The arbiter makes a false positive impossible for the failure mode that
// motivated it (three genuine lots a, b, a+b): dropping the a+b row would leave
// the holdings total at half the account balance, so the drop is rejected and
// every row is kept. accountBalances maps account ID to balances.current; an
// account with no reported balance cannot be arbitrated, so its rows are left
// untouched.
func dedupeAggregateHoldings(holdings []plaidapi.Holding, accountBalances map[string]*float64) []plaidapi.Holding {
	toAccountIndex := func(i int) (string, int) { return holdings[i].GetAccountId(), i }
	byAccount := lo.GroupByMap(lo.Range(len(holdings)), toAccountIndex)
	drop := map[int]bool{}
	for accountID, idxs := range byAccount {
		for _, i := range rollupRowsToDrop(holdings, idxs, accountBalances[accountID]) {
			drop[i] = true
		}
	}
	if len(drop) == 0 {
		return holdings
	}
	return lo.Filter(holdings, func(_ plaidapi.Holding, i int) bool { return !drop[i] })
}

// rollupRowsToDrop returns the holding indexes to drop for a single account: the
// per-security roll-up candidates, but only when removing them reconciles the
// account's holdings total with the provider-reported balance. Returns nil when
// there are no candidates, no balance to arbitrate against, or the
// reconciliation check fails.
func rollupRowsToDrop(holdings []plaidapi.Holding, idxs []int, balance *float64) []int {
	toSecurityIndex := func(i int) (string, int) { return holdings[i].GetSecurityId(), i }
	bySecurity := lo.GroupByMap(idxs, toSecurityIndex)
	candidates := []int{}
	for _, group := range bySecurity {
		if i, ok := aggregateRowIndex(holdings, group); ok {
			candidates = append(candidates, i)
		}
	}
	if len(candidates) == 0 || balance == nil {
		return nil
	}
	dropped := lo.Keyify(candidates)
	dedupedTotal := 0.0
	for _, i := range idxs {
		if _, ok := dropped[i]; ok {
			continue
		}
		dedupedTotal += holdings[i].GetInstitutionValue()
	}
	if !withinReconcileTolerance(dedupedTotal, *balance) {
		return nil
	}
	return candidates
}

// aggregateRowIndex returns the index of the single roll-up row within a
// (account, security) group, if one exists: the row whose quantity, value, and
// (when present on every row) cost basis each equal the sum of the other rows —
// equivalently, twice the row equals the group total. Returns false when no
// row, or more than one row, matches.
func aggregateRowIndex(holdings []plaidapi.Holding, idxs []int) (int, bool) {
	if len(idxs) < 2 {
		return 0, false
	}
	var sumQuantity, sumValue, sumCostBasis float64
	costBasisAvailable := true
	for _, i := range idxs {
		sumQuantity += holdings[i].GetQuantity()
		sumValue += holdings[i].GetInstitutionValue()
		if costBasis, ok := holdings[i].GetCostBasisOk(); ok && costBasis != nil {
			sumCostBasis += *costBasis
		} else {
			costBasisAvailable = false
		}
	}
	found := -1
	for _, i := range idxs {
		if !floatsApproxEqual(2*holdings[i].GetQuantity(), sumQuantity) {
			continue
		}
		if !floatsApproxEqual(2*holdings[i].GetInstitutionValue(), sumValue) {
			continue
		}
		if costBasisAvailable && !floatsApproxEqual(2*holdings[i].GetCostBasis(), sumCostBasis) {
			continue
		}
		if found != -1 {
			return 0, false
		}
		found = i
	}
	return found, found != -1
}

// floatsApproxEqual reports exact-sum equality up to floating-point noise — used
// to match a roll-up against the sum of its lots, which are exact in provider
// data.
func floatsApproxEqual(a, b float64) bool {
	return math.Abs(a-b) <= 1e-6*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
}

// withinReconcileTolerance reports whether a holdings total agrees with the
// provider-reported account balance within reconcileTolerance.
func withinReconcileTolerance(total, target float64) bool {
	return math.Abs(total-target) <= reconcileTolerance*math.Max(1, math.Abs(target))
}
