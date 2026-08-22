package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/admin"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/auth/authdb"
	"tallyo/internal/budgets"
	budgetsdb "tallyo/internal/budgets/db"
	apiClients "tallyo/internal/clients"
	"tallyo/internal/clients/yfinance"
	"tallyo/internal/config"
	"tallyo/internal/database"
	"tallyo/internal/graph"
	httphandler "tallyo/internal/handler"
	"tallyo/internal/middleware"
	"tallyo/internal/portfolio"
	portfoliodb "tallyo/internal/portfolio/db"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/transactions/txnsync"
	u "tallyo/internal/utils"
	pf "tallyo/internal/utils/plaidfactory"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/balancesync"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/debank"
	"tallyo/internal/wealth/manual"
	"tallyo/internal/wealth/plaid"
	"tallyo/internal/wealth/realestate"
	wealthsimplefin "tallyo/internal/wealth/simplefin"

	"github.com/samber/lo"
)

// errRestartRequested is returned by runServer when a runtime configuration
// change (e.g. authorization settings) requires a process restart. main exits
// nonzero on any error, which is exactly the signal the container supervisor
// needs to restart the process.
var errRestartRequested = errors.New("restart requested")

func runServer(ctx context.Context, logger *slog.Logger, cfg config.Config, dbOptions database.OpenOptions) error {
	// Cancelling here (via SIGINT/SIGTERM, since it derives from ctx, or via
	// ScheduleRestart below) lets the HTTP server and background loops finish
	// their graceful shutdown before the database is closed.
	ctx, cancelForRestart := context.WithCancelCause(ctx)
	defer cancelForRestart(nil)

	db, err := database.OpenDB(ctx, dbOptions)
	if err != nil {
		return err
	}
	defer func() {
		if err := db.Close(); err != nil {
			logger.Error("close database", "error", err)
		}
	}()
	var background sync.WaitGroup
	defer func() {
		cancelForRestart(nil)
		background.Wait()
	}()
	accountsStore := accountsdb.New(db)
	transactionsStore := transactionsdb.New(db)
	wealthStore := wealthdb.New(db, wealthdb.WithLogger(logger))
	portfolioStore := portfoliodb.New(db)
	budgetsStore := budgetsdb.New(db)
	adminStore := admindb.New(db)
	runtimeCfg := runtimeconfig.New(adminStore)
	adminSvc := admin.NewService(adminStore, runtimeCfg)
	if err := adminSvc.LoadConfiguration(ctx, cfg.Authorization.MasterPassword != "", cfg.Authorization.DisableAllAuth); err != nil {
		return err
	}
	rtCfg, err := adminSvc.ResolveRuntimeConfig(cfg.Authorization.MasterPassword, cfg.Authorization.DisableAllAuth)
	if err != nil {
		return err
	}
	clientIPResolver, err := middleware.NewClientIPResolver(rtCfg.Security.Fields.TrustedProxyCIDRs)
	if err != nil {
		return err
	}

	clientFactory := &pf.StoreClientFactory{Store: adminStore}
	accountEvents := accounts.NewEventBus(logger)
	authDB := authdb.New(db)
	authSrv, err := auth.New(ctx, auth.Config{
		IssuerURL:             rtCfg.Auth.Fields.OAuthIssuerURL,
		OAuthEnabled:          rtCfg.OAuthEnabled(),
		GoogleAuthnEnabled:    rtCfg.Google.Enabled,
		GoogleClientID:        lo.FromPtr(rtCfg.Google.Fields.ClientID),
		GoogleClientSecret:    lo.FromPtr(rtCfg.Google.Fields.ClientSecret),
		EmailCodeAuthnEnabled: rtCfg.Email.Enabled,
		PassKeyAuthnEnabled:   rtCfg.WebAuthn.Enabled,
		FrontendRedirectURIs:  rtCfg.Auth.Fields.FrontendRedirectURIs,
		MasterPassword:        lo.FromPtr(rtCfg.Auth.Fields.MasterPassword),
		MasterPasswordFromEnv: cfg.Authorization.MasterPassword != "",
		DisableAllAuth:        rtCfg.DisableAllAuth(),
		AccessTokenLifetime:   rtCfg.Auth.Fields.AccessTokenLifetime(),
		RefreshTokenLifetime:  rtCfg.Auth.Fields.RefreshTokenLifetime(),
		DevCORSAllowedOrigins: rtCfg.Auth.Fields.DevCORSAllowedOrigins,
		DCRSettings: func() auth.DCRSettings {
			c := adminSvc.Sections().MCP
			return auth.DCRSettings{Enabled: c.Enabled, DynamicRedirectHosts: c.Fields.DynamicRedirectHosts}
		},
		WebAuthnRPID:          lo.FromPtr(rtCfg.WebAuthn.Fields.RPID),
		WebAuthnRPDisplayName: rtCfg.WebAuthn.Fields.RPName,
		WebAuthnRPOrigins:     rtCfg.WebAuthn.Fields.RPOrigins,
		ClientIPResolver:      clientIPResolver,
		Log:                   logger,
		SMTPHost:              lo.FromPtr(rtCfg.Email.Fields.Host),
		SMTPPort:              rtCfg.Email.Fields.Port,
		SMTPFrom:              lo.FromPtr(rtCfg.Email.Fields.From),
		SMTPUsername:          lo.FromPtr(rtCfg.Email.Fields.Username),
		SMTPPassword:          lo.FromPtr(rtCfg.Email.Fields.Password),
		SetupComplete: func() bool {
			return adminSvc.Sections().SetupComplete.Enabled
		},
		Timezone: adminSvc.Timezone,
	}, authDB)
	if err != nil {
		return err
	}
	background.Go(func() { database.RunRetentionSweep(ctx, db, logger) })
	background.Go(func() { database.RunSQLiteOptimize(ctx, db, logger) })
	background.Go(func() { authSrv.RunCleanup(ctx) })

	priceProvider := &wealth.YahooPriceProvider{
		Store:  wealthStore,
		Log:    logger,
		Client: apiClients.NewYahoo(&http.Client{Timeout: 10 * time.Second}),
		Now:    time.Now,
	}
	simpleFinClient := apiClients.NewSimpleFinClient()
	syncer := txnsync.New(db, txnsync.Config{
		Clients:          clientFactory,
		SimpleFinClient:  simpleFinClient,
		Now:              time.Now,
		InitialSyncDelay: 60 * time.Second,
		TrackingDisabled: func() bool {
			return adminSvc.Sections().General.Fields.DisableTransactionTracking
		},
	}, logger)
	if err := adminSvc.ConfigureSyncerLLM(
		ctx,
		syncer,
		transactionsStore,
		logger,
	); err != nil {
		return err
	}
	adminSvc.RegisterRuntimeConfigurationCallbacks(
		ctx,
		authSrv,
		syncer,
		transactionsStore,
		clientIPResolver,
		logger,
	)
	reportSyncer := &portfolio.ReportSyncer{
		Yahoo:        yfinance.New(&http.Client{Timeout: 30 * time.Second}, logger),
		Reports:      portfolioStore,
		Holdings:     portfolioStore,
		Connectivity: portfolioStore,
		Log:          logger,
		Now:          time.Now,
	}
	analysisSvc := &portfolio.AnalysisService{Reports: portfolioStore, Holdings: portfolioStore}
	realEstateSvc := &realestate.Service{Store: wealthStore, Log: logger}
	manualSnapshotSvc := &manual.Service{Store: wealthStore, Prices: priceProvider, Log: logger}
	plaidBalances := plaid.New(db, clientFactory, priceProvider, logger)
	evmChainAdapter := debank.New(&http.Client{Timeout: 15 * time.Second}, wealthStore, accountsStore, wealthStore, logger)
	simpleFinBalances := wealthsimplefin.New(wealthStore, simpleFinClient, logger)
	balances := balancesync.New(
		db,
		[]wealth.SyncAdapter{
			plaidBalances,
			evmChainAdapter,
			simpleFinBalances,
			realEstateSvc,
			manualSnapshotSvc,
		},
		balancesync.Config{
			PortfolioSync: reportSyncer,
			TrackingDisabled: func() bool {
				return adminSvc.Sections().General.Fields.DisableWealthTracking
			},
		},
		logger,
	)
	balances.Subscribe(accountEvents.RegisterSubscriber("wealth"))
	syncer.Subscribe(accountEvents.RegisterSubscriber("transactions"))
	linker := &accounts.LinkService{
		Accounts: accountsStore,
		Store:    accountsStore,
		Clients:  clientFactory,
		Syncer:   syncer,
		Events:   accountEvents,
	}
	simpleFin := &accounts.SimpleFinService{
		Store:  accountsStore,
		Client: simpleFinClient,
		Events: accountEvents,
		Log:    logger,
	}
	logoBackfiller := &accounts.LogoBackfiller{Store: accountsStore, Clients: clientFactory, Log: logger}

	wealthSvc := &wealth.Service{
		Store:         wealthStore,
		Log:           logger,
		PriceProvider: priceProvider,
		Timezone:      authSrv.Timezone,
	}
	budgetsSvc := &budgets.Service{Store: budgetsStore, Spending: transactionsStore, Categories: transactionsStore}
	if authSrv.OAuthEnabled() {
		adminSvc.Inviter = authSrv
	}

	resolver := &graph.Resolver{
		AccountsStore:     accountsStore,
		TransactionsStore: transactionsStore,
		LLM:               syncer.LLM(),
		Budgets:           budgetsSvc,
		WealthDB:          wealthStore,
		Linker:            linker,
		SimpleFin:         simpleFin,
		Admin:             adminSvc,
		Wealth:            wealthSvc,
		Portfolio:         analysisSvc,
		RealEstate:        realEstateSvc,
		ManualSnapshot:    manualSnapshotSvc,
		Config:            cfg,
		ScheduleRestart:   func() { cancelForRestart(errRestartRequested) },
	}

	router := httphandler.New(httphandler.Config{
		Logger:                logger,
		Auth:                  authSrv,
		Resolver:              resolver,
		Transactions:          transactionsStore,
		OAuthIssuerURL:        rtCfg.Auth.Fields.OAuthIssuerURL,
		DevCORSAllowedOrigins: rtCfg.Auth.Fields.DevCORSAllowedOrigins,
		ClientIPResolver:      clientIPResolver,
		RuntimeConfig:         runtimeCfg,
	})
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if cfg.SyncOff {
		logger.Info("SYNC_OFF is set, skipping background sync")
	} else {
		background.Go(func() {
			if err := logoBackfiller.Backfill(ctx); err != nil {
				logger.Error("plaid item logo backfill failed", "error", err)
			}
		})
		background.Go(func() { syncer.Run(ctx) })
		background.Go(func() { syncer.RecurringRun(ctx) })
		background.Go(func() { syncer.RunLLMWorker(ctx) })
		background.Go(func() { balances.Run(ctx) })
		background.Go(func() { syncer.RunAccountEvents(ctx) })
		background.Go(func() { balances.RunAccountEvents(ctx) })
	}
	logger.Info("server listening", "port", cfg.Port)
	// Waits for graceful shutdown to finish draining connections before
	// returning: the deferred db.Close() above must not run while requests
	// are still live.
	if err := u.ServeUntilDone(ctx, server, 10*time.Second); err != nil {
		return err
	}
	if cause := context.Cause(ctx); cause != nil && !errors.Is(cause, context.Canceled) {
		return cause
	}
	return nil
}
