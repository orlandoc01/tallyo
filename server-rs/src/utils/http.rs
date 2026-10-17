use std::{net::SocketAddr, time::Duration};

use anyhow::Result;
use axum::{Router, extract::ConnectInfo};
use hyper_util::{
    rt::{TokioExecutor, TokioIo, TokioTimer},
    server::{conn::auto::Builder, graceful::GracefulShutdown},
    service::TowerToHyperService,
};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tower::ServiceBuilder;

// hyper's single knob covers the first header read and every keep-alive gap; Go's 120 s idle bound is the binding one.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(120);
const ACCEPT_RETRY_DELAY: Duration = Duration::from_secs(1);

pub async fn serve_until_done(
    listener: TcpListener,
    router: Router,
    shutdown: CancellationToken,
    drain_timeout: Duration,
) -> Result<()> {
    serve(listener, router, shutdown, drain_timeout, HEADER_READ_TIMEOUT).await
}

fn tag_remote<B>(remote: SocketAddr) -> impl Fn(axum::http::Request<B>) -> axum::http::Request<B> + Clone {
    move |mut request| {
        request.extensions_mut().insert(ConnectInfo(remote));
        request
    }
}

async fn serve(
    listener: TcpListener,
    router: Router,
    shutdown: CancellationToken,
    drain_timeout: Duration,
    header_read_timeout: Duration,
) -> Result<()> {
    let mut builder = Builder::new(TokioExecutor::new()).http1_only();
    builder
        .http1()
        .timer(TokioTimer::new())
        .keep_alive(true)
        .header_read_timeout(header_read_timeout);
    let graceful = GracefulShutdown::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, remote)) => {
                    let service = ServiceBuilder::new()
                        .map_request(tag_remote(remote))
                        .service(router.clone());
                    let connection = builder
                        .serve_connection(TokioIo::new(stream), TowerToHyperService::new(service))
                        .into_owned();
                    let watched = graceful.watcher().watch(connection);
                    tokio::spawn(async move {
                        if let Err(error) = watched.await {
                            tracing::debug!(%error, "connection closed with error");
                        }
                    });
                }
                Err(error) => {
                    tracing::warn!(%error, "accept failed");
                    tokio::time::sleep(ACCEPT_RETRY_DELAY).await;
                }
            },
            _ = shutdown.cancelled() => break,
        }
    }
    drop(listener);
    tokio::time::timeout(drain_timeout, graceful.shutdown())
        .await
        .map_err(|_| anyhow::anyhow!("http server shutdown timeout after {drain_timeout:?}"))
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, sync::Arc, time::Duration};

    use axum::{Router, extract::ConnectInfo, routing::get};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpSocket, TcpStream},
        sync::{Notify, oneshot},
    };
    use tokio_util::sync::CancellationToken;

    use super::{serve, serve_until_done};
    use crate::middleware::{client_ip::ClientIpResolver, ratelimit::rate_limit_with_client_ip};

    #[tokio::test]
    async fn drains_an_in_flight_request() {
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let handler_started = Arc::clone(&started);
        let handler_release = Arc::clone(&release);
        let router = Router::new().route(
            "/",
            get(move || {
                let handler_started = Arc::clone(&handler_started);
                let handler_release = Arc::clone(&handler_release);
                async move {
                    handler_started.notify_one();
                    handler_release.notified().await;
                    "ok"
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = CancellationToken::new();
        let (done_tx, done_rx) = oneshot::channel();
        let server_shutdown = shutdown.clone();
        tokio::spawn(async move {
            let _ = done_tx.send(serve_until_done(listener, router, server_shutdown, Duration::from_secs(1)).await);
        });

        let client = tokio::spawn(request(address));
        started.notified().await;
        shutdown.cancel();
        release.notify_one();
        assert!(String::from_utf8(client.await.unwrap()).unwrap().contains("200 OK"));
        assert!(done_rx.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn returns_an_error_when_draining_times_out() {
        let started = Arc::new(Notify::new());
        let handler_started = Arc::clone(&started);
        let router = Router::new().route(
            "/",
            get(move || {
                let handler_started = Arc::clone(&handler_started);
                async move {
                    handler_started.notify_one();
                    std::future::pending::<()>().await;
                    "never"
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = CancellationToken::new();
        let server = tokio::spawn(serve_until_done(
            listener,
            router,
            shutdown.clone(),
            Duration::from_millis(20),
        ));

        let client = tokio::spawn(request(address));
        started.notified().await;
        shutdown.cancel();
        assert!(
            server
                .await
                .unwrap()
                .unwrap_err()
                .to_string()
                .contains("shutdown timeout")
        );
        client.abort();
    }

    #[tokio::test]
    async fn closes_a_connection_that_sends_no_headers_within_the_timeout() {
        let (address, _shutdown) = serve_with_header_timeout(Duration::from_millis(100)).await;

        let mut stream = TcpStream::connect(address).await.unwrap();
        let mut response = Vec::new();
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut response)).await;
        assert_eq!(read.unwrap().unwrap(), 0);
    }

    #[tokio::test]
    async fn serves_a_request_that_arrives_within_the_timeout() {
        let (address, _shutdown) = serve_with_header_timeout(Duration::from_millis(100)).await;

        assert!(String::from_utf8(request(address).await).unwrap().contains("200 OK"));
    }

    #[tokio::test]
    async fn exposes_the_peer_address_through_connect_info() {
        let router = Router::new().route(
            "/",
            get(|ConnectInfo(remote): ConnectInfo<SocketAddr>| async move { remote.ip().to_string() }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = CancellationToken::new();
        tokio::spawn(serve_until_done(
            listener,
            router,
            shutdown.clone(),
            Duration::from_secs(1),
        ));

        let response = String::from_utf8(request(address).await).unwrap();
        assert!(response.contains("200 OK"), "{response}");
        assert!(response.ends_with("127.0.0.1"), "{response}");
    }

    #[tokio::test]
    async fn rate_limits_each_peer_address_independently() {
        let router = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(rate_limit_with_client_ip(
                1,
                Duration::from_secs(60),
                ClientIpResolver::new(&[]).unwrap(),
            )));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = CancellationToken::new();
        tokio::spawn(serve_until_done(
            listener,
            router,
            shutdown.clone(),
            Duration::from_secs(1),
        ));

        let status = |response: Vec<u8>| String::from_utf8(response).unwrap().lines().next().unwrap().to_owned();
        assert!(status(request_from("127.0.0.1", address).await).contains("200"));
        assert!(status(request_from("127.0.0.1", address).await).contains("429"));
        assert!(status(request_from("127.0.0.2", address).await).contains("200"));
    }

    async fn request_from(local_ip: &str, address: SocketAddr) -> Vec<u8> {
        let socket = TcpSocket::new_v4().unwrap();
        socket.bind(format!("{local_ip}:0").parse().unwrap()).unwrap();
        let mut stream = socket.connect(address).await.unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        response
    }

    async fn serve_with_header_timeout(header_read_timeout: Duration) -> (SocketAddr, CancellationToken) {
        let router = Router::new().route("/", get(|| async { "ok" }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = CancellationToken::new();
        tokio::spawn(serve(
            listener,
            router,
            shutdown.clone(),
            Duration::from_secs(1),
            header_read_timeout,
        ));
        (address, shutdown)
    }

    async fn request(address: SocketAddr) -> Vec<u8> {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        response
    }
}
