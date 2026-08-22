package txnsync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/database"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	txnplaid "tallyo/internal/transactions/plaid"
	txnsimplefin "tallyo/internal/transactions/simplefin"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

type Syncer struct {
	adapters         []transactions.SyncAdapter
	persister        *transactions.Persister
	llm              *transactions.LLMWorker
	events           <-chan accounts.AccountsCreated
	now              func() time.Time
	initialSyncDelay time.Duration
	trackingDisabled func() bool
	log              *slog.Logger
	u.Sleeper
}

type SyncResult struct {
	Items         []*model.ItemSyncResult
	TotalAdded    int32
	TotalModified int32
	TotalRemoved  int32
}

type Config struct {
	Clients          clients.PlaidClientFactory
	SimpleFinClient  clients.SimpleFinClient
	Now              func() time.Time
	InitialSyncDelay time.Duration
	TrackingDisabled func() bool
}

func New(db *database.DB, cfg Config, log *slog.Logger) *Syncer {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	simpleFinClient := cfg.SimpleFinClient
	if simpleFinClient == nil {
		simpleFinClient = clients.NewSimpleFinClient()
	}
	trackingDisabled := cfg.TrackingDisabled
	if trackingDisabled == nil {
		trackingDisabled = func() bool { return false }
	}
	plaid := txnplaid.New(db, cfg.Clients, now, log)
	simpleFin := txnsimplefin.New(db, simpleFinClient, now, log)
	llm := &transactions.LLMWorker{
		Store:   transactionsdb.New(db),
		Log:     log,
		Trigger: make(chan struct{}, 1),
	}
	persister := &transactions.Persister{
		Store:          transactionsdb.New(db),
		WithLLMStaging: llm.WithStaging,
	}
	return &Syncer{
		adapters:         []transactions.SyncAdapter{plaid, simpleFin},
		persister:        persister,
		llm:              llm,
		now:              now,
		initialSyncDelay: cfg.InitialSyncDelay,
		trackingDisabled: trackingDisabled,
		log:              log,
	}
}

func (s *Syncer) SyncDueItems(ctx context.Context) *SyncResult {
	if s.trackingDisabled() {
		return &SyncResult{Items: []*model.ItemSyncResult{}}
	}
	result := &SyncResult{Items: []*model.ItemSyncResult{}}
	for _, adapter := range s.adapters {
		s.addReport(result, adapter.SyncDue(ctx, s.persister))
	}
	s.llm.Signal()
	return result
}

func (s *Syncer) SyncItemByID(ctx context.Context, itemID int64) *model.ItemSyncResult {
	adapter := s.adapterFor(accounts.SourceTablePlaidItem)
	if adapter == nil {
		return s.itemResult(transactions.ItemReport{
			Err: fmt.Errorf("no transaction sync adapter for provider %q", accounts.SourceTablePlaidItem),
		})
	}
	item := s.itemResult(adapter.SyncConnectionInto(ctx, itemID, s.persister))
	s.llm.Signal()
	return item
}

func (s *Syncer) RecurringSyncAll(ctx context.Context) *SyncResult {
	if s.trackingDisabled() {
		return &SyncResult{Items: []*model.ItemSyncResult{}}
	}
	result := &SyncResult{Items: []*model.ItemSyncResult{}}
	for _, adapter := range s.adapters {
		recurring, ok := adapter.(recurringSyncAdapter)
		if !ok {
			continue
		}
		s.addReport(result, recurring.SyncRecurringDue(ctx, s.persister))
	}
	return result
}

func (s *Syncer) Run(ctx context.Context) {
	if s.llm.Enabled() {
		s.llm.Signal()
	} else if err := s.llm.Store.ClearStagedForLLM(ctx); err != nil {
		s.log.Error("clear staged for llm (startup)", "error", err)
	}
	u.RunHourlyCron(ctx, s.syncDueAndLog)
}

func (s *Syncer) syncDueAndLog(ctx context.Context) {
	result := s.SyncDueItems(ctx)
	s.log.Info(
		"plaid sync completed",
		"added",
		result.TotalAdded,
		"modified",
		result.TotalModified,
		"removed",
		result.TotalRemoved,
		"items",
		len(result.Items),
	)
}

func (s *Syncer) Subscribe(events <-chan accounts.AccountsCreated) {
	s.events = events
}

func (s *Syncer) RunAccountEvents(ctx context.Context) {
	u.PollChannel(ctx, s.events, func(ctx context.Context, ev accounts.AccountsCreated) {
		s.syncAccountCreated(ctx, ev)
	})
}

func (s *Syncer) syncAccountCreated(ctx context.Context, ev accounts.AccountsCreated) {
	adapter := s.adapterFor(ev.Provider)
	if adapter == nil {
		return
	}
	if err := s.SleepBeforeContinue(ctx, s.initialSyncDelay); err != nil {
		return
	}
	if s.trackingDisabled() {
		return
	}
	report := adapter.SyncConnectionInto(ctx, ev.SourceID, s.persister)
	s.llm.Signal()
	if report.Err != nil {
		s.log.Error("delayed initial sync failed", "item_id", ev.SourceID)
	}
}

type recurringSyncAdapter interface {
	SyncRecurringDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport
}

func (s *Syncer) RecurringRun(ctx context.Context) {
	u.RunHourlyCron(ctx, func(ctx context.Context) {
		s.RecurringSyncAll(ctx)
	})
}

func (s *Syncer) SetLLM(c transactions.Categorizer) {
	s.llm.SetLLM(c)
}

// LLM returns the worker used for background categorization.
func (s *Syncer) LLM() *transactions.LLMWorker {
	return s.llm
}

func (s *Syncer) RunLLMWorker(ctx context.Context) {
	s.llm.RunWorker(ctx)
}

func (s *Syncer) addReport(result *SyncResult, report transactions.SyncReport) {
	for _, item := range report.Items {
		modelItem := s.itemResult(item)
		result.Items = append(result.Items, modelItem)
		result.TotalAdded += modelItem.Added
		result.TotalModified += modelItem.Modified
		result.TotalRemoved += modelItem.Removed
	}
}

func (s *Syncer) adapterFor(provider accounts.SourceTable) transactions.SyncAdapter {
	result, _ := lo.Find(s.adapters, func(t transactions.SyncAdapter) bool {
		return t.Handles(provider)
	})
	return result
}

func (s *Syncer) itemResult(report transactions.ItemReport) *model.ItemSyncResult {
	result := &model.ItemSyncResult{
		Added:    int32(report.Counts.Added),
		Modified: int32(report.Counts.Modified),
		Removed:  int32(report.Counts.Removed),
	}
	if report.Err != nil {
		s.log.Warn(
			"transaction sync item failed",
			"added",
			result.Added,
			"modified",
			result.Modified,
			"removed",
			result.Removed,
		)
		message := "sync failed"
		result.Error = &message
	}
	return result
}
