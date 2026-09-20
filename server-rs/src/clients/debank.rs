use std::{
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};

const BASE_URL: &str = "https://api.debank.com";
const TIMEOUT_SECONDS: u64 = 15;
const NONCE_CHARS: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
const NONCE_LENGTH: usize = 40;

#[derive(Clone)]
pub struct Debank {
    http: Client,
    base_url: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(try_from = "Box<RawValue>")]
pub struct TokenBalance {
    #[serde(rename = "Chain")]
    pub chain: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Symbol")]
    pub symbol: String,
    #[serde(rename = "OptimizedSymbol")]
    pub optimized_symbol: String,
    #[serde(rename = "DisplaySymbol")]
    pub display_symbol: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Price")]
    pub price: f64,
    #[serde(rename = "Amount")]
    pub amount: f64,
    #[serde(rename = "USDValue")]
    pub usd_value: f64,
    #[serde(rename = "USDValuePresent")]
    pub usd_value_present: bool,
    #[serde(rename = "Raw")]
    pub raw: String,
}

impl TryFrom<Box<RawValue>> for TokenBalance {
    type Error = serde_json::Error;

    fn try_from(raw: Box<RawValue>) -> Result<Self, Self::Error> {
        let value = serde_json::from_str::<TokenBalanceWire>(raw.get())?;
        Ok(Self {
            chain: value.chain.unwrap_or_default(),
            id: value.id.unwrap_or_default(),
            symbol: value.symbol.unwrap_or_default(),
            optimized_symbol: value.optimized_symbol.unwrap_or_default(),
            display_symbol: value.display_symbol.unwrap_or_default(),
            name: value.name.unwrap_or_default(),
            price: value.price,
            amount: value.amount,
            usd_value: value.usd_value.unwrap_or_default(),
            usd_value_present: value.usd_value.is_some(),
            raw: raw.get().to_owned(),
        })
    }
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct TokenBalanceWire {
    chain: Option<String>,
    id: Option<String>,
    symbol: Option<String>,
    optimized_symbol: Option<String>,
    display_symbol: Option<String>,
    name: Option<String>,
    price: f64,
    amount: f64,
    usd_value: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Project {
    pub chain: String,
    pub id: String,
    pub name: String,
    #[serde(rename = "portfolio_item_list")]
    pub portfolio_items: Vec<ProjectItem>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct ProjectItem {
    pub pool: ProjectPool,
    pub detail: ProjectDetail,
    pub stats: ProjectStats,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct ProjectPool {
    pub id: String,
    pub controller: String,
    pub chain: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct ProjectDetail {
    pub description: String,
    pub supply_token_list: Vec<ProjectSupplyToken>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct ProjectSupplyToken {
    pub symbol: String,
    pub amount: Option<f64>,
    pub price: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(from = "ProjectStatsWire")]
pub struct ProjectStats {
    #[serde(rename = "net_usd_value")]
    pub net_usd_value: f64,
    #[serde(skip)]
    pub net_usd_value_present: bool,
}

impl From<ProjectStatsWire> for ProjectStats {
    fn from(value: ProjectStatsWire) -> Self {
        Self {
            net_usd_value: value.net_usd_value.unwrap_or_default(),
            net_usd_value_present: value.net_usd_value.is_some(),
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ProjectStatsWire {
    net_usd_value: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct TokenMetadata {
    #[serde(rename = "Chain")]
    pub chain: String,
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Symbol")]
    pub symbol: String,
    #[serde(rename = "OptimizedSymbol")]
    pub optimized_symbol: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Price")]
    pub price: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct DebankChain {
    pub id: String,
    pub name: String,
}

pub static DEBANK_CHAINS: LazyLock<Vec<DebankChain>> = LazyLock::new(|| {
    [
        ("eth", "Ethereum"),
        ("bsc", "BNB Chain"),
        ("xdai", "Gnosis Chain"),
        ("matic", "Polygon"),
        ("avax", "Avalanche"),
        ("op", "OP"),
        ("arb", "Arbitrum"),
        ("celo", "Celo"),
        ("cro", "Cronos"),
        ("metis", "Metis"),
        ("fuse", "Fuse"),
        ("klay", "Kaia"),
        ("rsk", "Rootstock"),
        ("kava", "Kava"),
        ("cfx", "Conflux"),
        ("era", "zkSync Era"),
        ("ron", "Ronin"),
        ("core", "CORE"),
        ("wemix", "WEMIX"),
        ("flr", "Flare"),
        ("zora", "Zora"),
        ("base", "Base"),
        ("linea", "Linea"),
        ("mnt", "Mantle"),
        ("manta", "Manta Pacific"),
        ("scrl", "Scroll"),
        ("opbnb", "opBNB"),
        ("mode", "Mode"),
        ("zeta", "ZetaChain"),
        ("merlin", "Merlin"),
        ("blast", "Blast"),
        ("frax", "Fraxtal"),
        ("xlayer", "X Layer"),
        ("itze", "Immutable zkEVM"),
        ("btr", "Bitlayer"),
        ("b2", "B²"),
        ("bob", "BOB"),
        ("taiko", "Taiko"),
        ("cyber", "Cyber"),
        ("sei", "Sei"),
        ("chiliz", "Chiliz"),
        ("dbk", "DBK Chain"),
        ("gravity", "Gravity"),
        ("lisk", "Lisk"),
        ("ape", "ApeChain"),
        ("ethlink", "Etherlink"),
        ("zircuit", "Zircuit"),
        ("world", "World Chain"),
        ("morph", "Morph"),
        ("sonic", "Sonic"),
        ("ink", "Ink"),
        ("sophon", "Sophon"),
        ("abs", "Abstract"),
        ("soneium", "Soneium"),
        ("bera", "Berachain"),
        ("uni", "Unichain"),
        ("story", "DATA Network"),
        ("lens", "Lens"),
        ("hyper", "HyperEVM"),
        ("hemi", "Hemi"),
        ("plume", "Plume"),
        ("katana", "Katana"),
        ("plasma", "Plasma"),
        ("monad", "Monad"),
        ("stable", "Stable"),
        ("g0", "0G"),
        ("megaeth", "MegaETH"),
        ("xdc", "XDC"),
        ("citrea", "Citrea"),
        ("tempo", "Tempo"),
        ("kite", "KiteAI"),
        ("hood", "Robinhood"),
        ("arc", "Arc"),
    ]
    .into_iter()
    .map(|(id, name)| DebankChain {
        id: id.to_owned(),
        name: name.to_owned(),
    })
    .collect()
});

impl Debank {
    pub fn new() -> Result<Self> {
        Self::with_base_url(BASE_URL)
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build DeBank HTTP client")?,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        })
    }

    pub async fn balance_list(&self, address: &str, chain_id: &str) -> Result<Vec<TokenBalance>> {
        let query = format!("chain={chain_id}&user_addr={}", address.to_ascii_lowercase());
        let data = self.signed_get("/token/balance_list", &query).await?;
        let chain = chain_id.to_owned();
        Ok(decode_debank::<Vec<TokenBalance>>(&data, "debank response")?
            .into_iter()
            .map(|token| TokenBalance {
                chain: chain.clone(),
                ..token
            })
            .collect())
    }

    pub async fn project_list(&self, address: &str) -> Result<(Vec<Project>, String)> {
        let query = format!("user_addr={}", address.to_ascii_lowercase());
        let data = self.signed_get("/portfolio/project_list", &query).await?;
        let projects = decode_debank::<Vec<Project>>(&data, "project list")?;
        Ok((projects, data))
    }

    pub async fn token(&self, chain_id: &str, token_id: &str) -> Result<TokenMetadata> {
        let data = self
            .signed_get("/token", &format!("chain_id={chain_id}&id={token_id}"))
            .await?;
        let token = decode_debank::<TokenBalance>(&data, "token metadata")?;
        Ok(TokenMetadata {
            chain: if token.chain.is_empty() { chain_id.to_owned() } else { token.chain },
            id: if token.id.is_empty() { token_id.to_owned() } else { token.id },
            symbol: token.symbol,
            optimized_symbol: token.optimized_symbol,
            name: token.name,
            price: token.price,
        })
    }

    pub async fn chain_list(&self) -> Result<Vec<DebankChain>> {
        let data = self.signed_get("/chain/list", "").await?;
        Ok(decode_debank::<DebankChainList>(&data, "chain list")?.chains)
    }

    async fn signed_get(&self, pathname: &str, query: &str) -> Result<String> {
        let DebankSignature {
            nonce,
            timestamp,
            signature,
        } = debank_sign("GET", pathname, query);
        let response = self
            .http
            .get(format!("{}{}?{query}", self.base_url, pathname))
            .header("x-api-nonce", format!("n_{nonce}"))
            .header("x-api-sign", signature)
            .header("x-api-ts", timestamp.to_string())
            .header("x-api-ver", "v2")
            .send()
            .await
            .context("debank request")?;
        anyhow::ensure!(
            response.status() == reqwest::StatusCode::OK,
            "debank returned status {}",
            response.status().as_u16()
        );
        response.text().await.context("read Debank response")
    }
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct DebankResponse<T> {
    data: T,
    error_code: i64,
    error_msg: String,
}

fn decode_debank<T: DeserializeOwned + Default>(data: &str, what: &str) -> Result<T> {
    let response = serde_json::from_str::<DebankResponse<T>>(data).with_context(|| format!("decode {what}"))?;
    if response.error_code != 0 {
        anyhow::bail!("debank error {}: {}", response.error_code, response.error_msg);
    }
    Ok(response.data)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct DebankChainList {
    chains: Vec<DebankChain>,
}

struct DebankSignature {
    nonce: String,
    timestamp: i64,
    signature: String,
}

fn debank_sign(method: &str, pathname: &str, query: &str) -> DebankSignature {
    let nonce = debank_nonce();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let signature = compute_sign(method, pathname, query, &nonce, timestamp);
    DebankSignature {
        nonce,
        timestamp,
        signature,
    }
}

fn compute_sign(method: &str, pathname: &str, query: &str, nonce: &str, timestamp: i64) -> String {
    let data1 = format!("{method}\n{pathname}\n{query}");
    let data2 = format!("debank-api\nn_{nonce}\n{timestamp}");
    let hash1 = Sha256::digest(data1.as_bytes());
    let hash2 = Sha256::digest(data2.as_bytes());
    let hash1_hex = hex::encode(hash1);
    let hash2_hex = hex::encode(hash2);
    let xor1 = xor_hex_bytes(&hash2_hex, 54);
    let xor2 = xor_hex_bytes(&hash2_hex, 92);
    let first = Sha256::digest([xor1, hash1_hex.into_bytes()].concat());
    hex::encode(Sha256::digest([xor2, first.to_vec()].concat()))
}

fn debank_nonce() -> String {
    let mut random = rand::rng();
    (0..NONCE_LENGTH)
        .map(|_| {
            let index = random.random_range(0..NONCE_CHARS.len());
            NONCE_CHARS.as_bytes()[index] as char
        })
        .collect()
}

fn xor_hex_bytes(hex_string: &str, key: u8) -> Vec<u8> {
    hex_string.bytes().map(|byte| byte ^ key).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{DEBANK_CHAINS, Debank, NONCE_CHARS, compute_sign, debank_nonce, xor_hex_bytes};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header_exists, method, path, query_param},
    };

    #[test]
    fn computes_the_reverse_engineered_signature() {
        assert_eq!(
            compute_sign(
                "GET",
                "/portfolio/project_list",
                "user_addr=0xf7462c16f1eea90bc62cee10b4c66c656a752e18",
                "5pEP9tZtR3FrPS4GXw9CtBIOwdCcuIUt4q8uWalg",
                1_772_823_398,
            ),
            "8feafea5421746b160e84bdcaaec8549f69c5588198f6d66b1e3b4ded2783d0b"
        );
        let nonce = debank_nonce();
        assert_eq!(nonce.len(), 40);
        assert!(nonce.chars().all(|character| NONCE_CHARS.contains(character)));
        assert_eq!(xor_hex_bytes("ab", 0), b"ab");
        assert_eq!(
            xor_hex_bytes("hello", 54)
                .iter()
                .map(|byte| byte ^ 54)
                .collect::<Vec<_>>(),
            b"hello"
        );
    }

    #[tokio::test]
    async fn decodes_balances_projects_tokens_and_chains() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/token/balance_list"))
            .and(query_param("chain", "eth"))
            .and(query_param("user_addr", "0xabc"))
            .and(header_exists("x-api-nonce"))
            .and(header_exists("x-api-sign"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"data":[{"id":null,"symbol":null,"optimized_symbol":null,"display_symbol":null,"name":null,"price":2000,"amount":1.5,"usd_value":0,"extra":{"kept":true}}]}"#))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/portfolio/project_list"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"data":[{"chain":"base","id":"beefy","name":"Beefy","portfolio_item_list":[{"pool":{"id":"0xpool"},"detail":{"supply_token_list":[{"symbol":"ETH","amount":1,"price":2000}]},"stats":{"net_usd_value":12.5}}]}]}"#))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"data":{"symbol":"POOL","name":"Pool Token","price":12.5}}"#),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/chain/list"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(r#"{"data":{"chains":[{"id":"eth","name":"Ethereum"}]}}"#),
            )
            .mount(&server)
            .await;

        let client = Debank::with_base_url(server.uri()).unwrap();
        let tokens = client.balance_list("0xABC", "eth").await.unwrap();
        assert_eq!(tokens[0].chain, "eth");
        assert!(tokens[0].id.is_empty());
        assert!(tokens[0].symbol.is_empty());
        assert!(tokens[0].name.is_empty());
        assert!(tokens[0].usd_value_present);
        assert_eq!(
            tokens[0].raw,
            r#"{"id":null,"symbol":null,"optimized_symbol":null,"display_symbol":null,"name":null,"price":2000,"amount":1.5,"usd_value":0,"extra":{"kept":true}}"#
        );
        let (projects, raw) = client.project_list("0xABC").await.unwrap();
        assert_eq!(projects[0].portfolio_items[0].detail.supply_token_list[0].symbol, "ETH");
        assert!(projects[0].portfolio_items[0].stats.net_usd_value_present);
        assert!(raw.contains("beefy"));
        let token = client.token("base", "0xpool").await.unwrap();
        assert_eq!(token.chain, "base");
        assert_eq!(token.id, "0xpool");
        assert_eq!(token.symbol, "POOL");
        assert_eq!(client.chain_list().await.unwrap()[0].id, "eth");
    }

    #[tokio::test]
    #[ignore]
    async fn smoke_debank_wallet_and_chain_list() {
        if std::env::var("RUN_SMOKE_TESTS").as_deref() != Ok("1") {
            eprintln!("set RUN_SMOKE_TESTS=1 to run DeBank smoke test");
            return;
        }
        let client = Debank::new().unwrap();
        let tokens = client
            .balance_list("0xd8da6bf26964af9d7eed9e03e53415d37aa96045", "eth")
            .await
            .unwrap();
        assert!(!tokens.is_empty());
        let token = client.token("eth", "eth").await.unwrap();
        assert!(!token.symbol.is_empty());
        assert!(token.price > 0.0);

        let live = client.chain_list().await.unwrap();
        let live = live
            .into_iter()
            .map(|chain| (chain.id, chain.name))
            .collect::<BTreeMap<_, _>>();
        let expected = DEBANK_CHAINS
            .iter()
            .cloned()
            .map(|chain| (chain.id, chain.name))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(live, expected, "DeBank chain list drifted");
    }
}
