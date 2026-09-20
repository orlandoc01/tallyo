use std::{
    net::{IpAddr, Ipv6Addr},
    str::FromStr,
    sync::{Arc, RwLock},
};

use anyhow::Result;
use axum::http::HeaderMap;
use ipnet::IpNet;

#[derive(Clone, Debug)]
pub struct ClientIpResolver {
    trusted_proxies: Arc<RwLock<Vec<IpNet>>>,
}

impl ClientIpResolver {
    pub fn new(trusted_proxy_cidrs: &[String]) -> Result<Self> {
        Ok(Self {
            trusted_proxies: Arc::new(RwLock::new(parse_trusted_proxy_cidrs(trusted_proxy_cidrs)?)),
        })
    }

    pub fn set_trusted_proxy_cidrs(&self, trusted_proxy_cidrs: &[String]) -> Result<()> {
        let trusted_proxies = parse_trusted_proxy_cidrs(trusted_proxy_cidrs)?;
        *self
            .trusted_proxies
            .write()
            .map_err(|_| anyhow::anyhow!("trusted proxy lock poisoned"))? = trusted_proxies;
        Ok(())
    }

    pub fn client_ip(&self, remote: IpAddr, headers: &HeaderMap) -> IpAddr {
        let remote = remote.to_canonical();
        if !self.is_trusted_proxy(remote) {
            return remote;
        }
        forwarded_for(headers)
            .and_then(|forwarded| self.forwarded_client_ip(forwarded))
            .or_else(|| {
                headers
                    .get("X-Real-IP")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.trim().parse().ok())
            })
            .unwrap_or(remote)
    }

    fn forwarded_client_ip(&self, forwarded: &str) -> Option<IpAddr> {
        let addresses = forwarded
            .split(',')
            .filter_map(|value| value.trim().parse().ok())
            .collect::<Vec<_>>();
        addresses
            .iter()
            .rev()
            .copied()
            .find(|address| !self.is_trusted_proxy(*address))
            .or_else(|| addresses.first().copied())
    }

    fn is_trusted_proxy(&self, address: IpAddr) -> bool {
        self.trusted_proxies
            .read()
            .map(|trusted_proxies| trusted_proxies.iter().any(|network| network.contains(&address)))
            .unwrap_or(false)
    }
}

pub fn parse_trusted_proxy_cidrs(values: &[String]) -> Result<Vec<IpNet>> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(parse_trusted_proxy_cidr)
        .collect()
}

fn parse_trusted_proxy_cidr(value: &str) -> Result<IpNet> {
    let network = match IpAddr::from_str(value) {
        Ok(address) => IpNet::new(
            address,
            match address {
                IpAddr::V4(_) => 32,
                IpAddr::V6(_) => 128,
            },
        )?,
        Err(_) => value
            .parse::<IpNet>()
            .map_err(|error| anyhow::anyhow!("parse trusted proxy CIDR {value:?}: {error}"))?,
    };
    Ok(network.trunc())
}

fn forwarded_for(headers: &HeaderMap) -> Option<&str> {
    headers.get("X-Forwarded-For").and_then(|value| value.to_str().ok())
}

pub fn canonicalize_ip(address: IpAddr) -> IpAddr {
    match address.to_canonical() {
        address @ IpAddr::V4(_) => address,
        IpAddr::V6(address) => {
            let mut octets = address.octets();
            octets[8..].fill(0);
            IpAddr::V6(Ipv6Addr::from(octets))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::IpAddr;

    use axum::http::{HeaderMap, HeaderValue};

    use super::{ClientIpResolver, canonicalize_ip, parse_trusted_proxy_cidrs};

    #[test]
    fn uses_forwarded_headers_only_from_trusted_proxies() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Forwarded-For", HeaderValue::from_static("198.51.100.25, 10.0.0.2"));
        let trusted = ClientIpResolver::new(&["10.0.0.0/24".to_owned()]).unwrap();
        let untrusted = ClientIpResolver::new(&[]).unwrap();
        assert_eq!(
            trusted.client_ip("10.0.0.1".parse().unwrap(), &headers),
            "198.51.100.25".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            untrusted.client_ip("10.0.0.1".parse().unwrap(), &headers),
            "10.0.0.1".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn updates_trusted_proxies_and_normalizes_networks() {
        let resolver = ClientIpResolver::new(&[]).unwrap();
        resolver.set_trusted_proxy_cidrs(&["10.0.0.1/24".to_owned()]).unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("X-Real-IP", HeaderValue::from_static("198.51.100.25"));
        assert_eq!(
            resolver.client_ip("10.0.0.2".parse().unwrap(), &headers),
            "198.51.100.25".parse::<IpAddr>().unwrap()
        );
        assert!(parse_trusted_proxy_cidrs(&["not-a-cidr".to_owned()]).is_err());
    }

    #[test]
    fn canonicalizes_ipv6_to_a_64_bit_network() {
        assert_eq!(
            canonicalize_ip("2001:db8:1:2:3:4:5:6".parse().unwrap()).to_string(),
            "2001:db8:1:2::"
        );
    }

    #[test]
    fn canonicalizes_ipv4_mapped_ipv6_addresses() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Forwarded-For", HeaderValue::from_static("198.51.100.25"));
        let resolver = ClientIpResolver::new(&["10.0.0.0/24".to_owned()]).unwrap();

        assert_eq!(
            resolver.client_ip("::ffff:10.0.0.1".parse().unwrap(), &headers),
            "198.51.100.25".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            canonicalize_ip("::ffff:1.2.3.4".parse().unwrap()),
            "1.2.3.4".parse::<IpAddr>().unwrap()
        );
    }
}
