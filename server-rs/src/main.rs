use std::path::PathBuf;

use anyhow::{Context, Result};
use tallyo::{bootstrap, config, database};
use tokio::signal::unix::{SignalKind, signal};
use tokio_util::sync::CancellationToken;
use tracing_subscriber::EnvFilter;

const ENCRYPT_DB_FLAG: &str = "--encrypt-db";
const BACKUP_PLAIN_DATA_FLAG: &str = "--backup-plain-data";
const USAGE: &str = "usage: tallyo [--encrypt-db | --backup-plain-data[=PATH]]";

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Serve,
    EncryptDb,
    BackupPlainData(Option<PathBuf>),
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    if let Err(error) = run().await {
        tracing::error!(error = format!("{error:#}"), "server failed");
        std::process::exit(1);
    }
}

fn parse_arguments(arguments: &[String]) -> Result<Command> {
    let command = match arguments {
        [] => Command::Serve,
        [flag] if flag == ENCRYPT_DB_FLAG => Command::EncryptDb,
        [flag] if flag == BACKUP_PLAIN_DATA_FLAG => Command::BackupPlainData(None),
        [flag] => match flag
            .strip_prefix(BACKUP_PLAIN_DATA_FLAG)
            .and_then(|rest| rest.strip_prefix('='))
        {
            Some(path) if !path.is_empty() => Command::BackupPlainData(Some(PathBuf::from(path))),
            _ => anyhow::bail!("{USAGE}"),
        },
        _ => anyhow::bail!("{USAGE}"),
    };
    Ok(command)
}

async fn run() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let command = parse_arguments(&arguments)?;
    let mut config = config::load()?;
    match command {
        Command::EncryptDb => {
            let key = config
                .db_encryption_key
                .take()
                .context("DB Encryption Key is required with --encrypt-db")?;
            return database::encrypt_existing(&config.db_path, key).await;
        }
        Command::BackupPlainData(destination) => {
            return database::backup_plain_data(&config.db_path, config.db_encryption_key, destination)
                .await
                .map(drop);
        }
        Command::Serve => {}
    }
    let shutdown = CancellationToken::new();
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            tokio::select! {
                _ = interrupt.recv() => {}
                _ = terminate.recv() => {}
            }
            shutdown.cancel();
        }
    });
    bootstrap::run(config, shutdown).await
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{Command, USAGE, parse_arguments};

    fn parse(arguments: &[&str]) -> anyhow::Result<Command> {
        parse_arguments(
            &arguments
                .iter()
                .map(|argument| (*argument).to_owned())
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn parses_each_command() {
        assert_eq!(parse(&[]).unwrap(), Command::Serve);
        assert_eq!(parse(&["--encrypt-db"]).unwrap(), Command::EncryptDb);
        assert_eq!(parse(&["--backup-plain-data"]).unwrap(), Command::BackupPlainData(None));
        assert_eq!(
            parse(&["--backup-plain-data=/backup/tallyo.db"]).unwrap(),
            Command::BackupPlainData(Some(PathBuf::from("/backup/tallyo.db")))
        );
    }

    #[test]
    fn rejects_extra_and_malformed_arguments() {
        for arguments in [
            &["--backup-plain-data", "/backup/tallyo.db"][..],
            &["--backup-plain-data="],
            &["--backup-plain-data-now"],
            &["--encrypt-db", "--backup-plain-data"],
            &["--other"],
        ] {
            assert_eq!(parse(arguments).unwrap_err().to_string(), USAGE, "{arguments:?}");
        }
    }
}
