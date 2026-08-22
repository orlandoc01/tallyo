package simplefin

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

var moneyFundRE = regexp.MustCompile(
	`(?i)(money\s*market|cash\s*reserves?|govt?\s*cash|government\s*cash|treasury\s*money)`,
)

func (a *Adapter) reconcileAccounts(
	ctx context.Context,
	accountList []clients.SimpleFinAccount,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	usd, err := a.Reads.AssetByID(ctx, 1)
	if err != nil {
		return err
	}
	syncedAt := sink.Now().Format(time.RFC3339)
	for _, account := range accountList {
		if len(account.Holdings) > 0 {
			if err := a.reconcileInvestmentAccount(ctx, account, usd.ID.Int64(), syncedAt, sink, events); err != nil {
				return err
			}
			continue
		}
		if err := a.reconcileBalanceAccount(ctx, account, usd.ID.Int64(), syncedAt, sink, events); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) reconcileBalanceAccount(
	ctx context.Context,
	account clients.SimpleFinAccount,
	usdAssetID int64,
	syncedAt string,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	balance, err := simpleFinMoney(account.Balance)
	if err != nil {
		return fmt.Errorf("parse simplefin balance for %s: %w", account.ID, err)
	}
	// SimpleFIN reports liability balances as negative. Net worth subtracts
	// liability balances as positive magnitudes, so flip the sign here using
	// the persisted account type — the same source net worth uses — rather than
	// re-inferring it, so the write and read sides can never disagree.
	accountID, accountType, err := a.Reads.AccountByExternalID(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("lookup account %s: %w", account.ID, err)
	}
	if wealth.IsLiabilityType(accountType) {
		balance = -balance
	}
	rawPayload, err := wealth.MarshalRawPayload(account, "simplefin account payload")
	if err != nil {
		return err
	}
	snapshot := wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     a.Source().Str(),
		Date:       sink.Today(),
		SyncedAt:   syncedAt,
		BalanceUSD: money.FromDollars(balance),
		RawPayload: rawPayload,
		Holdings:   []wealth.AssetDailyHolding{usdCashHolding(usdAssetID, balance)},
	}
	return a.EmitWithPriceCheck(ctx, snapshot, events)
}

func (a *Adapter) reconcileInvestmentAccount(
	ctx context.Context,
	account clients.SimpleFinAccount,
	usdAssetID int64,
	syncedAt string,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	draft := wealth.NewInvestmentSnapshotDraft()
	accountID, _, err := a.Reads.AccountByExternalID(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("lookup account %s: %w", account.ID, err)
	}
	for _, holding := range account.Holdings {
		line, ok, err := holdingLine(holding, balanceTime(account, sink.Now()))
		if err != nil {
			return fmt.Errorf("map simplefin holding %q for %s: %w", holding.ID, account.ID, err)
		}
		if !ok {
			continue
		}
		draft.Add(line)
	}

	accountBalance, err := simpleFinMoney(account.Balance)
	if err != nil {
		return fmt.Errorf("parse simplefin investment balance for %s: %w", account.ID, err)
	}
	addResidualCash(draft, accountBalance, usdAssetID)
	rawPayload, err := wealth.MarshalRawPayload(account, "simplefin account payload")
	if err != nil {
		return err
	}
	balanceUSD, err := money.FromDollarsChecked(draft.Total)
	if err != nil {
		return fmt.Errorf("parse simplefin investment balance for %s: %w", account.ID, err)
	}
	snapshot := wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     a.Source().Str(),
		Date:       sink.Today(),
		SyncedAt:   syncedAt,
		BalanceUSD: balanceUSD,
		RawPayload: rawPayload,
		Holdings:   draft.Holdings,
	}
	return a.EmitWithPriceCheck(ctx, snapshot, events)
}

func addResidualCash(d *wealth.InvestmentSnapshotDraft, accountBalance float64, usdAssetID int64) {
	// Reconciliation is one-directional: a positive residual is uninvested cash
	// the institution reports in account.balance but not as a holding, so we add
	// it. A negative residual (Σ market_value > account.balance) is left alone —
	// per the integration plan account.balance == Σ market_value, so it should
	// not occur, and absent an authoritative cash line there is nothing to
	// subtract. The snapshot total then stays at Σ market_value.
	residual := accountBalance - d.Total
	if residual <= 0.01 {
		return
	}
	d.Add(usdCashHolding(usdAssetID, residual))
}

