package transactionsdb

import (
	"fmt"
	"strings"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
)

// transactionFilterValues holds the decoded filter fields shared by every
// dynamic transaction read: TransactionRecords (list, single-transaction
// lookup, node batch, bulk-id resolution) and TransactionRecordsSummary
// (count, transactionsSummary) both accept the same predicate set.
type transactionFilterValues struct {
	ids              []int64
	searchMatch      *string
	datetimeFrom     *time.Time
	datetimeTo       *time.Time
	categoryIDs      []int64
	tagIDs           []int64
	accountIDs       []int64
	ownerIDs         []int64
	isReviewed       *bool
	isRecurring      *bool
	isPending        *bool
	isHidden         *bool
	merchantPrefix   *string
	originalPrefix   *string
	exactAmount      *money.Cents
	amountMin        *money.Cents
	amountMax        *money.Cents
	untagged         bool
	excludeTransfers bool
	excludeIncome    bool
}

func (s *Store) transactionFilterValues(filter *model.TransactionsFilter, ids []int64) (transactionFilterValues, error) {
	if err := model.ValidateTransactionsFilterIDTypes(filter); err != nil {
		return transactionFilterValues{}, err
	}
	return normalizeTransactionFilterValues(filter, ids), nil
}

func normalizeTransactionFilterValues(filter *model.TransactionsFilter, ids []int64) transactionFilterValues {
	v := transactionFilterValues{ids: ids}
	if filter == nil {
		return v
	}
	if search := strings.TrimSpace(lo.FromPtr(filter.Search)); search != "" {
		searchMatch := dbutil.FTSPrefixQuery(search)
		v.searchMatch = &searchMatch
	}
	if filter.DatetimeRange != nil {
		if filter.DatetimeRange.From != nil {
			v.datetimeFrom = new(filter.DatetimeRange.From.UTC())
		}
		if filter.DatetimeRange.To != nil {
			v.datetimeTo = new(filter.DatetimeRange.To.UTC())
		}
	}
	v.categoryIDs = model.LocalInt64IDsPtr(filter.CategoryIds)
	v.tagIDs = model.LocalInt64IDsPtr(filter.TagIds)
	v.untagged = filter.Untagged != nil && *filter.Untagged
	v.accountIDs = model.LocalInt64IDsPtr(filter.AccountIds)
	v.ownerIDs = model.LocalInt64IDsPtr(filter.OwnerIds)
	v.isReviewed = filter.IsReviewed
	v.isRecurring = filter.IsRecurring
	v.isPending = filter.IsPending
	v.isHidden = filter.IsHidden
	if prefix := strings.TrimSpace(lo.FromPtr(filter.MerchantPrefix)); prefix != "" {
		v.merchantPrefix = new(strings.ToLower(prefix))
	}
	if prefix := strings.TrimSpace(lo.FromPtr(filter.OriginalPrefix)); prefix != "" {
		v.originalPrefix = new(strings.ToLower(prefix))
	}
	if filter.ExactAmount != nil {
		v.exactAmount = filter.ExactAmount
	} else {
		v.amountMin = filter.AmountMin
		v.amountMax = filter.AmountMax
	}
	v.excludeTransfers = filter.ExcludeTransfers != nil && *filter.ExcludeTransfers
	v.excludeIncome = filter.ExcludeIncome != nil && *filter.ExcludeIncome
	return v
}

func (v transactionFilterValues) hasCriteria() bool {
	return v.searchMatch != nil || v.datetimeFrom != nil || v.datetimeTo != nil ||
		len(v.categoryIDs) > 0 || len(v.tagIDs) > 0 || len(v.accountIDs) > 0 || len(v.ownerIDs) > 0 ||
		v.isReviewed != nil || v.isRecurring != nil || v.isPending != nil || v.isHidden != nil ||
		v.merchantPrefix != nil || v.originalPrefix != nil || v.exactAmount != nil ||
		v.amountMin != nil || v.amountMax != nil || v.untagged || v.excludeTransfers || v.excludeIncome
}

