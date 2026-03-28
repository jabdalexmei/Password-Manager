use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Clone)]
#[error("{code}")]
pub struct ErrorCodeString {
    pub code: String,
}

impl ErrorCodeString {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, ErrorCodeString>;
