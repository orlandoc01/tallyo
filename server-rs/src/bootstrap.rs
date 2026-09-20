use std::{sync::Arc, time::Duration};

use anyhow::Result;
use axum::Router;
use sqlx::SqlitePool;
use tokio::{net::TcpListener, sync::mpsc::Receiver, task::JoinSet};
use tokio_util::sync::CancellationToken;

use crate::{
    accounts::{AccountsCreated, EventBus, LinkService, PlaidClientFactory, SimpleFinService},
    admin::{self, Inviter, Manager, RuntimeTargets, Sections},
    auth,
    clients::{debank::Debank, simplefin::SimpleFinClient, yfinance::YFinance},
    config::{Config, MasterPassword},
    database::{open_database, run_retention_sweep, run_sqlite_optimize},
    graph::Resolver,
    handler, mcpserver,
    middleware::client_ip::ClientIpResolver,
    portfolio::ReportSyncer,
    transactions::{PlaidSync, SimpleFinSync, Syncer},
    utils::{future::BoxFuture, http::serve_until_done},
    wealth::{
        self, DebankSyncAdapter, ManualSyncAdapter, PlaidSyncAdapter, RealEstateSyncAdapter, SimpleFinSyncAdapter,
        WealthService, YahooPriceProvider, balancesync,
    },
};

const INITIAL_SYNC_DELAY: Duration = Duration::from_secs(60);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

pub struct App {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub auth: Arc<auth::Service>,
    pub manager: Arc<Manager>,
    pub router: Router,
    shutdown: CancellationToken,
    background: JoinSet<()>,
    sync: SyncLoops,
}

struct SyncLoops {
    syncer: Arc<Syncer>,
    balances: Arc<balancesync::Syncer>,
    wealth_events: Receiver<AccountsCreated>,
    transaction_events: Receiver<AccountsCreated>,
}

struct Clients {
    plaid: PlaidClientFactory,
    simplefin: SimpleFinClient,
    prices: YahooPriceProvider,
}

pub async fn run(mut config: Config, shutdown: CancellationToken) -> Result<()> {
    let pool = open_database(&config.db_path, config.db_encryption_key.take()).await?;
    match start(pool.clone(), config, shutdown).await {
        Ok((app, listener)) => app.serve(listener).await,
        Err(error) => {
            pool.close().await;
            Err(error)
        }
    }
}

async fn start(pool: SqlitePool, config: Config, shutdown: CancellationToken) -> Result<(App, TcpListener)> {
    let app = App::assemble(pool, config, shutdown).await?;
    let listener = TcpListener::bind(("0.0.0.0", app.config.port)).await?;
    Ok((app, listener))
}

impl App {
    pub async fn assemble(pool: SqlitePool, config: Config, shutdown: CancellationToken) -> Result<Self> {
        let manager = Arc::new(Manager::new(pool.clone()));
        let mut admin = admin::Service::new(pool.clone(), Arc::clone(&manager));
        let master_password = config
            .authorization
            .master_password
            .as_ref()
            .map(MasterPassword::as_str);
        let disable_all_auth = config.authorization.disable_all_auth;
        manager.load(master_password.is_some(), disable_all_auth).await?;
        let sections = manager.resolve_runtime_config(master_password, disable_all_auth)?;
        let client_ip = ClientIpResolver::new(&sections.security.fields.trusted_proxy_cidrs)?;

        let clients = Clients {
            plaid: PlaidClientFactory::new(pool.clone()),
            simplefin: SimpleFinClient::new()?,
            prices: YahooPriceProvider::new(pool.clone())?,
        };
        let events = EventBus::default();
        let auth =
            Arc::new(auth::Service::new(manager.auth_config(&sections, client_ip.clone())?, pool.clone()).await?);
        let mut background = JoinSet::new();
        spawn_maintenance(&mut background, &pool, &shutdown);

        let syncer = transaction_syncer(&pool, &clients, &sections);
        manager.configure_syncer_llm(&syncer).await?;
        let reports = Arc::new(ReportSyncer::new(pool.clone(), YFinance::new()?));
        let manual_snapshots = Arc::new(ManualSyncAdapter::with_prices(pool.clone(), clients.prices.clone()));
        let balances = Arc::new(balancesync::Syncer::new(
            pool.clone(),
            wealth_adapters(&pool, &clients, &shutdown, Arc::clone(&manual_snapshots))?,
            Some(reports),
        ));
        balances.update_tracking_disabled(sections.general.fields.disable_wealth_tracking);
        manager.set_runtime_targets(RuntimeTargets {
            auth: Some(Arc::clone(&auth)),
            client_ip: Some(client_ip),
            syncer: Some(Arc::clone(&syncer)),
            balances: Some(Arc::clone(&balances)),
        });
        let wealth_events = events.register_subscriber("wealth");
        let transaction_events = syncer.subscribe(&events);

        let Clients {
            plaid,
            simplefin,
            prices,
        } = clients;
        let linker = Arc::new(LinkService {
            pool: pool.clone(),
            clients: Arc::new(plaid),
            syncer: syncer.clone(),
            events: events.clone(),
        });
        let simplefin = Arc::new(SimpleFinService {
            pool: pool.clone(),
            client: simplefin,
            events,
        });
        let timezone = auth.timezone_cache();
        let wealth = Arc::new(WealthService::new(pool.clone(), Some(prices), move || {
            timezone.timezone()
        }));
        admin.inviter = Inviter::Auth(Arc::clone(&auth));

        let config = Arc::new(config);
        let resolver = Resolver {
            pool: pool.clone(),
            wealth,
            linker,
            simplefin,
            admin: Arc::new(admin),
            syncer: Arc::clone(&syncer),
            manual_snapshots,
            config: Arc::clone(&config),
        };
        let router = handler::router(handler::Config {
            auth: Arc::clone(&auth),
            resolver: resolver.clone(),
            runtime: Arc::clone(&manager),
            mcp: mcpserver::router(mcpserver::Server { resolver }),
        });
        Ok(Self {
            pool,
            config,
            auth,
            manager,
            router,
            shutdown,
            background,
            sync: SyncLoops {
                syncer,
                balances,
                wealth_events,
                transaction_events,
            },
        })
    }