func usdCashHolding(assetID int64, amount float64) wealth.AssetDailyHolding {
	return wealth.AssetDailyHolding{AssetID: assetID, Quantity: &amount, Price: new(1.0), ValueUSD: amount, CountsTowardValue: true}
}

func holdingLine(holding clients.SimpleFinHolding, priceAt time.Time) (wealth.AssetDailyHolding, bool, error) {
	shares, err := simpleFinAmount(holding.Shares)
	if err != nil {
		return wealth.AssetDailyHolding{}, false, fmt.Errorf("parse shares: %w", err)
	}
	marketValue, err := simpleFinMoney(holding.MarketValue)
	if err != nil {
		return wealth.AssetDailyHolding{}, false, fmt.Errorf("parse market value: %w", err)
	}
	if shares == 0 || marketValue == 0 {
		return wealth.AssetDailyHolding{}, false, nil
	}
	price := marketValue / shares
	if _, err := money.FromDollarsChecked(price); err != nil {
		return wealth.AssetDailyHolding{}, false, fmt.Errorf("parse price: %w", err)
	}
	// v1 supports USD holdings only: market_value is taken verbatim as ValueUSD
	// with no FX conversion. A non-USD holding would contribute its native value
	// as if it were USD.
	asset := assetFromHolding(holding, price, priceAt)
	return wealth.AssetDailyHolding{
		Asset:             &asset,
		Quantity:          &shares,
		Price:             &price,
		ValueUSD:          marketValue,
		CountsTowardValue: true,
	}, true, nil
}

func assetFromHolding(holding clients.SimpleFinHolding, price float64, priceAt time.Time) wealth.AssetUpsert {
	symbol := strings.ToUpper(strings.TrimSpace(holding.Symbol))
	classifier := classifierForHolding(symbol, holding.Description)
	return wealth.AssetUpsert{
		AssetType:              model.AssetTypeSecurity,
		Identifier:             identifierForHolding(symbol, holding),
		Name:                   lo.EmptyableToPtr(strings.TrimSpace(holding.Description)),
		Classifier:             classifier,
		TrackingMultiplier:     1,
		LastPrice:              &price,
		LastPriceAt:            &priceAt,
		AdapterSource:          adapterSourceForHoldingID(holding.ID),
		SimpleFinCostBasis:     lo.EmptyableToPtr(holding.CostBasis),
		SimpleFinPurchasePrice: lo.EmptyableToPtr(holding.PurchasePrice),
	}
}

func identifierForHolding(symbol string, holding clients.SimpleFinHolding) string {
	if symbol != "" {
		return symbol
	}
	// Untickered holdings must key on the unique holding id, mirroring how Plaid
	// keys untickered securities on the unique plaid:<security_id>. The catalog
	// uniqueness key is (asset_type, identifier), so slugging the description
	// would collapse two genuinely different untickered securities that share a
	// description (e.g. two "Private Fund" positions) into one assets row,
	// making the shared asset's name/last_price/cost-basis metadata
	// last-writer-wins across accounts. The trade-off: if the provider changes a
	// holding id, the same lot re-keys to a new asset row.
	id := strings.TrimSpace(holding.ID)
	if id != "" {
		return "simplefin:" + id
	}
	slug := slugify(holding.Description)
	return lo.Ternary(slug != "", "simplefin:"+slug, "simplefin:unknown-holding")
}

func adapterSourceForHoldingID(id string) *wealth.AdapterSource {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	return &wealth.AdapterSource{Adapter: syncerids.SimpleFin, SourceID: id}
}

func classifierForHolding(symbol string, description string) model.AssetClassifier {
	name := strings.TrimSpace(symbol + " " + description)
	if moneyFundRE.MatchString(name) {
		return model.AssetClassifierCash
	}
	switch symbol {
	case "SPAXX", "FDRXX", "FFLDX":
		return model.AssetClassifierCash
	default:
		return model.AssetClassifierPublic
	}
}
