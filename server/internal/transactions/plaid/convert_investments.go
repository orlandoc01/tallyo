package txnplaid

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"tallyo/internal/transactions"
	u "tallyo/internal/utils"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

const (
	pfcDividends       = "INCOME:INCOME_DIVIDENDS"
	pfcInterest        = "INCOME:INCOME_INTEREST_EARNED"
	pfcInvestmentIn    = "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"
	pfcInvestmentOut   = "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"
	pfcBankFees        = "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"
	pfcOtherIn         = "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"
	pfcOtherOut        = "TRANSFER_OUT:TRANSFER_OUT_OTHER_TRANSFER_OUT"
	pfcAccountTransfer = "TRANSFER_OUT:TRANSFER_OUT_ACCOUNT_TRANSFER"
)

var investmentSubtypePFC2 = map[string]string{
	"dividend": pfcDividends, "non-qualified dividend": pfcDividends, "qualified dividend": pfcDividends,
	"interest": pfcInterest, "deposit": pfcInvestmentIn, "contribution": pfcInvestmentIn,
	"withdrawal": pfcInvestmentOut, "distribution": pfcInvestmentOut,
	"long-term capital gain": pfcDividends, "short-term capital gain": pfcDividends,
	"unqualified gain": pfcDividends, "return of principal": pfcDividends,
	"dividend reinvestment": pfcInvestmentOut, "interest reinvestment": pfcInvestmentOut,
	"long-term capital gain reinvestment": pfcInvestmentOut, "short-term capital gain reinvestment": pfcInvestmentOut,
	"account fee": pfcBankFees, "fund fee": pfcBankFees, "management fee": pfcBankFees,
	"legal fee": pfcBankFees, "trust fee": pfcBankFees, "transfer fee": pfcBankFees,
	"miscellaneous fee": pfcBankFees, "margin expense": pfcBankFees,
	"tax": pfcBankFees, "tax withheld": pfcBankFees, "non-resident tax": pfcBankFees,
	"pending credit": pfcOtherIn, "pending debit": pfcOtherOut,
	"adjustment": pfcInvestmentOut, "rebalance": pfcInvestmentOut, "merger": pfcInvestmentOut,
	"spin off": pfcInvestmentOut, "split": pfcInvestmentOut, "stock distribution": pfcInvestmentOut,
	"assignment": pfcInvestmentOut, "exercise": pfcInvestmentOut, "expire": pfcInvestmentOut,
	"request": pfcInvestmentOut, "send": pfcInvestmentOut, "trade": pfcInvestmentOut,
	"loan payment": pfcInvestmentOut, "interest receivable": pfcInvestmentOut,
}

var investmentTypePFC2 = map[string]string{
	"buy": pfcInvestmentOut, "sell": pfcInvestmentIn,
	"transfer": pfcAccountTransfer, "cancel": pfcOtherIn,
}

func convertInvestmentTransaction(
	itx plaidapi.InvestmentTransaction,
	securities map[string]plaidapi.Security,
	institutionName string,
	itemLogoURL *string,
) (transactions.SyncedTransaction, error) {
	rawJSON, err := json.Marshal(itx)
	if err != nil {
		return transactions.SyncedTransaction{}, fmt.Errorf(
			"marshal raw plaid investment transaction %q: %w",
			itx.GetInvestmentTransactionId(),
			err,
		)
	}
	rawJSONString := string(rawJSON)
	datetime := investmentTransactionDatetime(itx)
	merchantName := deriveInvestmentMerchantName(itx, securities, institutionName)
	return transactions.SyncedTransaction{
		ExternalID:      itx.GetInvestmentTransactionId(),
		AccountID:       itx.GetAccountId(),
		Amount:          itx.GetAmount(),
		Datetime:        datetime,
		PostedDatetime:  datetime,
		MerchantName:    lo.EmptyableToPtr(merchantName),
		OriginalName:    lo.EmptyableToPtr(itx.GetName()),
		LogoURL:         itemLogoURL,
		PlaidCategory:   syntheticInvestmentPFC2(itx),
		RawProviderJSON: &rawJSONString,
		Source:          "plaid",
		Pending:         false,
	}, nil
}

func investmentTransactionDatetime(itx plaidapi.InvestmentTransaction) time.Time {
	return plaidDateOnlyDatetime(itx.GetDate())
}

func deriveInvestmentMerchantName(
	itx plaidapi.InvestmentTransaction,
	securities map[string]plaidapi.Security,
	institutionName string,
) string {
	prefix := ""
	if institutionName != "" {
		prefix = institutionName + " - "
	}

	securityID, ok := itx.GetSecurityIdOk()
	if !ok || securityID == nil || *securityID == "" {
		return prefix + investmentFallbackName(itx)
	}
	security, ok := securities[*securityID]
	if !ok || security.GetIsCashEquivalent() {
		return prefix + investmentFallbackName(itx)
	}

	name := security.GetName()
	ticker := security.GetTickerSymbol()
	if name != "" && ticker != "" {
		return prefix + name + " (" + ticker + ")"
	}
	return lo.Ternary(name != "", prefix+name, prefix+investmentFallbackName(itx))
}

func investmentFallbackName(itx plaidapi.InvestmentTransaction) string {
	subtype := titleWords(string(itx.GetSubtype()))
	return lo.Ternary(subtype == "", "Investment Activity", "Investment "+subtype)
}

func titleWords(value string) string {
	titleWord := func(part string) string { return strings.ToUpper(part[:1]) + part[1:] }
	return strings.Join(u.Map(strings.Fields(value), titleWord), " ")
}

func syntheticInvestmentPFC2(itx plaidapi.InvestmentTransaction) *string {
	if pfc := investmentSubtypePFC2[string(itx.GetSubtype())]; pfc != "" {
		return new(pfc)
	}
	if pfc := investmentTypePFC2[string(itx.GetType())]; pfc != "" {
		return new(pfc)
	}
	return nil
}