    pub async fn serve(self, listener: TcpListener) -> Result<()> {
        let Self {
            pool,
            config,
            router,
            shutdown,
            mut background,
            sync,
            ..
        } = self;
        if config.sync_off {
            tracing::info!("SYNC_OFF is set, skipping background sync");
        } else {
            sync.spawn(&mut background, &shutdown);
        }
        tracing::info!(port = listener.local_addr()?.port(), "server listening");
        let served = serve_until_done(listener, router, shutdown.clone(), DRAIN_TIMEOUT).await;
        shutdown.cancel();
        while let Some(joined) = background.join_next().await {
            if let Err(error) = joined {
                tracing::error!(%error, "background task failed");
            }
        }
        pool.close().await;
        served
    }
}

impl SyncLoops {
    fn spawn(self, background: &mut JoinSet<()>, shutdown: &CancellationToken) {
        let Self {
            syncer,
            balances,
            wealth_events,
            transaction_events,
        } = self;
        let mut spawn_syncer = |run: fn(Arc<Syncer>, CancellationToken) -> BoxFuture<'static, ()>| {
            background.spawn(run(Arc::clone(&syncer), shutdown.clone()));
        };
        spawn_syncer(|syncer, cancel| Box::pin(async move { syncer.run(cancel).await }));
        spawn_syncer(|syncer, cancel| Box::pin(async move { syncer.run_recurring(cancel).await }));
        spawn_syncer(|syncer, cancel| Box::pin(async move { syncer.run_llm_worker(cancel).await }));
        background.spawn(Arc::clone(&balances).run(shutdown.clone()));
        background.spawn({
            let cancel = shutdown.clone();
            async move { syncer.run_account_events(transaction_events, cancel).await }
        });
        background.spawn(balances.run_account_events(wealth_events, shutdown.clone()));
    }
}

fn spawn_maintenance(background: &mut JoinSet<()>, pool: &SqlitePool, shutdown: &CancellationToken) {
    background.spawn({
        let (pool, cancel) = (pool.clone(), shutdown.clone());
        async move { run_retention_sweep(cancel, &pool).await }
    });
    background.spawn({
        let (pool, cancel) = (pool.clone(), shutdown.clone());
        async move { run_sqlite_optimize(cancel, &pool).await }
    });
    background.spawn(auth::run_cleanup(shutdown.clone(), pool.clone()));
}

fn transaction_syncer(pool: &SqlitePool, clients: &Clients, sections: &Sections) -> Arc<Syncer> {
    let syncer = Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(pool.clone(), clients.plaid.clone())),
            Box::new(SimpleFinSync::new(pool.clone(), clients.simplefin.clone())),
        ],
    )
    .with_initial_sync_delay(INITIAL_SYNC_DELAY);
    syncer.update_tracking_disabled(sections.general.fields.disable_transaction_tracking);
    Arc::new(syncer)
}

fn wealth_adapters(
    pool: &SqlitePool,
    clients: &Clients,
    shutdown: &CancellationToken,
    manual_snapshots: Arc<ManualSyncAdapter>,
) -> Result<Vec<Arc<dyn wealth::SyncAdapter>>> {
    Ok(vec![
        Arc::new(PlaidSyncAdapter::with_prices(
            pool.clone(),
            clients.plaid.clone(),
            clients.prices.clone(),
        )),
        Arc::new(DebankSyncAdapter::with_client_and_cancellation(
            pool.clone(),
            Debank::new()?,
            shutdown.clone(),
        )),
        Arc::new(SimpleFinSyncAdapter::with_client(
            pool.clone(),
            clients.simplefin.clone(),
        )),
        Arc::new(RealEstateSyncAdapter::new(pool.clone())),
        manual_snapshots,
    ])
}

#[cfg(test)]
mod tests;
