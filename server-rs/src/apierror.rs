use strum_macros::Display;

pub const INTERNAL_MESSAGE: &str = "internal error";

#[derive(Clone, Copy, Debug, Display, Eq, PartialEq)]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum Code {
    BadUserInput,
    Forbidden,
    Internal,
}

#[derive(Debug)]
pub struct ApiError {
    pub message: String,
    pub code: Code,
    source: Option<anyhow::Error>,
}

impl ApiError {
    pub fn new(message: impl Into<String>, code: Code) -> Self {
        Self {
            message: message.into(),
            code,
            source: None,
        }
    }

    pub fn public(error: impl Into<anyhow::Error>) -> Self {
        let source = error.into();
        Self {
            message: source.to_string(),
            code: Code::BadUserInput,
            source: Some(source),
        }
    }

    pub fn bad_input(message: impl Into<String>) -> Self {
        Self::new(message, Code::BadUserInput)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ApiError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|source| &**source as _)
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error;

    use super::{ApiError, Code, INTERNAL_MESSAGE};

    #[test]
    fn displays_only_the_public_message() {
        assert_eq!(ApiError::new("nope", Code::Forbidden).to_string(), "nope");
        assert_eq!(INTERNAL_MESSAGE, "internal error");
    }

    #[test]
    fn exposes_stable_codes() {
        assert_eq!(Code::BadUserInput.to_string(), "BAD_USER_INPUT");
        assert_eq!(Code::Forbidden.to_string(), "FORBIDDEN");
        assert_eq!(Code::Internal.to_string(), "INTERNAL");
    }

    #[test]
    fn public_error_keeps_its_source() {
        let error = ApiError::public(anyhow::anyhow!("bad value"));

        assert_eq!(error.code, Code::BadUserInput);
        assert_eq!(error.source().map(ToString::to_string).as_deref(), Some("bad value"));
    }
}