func (v transactionFilterValues) recordsParams() dbgen.TransactionRecordsParams {
	return dbgen.TransactionRecordsParams{
		Ids: v.ids, SearchMatch: v.searchMatch,
		DatetimeFrom: v.datetimeFrom, DatetimeTo: v.datetimeTo,
		CategoryIds: v.categoryIDs, TagIds: v.tagIDs, Untagged: v.untagged,
		AccountIds: v.accountIDs, OwnerIds: v.ownerIDs,
		IsReviewed: v.isReviewed, IsRecurring: v.isRecurring, IsPending: v.isPending, IsHidden: v.isHidden,
		MerchantPrefix: v.merchantPrefix, OriginalPrefix: v.originalPrefix,
		ExactAmount: v.exactAmount, AmountMin: v.amountMin, AmountMax: v.amountMax,
		ExcludeTransfers: v.excludeTransfers, ExcludeIncome: v.excludeIncome,
	}
}

func (v transactionFilterValues) summaryParams() dbgen.TransactionRecordsSummaryParams {
	return dbgen.TransactionRecordsSummaryParams{
		Ids: v.ids, SearchMatch: v.searchMatch,
		DatetimeFrom: v.datetimeFrom, DatetimeTo: v.datetimeTo,
		CategoryIds: v.categoryIDs, TagIds: v.tagIDs, Untagged: v.untagged,
		AccountIds: v.accountIDs, OwnerIds: v.ownerIDs,
		IsReviewed: v.isReviewed, IsRecurring: v.isRecurring, IsPending: v.isPending, IsHidden: v.isHidden,
		MerchantPrefix: v.merchantPrefix, OriginalPrefix: v.originalPrefix,
		ExactAmount: v.exactAmount, AmountMin: v.amountMin, AmountMax: v.amountMax,
		ExcludedKinds: v.excludedKinds(),
	}
}

func (v transactionFilterValues) countParams() dbgen.CountTransactionRecordsParams {
	return dbgen.CountTransactionRecordsParams{
		Ids: v.ids, SearchMatch: v.searchMatch,
		DatetimeFrom: v.datetimeFrom, DatetimeTo: v.datetimeTo,
		CategoryIds: v.categoryIDs, TagIds: v.tagIDs, Untagged: v.untagged,
		AccountIds: v.accountIDs, OwnerIds: v.ownerIDs,
		IsReviewed: v.isReviewed, IsRecurring: v.isRecurring, IsPending: v.isPending, IsHidden: v.isHidden,
		MerchantPrefix: v.merchantPrefix, OriginalPrefix: v.originalPrefix,
		ExactAmount: v.exactAmount, AmountMin: v.amountMin, AmountMax: v.amountMax,
		ExcludedKinds: v.excludedKinds(),
	}
}

func (v transactionFilterValues) excludedKinds() []string {
	var kinds []string
	if v.excludeTransfers {
		kinds = append(kinds, string(model.CategoryKindTransfer))
	}
	if v.excludeIncome {
		kinds = append(kinds, string(model.CategoryKindIncome))
	}
	return kinds
}

func (v transactionFilterValues) idsParams() dbgen.TransactionIDsByFilterParams {
	return dbgen.TransactionIDsByFilterParams{
		Ids: v.ids, SearchMatch: v.searchMatch,
		DatetimeFrom: v.datetimeFrom, DatetimeTo: v.datetimeTo,
		CategoryIds: v.categoryIDs, TagIds: v.tagIDs, Untagged: v.untagged,
		AccountIds: v.accountIDs, OwnerIds: v.ownerIDs,
		IsReviewed: v.isReviewed, IsRecurring: v.isRecurring, IsPending: v.isPending, IsHidden: v.isHidden,
		MerchantPrefix: v.merchantPrefix, OriginalPrefix: v.originalPrefix,
		ExactAmount: v.exactAmount, AmountMin: v.amountMin, AmountMax: v.amountMax,
		ExcludeTransfers: v.excludeTransfers, ExcludeIncome: v.excludeIncome,
	}
}

