package accountsdb

import "tallyo/internal/graph/model"

// accountSubtypesByType maps each account type to the set of Plaid account
// subtype strings valid for it. Sourced from the Plaid account type schema.
// Plaid assigns a subtype on sync, but a user may reassign it to any value
// valid for the account's (possibly newly chosen) type.
var accountSubtypesByType = map[model.AccountType]map[string]struct{}{
	model.AccountTypeDepository: subtypeSet(
		"cash", "cash management", "cd", "checking", "ebt", "hsa",
		"limited purpose checking", "money market", "paypal", "prepaid", "savings",
	),
	model.AccountTypeCredit: subtypeSet(
		"credit card", "bank issued credit card", "paypal credit card",
	),
	model.AccountTypeLoan: subtypeSet(
		"auto", "business", "commercial", "construction", "consumer",
		"home equity", "line of credit", "loan", "mortgage", "overdraft", "student",
	),
	model.AccountTypeInvestment: subtypeSet(
		"529", "401a", "401k", "403B", "457b", "brokerage", "cash isa",
		"crypto exchange", "education savings account", "fhsa", "fixed annuity",
		"gic", "hra", "hsa", "ira", "isa", "keogh", "lif", "life insurance", "lira",
		"lrif", "lrsp", "mutual fund", "non custodial wallet",
		"non taxable brokerage account", "other annuity", "other insurance",
		"pension", "prif", "profit sharing plan", "qshr", "rdsp", "resp",
		"retirement", "rlif", "roth", "roth 401k", "roth 403B", "roth 457b",
		"roth pension", "roth profit sharing plan", "roth thrift savings plan",
		"rrif", "rrsp", "sarsep", "sep ira", "simple ira", "sipp", "stock plan",
		"tfsa", "thrift savings plan", "trust", "ugma", "utma", "variable annuity",
	),
	model.AccountTypeOther: subtypeSet("payroll", "other"),
}

func subtypeSet(subtypes ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(subtypes))
	for _, s := range subtypes {
		set[s] = struct{}{}
	}
	return set
}

func isValidSubtypeForType(accountType model.AccountType, subtype string) bool {
	valid, ok := accountSubtypesByType[accountType]
	if !ok {
		return false
	}
	_, ok = valid[subtype]
	return ok
}
