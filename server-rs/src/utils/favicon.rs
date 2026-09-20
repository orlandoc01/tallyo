use url::Url;

pub fn duckduckgo_favicon_url(website: &str) -> Option<String> {
    let website = website.trim();
    if website.is_empty() {
        return None;
    }
    let website = match website {
        website if website.starts_with("//") => format!("https:{website}"),
        website if website.contains("://") => website.to_owned(),
        website => format!("https://{website}"),
    };
    let host = Url::parse(&website).ok()?.host_str()?.to_owned();
    (!host.is_empty()).then(|| format!("https://icons.duckduckgo.com/ip3/{host}.ico"))
}

#[cfg(test)]
mod tests {
    use super::duckduckgo_favicon_url;

    #[test]
    fn builds_favicon_urls_from_supported_website_forms() {
        assert_eq!(
            duckduckgo_favicon_url("example.com"),
            Some("https://icons.duckduckgo.com/ip3/example.com.ico".to_owned())
        );
        assert_eq!(
            duckduckgo_favicon_url("https://example.com/path"),
            Some("https://icons.duckduckgo.com/ip3/example.com.ico".to_owned())
        );
        assert_eq!(
            duckduckgo_favicon_url("//example.com:8080"),
            Some("https://icons.duckduckgo.com/ip3/example.com.ico".to_owned())
        );
        assert_eq!(duckduckgo_favicon_url("not a valid url"), None);
        assert_eq!(duckduckgo_favicon_url(""), None);
    }
}
