package accounts

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

// typeKeywords maps account name keywords to an AccountType. Order matters:
// more specific patterns should come before more generic ones.
var (
	depositoryRE        = regexp.MustCompile(`(?i)\b(checking|savings|money\s+market|cd|hsa|cash\s+mgmt|cash\s+management|high\s+yield)\b`)
	creditRE            = regexp.MustCompile(`(?i)\b(card|credit|visa|mastercard|amex|american\s+express|freedom|sapphire|platinum|gold|blue\s+cash|hyatt|gateway|mileage|rewards|cashback)\b`)
	loanRE              = regexp.MustCompile(`(?i)\b(loan|mortgage|auto|heloc|student|line\s+of\s+credit)\b`)
	simpleFinNameMaskRE = regexp.MustCompile(`\s+\(([0-9]+)\)\s*$`)
)

// SimpleFinAccessTokenSecret carries the access_url and scheduling state for
// use by the sync adapter; it is never exposed via GraphQL.
type SimpleFinAccessTokenSecret struct {
	ID                int64
	AccessURL         string
	OwnerID           int64
	SyncCron          string
	LastSyncedAt      *time.Time
	NextSyncAt        *time.Time
	NextBalanceSyncAt *time.Time
}

// SimpleFinAccountFields is the inferred account data for a SimpleFIN account.
type SimpleFinAccountFields struct {
	ID          string
	Name        string
	Type        model.AccountType
	Mask        *string
	NeedsReview bool
}

// FieldsFromSimpleFinAccount infers account fields from a SimpleFIN account.
// Type is inferred from holdings, the account name, and the balance sign.
func FieldsFromSimpleFinAccount(account clients.SimpleFinAccount) SimpleFinAccountFields {
	balance, _ := strconv.ParseFloat(strings.TrimSpace(account.Balance), 64)
	name, mask := simpleFinNameAndMask(account.Name)
	accountType, needsReview := inferSimpleFinAccountType(name, account.Holdings, balance)
	return SimpleFinAccountFields{
		ID:          account.ID,
		Name:        name,
		Type:        accountType,
		Mask:        mask,
		NeedsReview: needsReview,
	}
}

func simpleFinNameAndMask(name string) (string, *string) {
	matches := simpleFinNameMaskRE.FindStringSubmatchIndex(name)
	if len(matches) == 0 {
		return strings.TrimSpace(name), nil
	}

	base := strings.TrimSpace(name[:matches[0]])
	if base == "" {
		return strings.TrimSpace(name), nil
	}

	mask := name[matches[2]:matches[3]]
	return base, &mask
}

// inferSimpleFinAccountType classifies a SimpleFIN account once, at creation.
// Holdings mark an investment account. Otherwise name keywords win (the most
// specific signal, and the only way to distinguish LOAN from CREDIT or to keep
// an overdrawn checking account as DEPOSITORY). When the name is uninformative
// we fall back to the balance sign: SimpleFIN reports liabilities as negative
// and assets as positive. A zero balance with no name signal is an unknown we
// default to CREDIT and flag for manual review.
func inferSimpleFinAccountType(
	name string,
	holdings []clients.SimpleFinHolding,
	balance float64,
) (model.AccountType, bool) {
	if len(holdings) > 0 {
		return model.AccountTypeInvestment, false
	}
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "brokerage"):
		return model.AccountTypeInvestment, false
	case depositoryRE.MatchString(lower):
		return model.AccountTypeDepository, false
	case creditRE.MatchString(lower):
		return model.AccountTypeCredit, false
	case loanRE.MatchString(lower):
		return model.AccountTypeLoan, false
	}
	switch {
	case balance < 0:
		return model.AccountTypeCredit, false
	case balance > 0:
		return model.AccountTypeDepository, false
	default:
		return model.AccountTypeCredit, true
	}
}

func simpleFinOrgDomain(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	return parsed.Hostname()
}

func NewUpsertSimpleFinConnectionParams(tokenID int64, ownerID int64, conn clients.SimpleFinConnection) UpsertSimpleFinConnectionParams {
	return UpsertSimpleFinConnectionParams{
		ExternalID:    conn.ConnID,
		AccessTokenID: tokenID,
		OrgID:         lo.EmptyableToPtr(conn.OrgID),
		OrgDomain:     lo.EmptyableToPtr(simpleFinOrgDomain(conn.OrgURL)),
		OrgURL:        lo.EmptyableToPtr(conn.OrgURL),
		SfinURL:       lo.EmptyableToPtr(conn.SfinURL),
		LogoURL:       u.DuckDuckGoFaviconURL(conn.OrgURL),
		Name:          conn.Name,
		OwnerID:       ownerID,
	}
}
