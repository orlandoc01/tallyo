package transactions

import (
	"context"
	"fmt"
)

type Persister struct {
	Store PersistStore
	// WithLLMStaging holds the LLM state stable through the upsert so disabling
	// the worker cannot clear rows before a concurrent sync stages them.
	WithLLMStaging func(upsert func(stageForLLM bool) error) error
}

func (p *Persister) Open(ctx context.Context) (chan<- PersistEvent, <-chan PersistResult) {
	events := make(chan PersistEvent)
	result := make(chan PersistResult, 1)
	go func() {
		var counts ItemCounts
		var firstErr error
		for ev := range events {
			if firstErr != nil {
				continue
			}
			if err := ctx.Err(); err != nil {
				firstErr = err
				continue
			}
			firstErr = p.apply(ctx, ev, &counts)
		}
		result <- PersistResult{Counts: counts, Err: firstErr}
	}()
	return events, result
}

func (p *Persister) apply(ctx context.Context, ev PersistEvent, counts *ItemCounts) error {
	switch {
	case ev.AccountUpsert != nil:
		if err := p.Store.UpsertSyncedAccount(ctx, *ev.AccountUpsert); err != nil {
			return err
		}
		counts.AccountsUpserted++
		return nil
	case ev.Upsert != nil:
		draft := *ev.Upsert
		var isNew bool
		upsert := func(stageForLLM bool) error {
			draft.StageForLLM = stageForLLM
			var err error
			isNew, err = p.Store.UpsertSyncedTransaction(ctx, draft)
			return err
		}
		var err error
		if p.WithLLMStaging != nil {
			err = p.WithLLMStaging(upsert)
		} else {
			err = upsert(false)
		}
		if err != nil {
			return err
		}
		if isNew {
			counts.Added++
		} else {
			counts.Modified++
		}
		return nil
	case ev.Removal != nil:
		if _, err := p.Store.DeleteSyncedTransaction(ctx, ev.Removal.Source, ev.Removal.ID); err != nil {
			return err
		}
		counts.Removed++
		return nil
	case ev.Recurring != nil:
		chargeID, err := p.Store.UpsertRecurringCharge(ctx, *ev.Recurring)
		if err != nil {
			return err
		}
		return p.Store.ReplaceChargeTxns(ctx, chargeID, ev.Recurring.TransactionIDs)
	case ev.MarkRecurring != nil:
		return p.Store.MarkRecurringFromStreams(ctx, ev.MarkRecurring.SourceID)
	default:
		return fmt.Errorf("empty persist event")
	}
}