// transactionSortToggles are the six ORDER BY toggles TransactionRecords
// expects: exactly one of {amount,datetime} and one id direction are set.
type transactionSortToggles struct {
	OrderAmountAsc, OrderAmountDesc     bool
	OrderDatetimeAsc, OrderDatetimeDesc bool
	OrderIDAsc, OrderIDDesc             bool
}

func transactionSortDirection(sortInput *model.TransactionSort) (byAmount, ascending bool) {
	byAmount = sortInput != nil && sortInput.Field == model.TransactionSortFieldAmount
	ascending = sortInput != nil && sortInput.Direction == model.SortDirectionAsc
	return byAmount, ascending
}

// newTransactionSortToggles resolves a sort input (defaulting to datetime
// desc) and optional backward-pagination reverse into the ORDER BY toggles.
func newTransactionSortToggles(sortInput *model.TransactionSort, reverse bool) transactionSortToggles {
	byAmount, asc := transactionSortDirection(sortInput)
	if reverse {
		asc = !asc
	}
	return transactionSortToggles{
		OrderAmountAsc:    byAmount && asc,
		OrderAmountDesc:   byAmount && !asc,
		OrderDatetimeAsc:  !byAmount && asc,
		OrderDatetimeDesc: !byAmount && !asc,
		OrderIDAsc:        asc,
		OrderIDDesc:       !asc,
	}
}

func (t transactionSortToggles) apply(p *dbgen.TransactionRecordsParams) {
	p.OrderAmountAsc, p.OrderAmountDesc = t.OrderAmountAsc, t.OrderAmountDesc
	p.OrderDatetimeAsc, p.OrderDatetimeDesc = t.OrderDatetimeAsc, t.OrderDatetimeDesc
	p.OrderIdAsc, p.OrderIdDesc = t.OrderIDAsc, t.OrderIDDesc
}

// transactionCursorFields resolves a keyset cursor plus its after/before
// direction and the query's sort into the four cursor toggles and their bound
// values. Exactly one toggle is set when cursor != nil; all four are false
// otherwise. Unlike the ORDER BY toggles, this does not flip on `reverse` --
// the cursor direction already encodes after-vs-before relative to the
// *display* sort, independent of which physical direction rows are fetched in
// for `last` (backward) pagination.
type transactionCursorFields struct {
	CursorDatetime   time.Time
	CursorAmount     money.Cents
	CursorID         int64
	CursorDatetimeGt bool
	CursorDatetimeLt bool
	CursorAmountGt   bool
	CursorAmountLt   bool
}

func newTransactionCursorFields(cursor *transactions.Cursor, isAfter bool, sortInput *model.TransactionSort) (transactionCursorFields, error) {
	var f transactionCursorFields
	if cursor == nil {
		return f, nil
	}
	datetime, err := time.Parse(time.RFC3339, cursor.Datetime)
	if err != nil {
		return f, fmt.Errorf("parse cursor datetime: %w", err)
	}
	byAmount, ascending := transactionSortDirection(sortInput)
	wantGreater := isAfter == ascending
	f.CursorDatetime = datetime
	f.CursorAmount = cursor.Amount
	f.CursorID = cursor.ID
	switch {
	case byAmount && wantGreater:
		f.CursorAmountGt = true
	case byAmount && !wantGreater:
		f.CursorAmountLt = true
	case !byAmount && wantGreater:
		f.CursorDatetimeGt = true
	default:
		f.CursorDatetimeLt = true
	}
	return f, nil
}

func (f transactionCursorFields) apply(p *dbgen.TransactionRecordsParams) {
	p.CursorDatetime, p.CursorAmount, p.CursorID = f.CursorDatetime, f.CursorAmount, f.CursorID
	p.CursorDatetimeGt, p.CursorDatetimeLt = f.CursorDatetimeGt, f.CursorDatetimeLt
	p.CursorAmountGt, p.CursorAmountLt = f.CursorAmountGt, f.CursorAmountLt
}
