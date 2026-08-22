package graph

import (
	"context"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/config"
	"tallyo/internal/graph/model"
	"tallyo/internal/portfolio"
	"tallyo/internal/transactions"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/realestate"
)

type PortfolioAnalysisService interface {
	Analyze(ctx context.Context, view model.AnalysisView, filter portfolio.HoldingsFilter) (*model.AnalysisReport, error)
}

type LinkRunner interface {
	CreateLinkToken(ctx context.Context, credentialID int32, ownerID int64) (*model.CreateLinkTokenPayload, error)
	ExchangePublicToken(ctx context.Context, publicToken string, credentialID int32, ownerID int64, institutionID *string, institutionName *string) (*model.ExchangePublicTokenPayload, error)
	CreateUpdateLinkToken(ctx context.Context, itemID int64) (*model.CreateLinkTokenPayload, error)
	CompleteLinkUpdate(ctx context.Context, itemID int64) (*model.CompleteLinkUpdatePayload, error)
	LinkEVMWallet(ctx context.Context, address string, ownerID int64, label string, chainIDs []string) (*model.LinkEVMWalletPayload, error)
}

type SimpleFinRunner interface {
	CreateAccessToken(
		ctx context.Context,
		setupToken string,
		ownerID int64,
		label string,
	) (*model.CreateSimpleFinAccessTokenPayload, error)
	DeleteAccessToken(ctx context.Context, id int64) error
	ResetSync(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error)
}

type AdminService interface {
	Users(ctx context.Context) ([]*model.User, error)
	UserByID(ctx context.Context, id int64) (*model.User, error)
	AddUser(ctx context.Context, email, invitedBy string, role string) (*model.User, error)
	CreateInviteLink(ctx context.Context, userID int64) (string, time.Time, error)
	UpdateUserRole(ctx context.Context, id int64, role string) (*model.User, error)
	RemoveUser(ctx context.Context, id int64) error
	CreatePlaidCredential(ctx context.Context, input model.CreatePlaidCredentialInput) (*model.PlaidCredential, error)
	UpdatePlaidCredential(ctx context.Context, input model.UpdatePlaidCredentialInput) (*model.PlaidCredential, error)
	DeletePlaidCredential(ctx context.Context, id int32) (bool, error)
	PlaidCredentials(ctx context.Context) ([]*model.PlaidCredential, error)
	PlaidCredentialsByIDs(ctx context.Context, ids []int32) (map[int32]*model.PlaidCredential, error)
	Sections() runtimeconfig.Sections
	UpdateSections(ctx context.Context, patch runtimeconfig.Patch) error
	Timezone() string
}

// WealthService computes net-worth and per-account valuation reports. Satisfied
// by *wealth.Service; declared here so the resolver depends on behavior, not the
// concrete implementation.
type WealthService interface {
	NetWorth(ctx context.Context, input model.NetWorthInput) (*model.NetWorthReport, error)
	HistoricalNetWorth(ctx context.Context, input model.HistoricalNetWorthInput) (*model.HistoricalNetWorthReport, error)
	AccountsLastSyncedAt(ctx context.Context, accountIDs []int64) (map[int64]*time.Time, error)
	AccountSnapshot(ctx context.Context, input model.AccountSnapshotInput) (*model.AccountSnapshot, error)
	AccountLatestSnapshots(ctx context.Context, accountIDs []int64) (map[int64]*model.AccountSnapshot, error)
	AccountSnapshots(ctx context.Context, input model.AccountSnapshotsInput) (*model.AccountSnapshotConnection, error)
	Assets(ctx context.Context, input model.AssetsInput) ([]*model.Asset, error)
	CreateAsset(ctx context.Context, input model.CreateAssetInput) (*model.Asset, error)
	UpdateAsset(ctx context.Context, input model.UpdateAssetInput) (*model.Asset, error)
	MergeAsset(ctx context.Context, input model.MergeAssetInput) (*model.Asset, error)
	Quote(ctx context.Context, ticker string) (*model.AssetQuote, error)
	ChangeAccountSnapshot(ctx context.Context, input model.ChangeAccountSnapshotInput) (*model.ChangeAccountSnapshotPayload, error)
	AssetSnapshotsByIDs(ctx context.Context, assetIDs []int64) (map[int64]*model.AssetSnapshot, error)
}

type WealthStore interface {
	wealth.BalanceReviewStore
	AssetByID(ctx context.Context, id int64) (*model.Asset, error)
	AssetsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Asset, error)
	AssetAdapterSourcesByAssetIDs(ctx context.Context, ids []int64) (map[int64][]*model.AssetAdapterSource, error)
	DeleteRealEstate(ctx context.Context, connectionID int64) error
}

// BudgetService manages budgets and produces budget reports. Satisfied by *budgets.Service.
type BudgetService interface {
	BudgetReport(ctx context.Context, input model.BudgetReportInput) (*model.BudgetReport, error)
	BudgetReportHistory(ctx context.Context, input model.BudgetReportHistoryInput) (*model.BudgetReportHistory, error)
	BudgetByID(ctx context.Context, id int64) (*model.Budget, error)
	SetBudget(ctx context.Context, input model.SetBudgetInput) (*model.Budget, error)
	DeleteBudget(ctx context.Context, input model.DeleteBudgetInput) (bool, error)
	CopyBudgets(ctx context.Context, input model.CopyBudgetsInput) (int32, error)
}

// RealEstateService links and revalues real estate connections. Satisfied by *wealth/realestate.Service.
type RealEstateService interface {
	Link(ctx context.Context, input realestate.LinkInput) (*model.Connection, *model.Account, error)
	Update(ctx context.Context, input realestate.UpdateInput) (int64, error)
}

// ManualSnapshotter manages manual account snapshot streams.
type ManualSnapshotter interface {
	SeedInitialSnapshot(ctx context.Context, account *model.Account) error
}

type LLMReprocessor interface {
	ReprocessUncategorized(
		ctx context.Context,
		queue transactions.LLMStagingStore,
	) (int64, error)
}

type Resolver struct {
	AccountsStore     accounts.Store
	TransactionsStore transactions.Store
	LLM               LLMReprocessor
	Budgets           BudgetService
	WealthDB          WealthStore
	Linker            LinkRunner
	SimpleFin         SimpleFinRunner
	Admin             AdminService
	Wealth            WealthService
	Portfolio         PortfolioAnalysisService
	RealEstate        RealEstateService
	ManualSnapshot    ManualSnapshotter
	Config            config.Config
	// ScheduleRestart triggers a graceful process restart (e.g. after an
	// authorization configuration change). Required — wired in cmd/tallyo.
	ScheduleRestart func()
}
