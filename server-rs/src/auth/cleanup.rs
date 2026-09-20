use std::time::Duration;

use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

use super::Store;

pub async fn run_cleanup(cancellation: CancellationToken, pool: SqlitePool) {
    let store = Store::new(pool);
    crate::database::run_periodic(cancellation, Duration::from_secs(10 * 60), move || {
        let store = store.clone();
        async move { store.cleanup_expired().await }
    })
    .await;
}
