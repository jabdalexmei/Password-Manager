use super::*;

pub(super) fn format_rusqlite_error(err: &rusqlite::Error) -> String {
    match err {
        rusqlite::Error::SqliteFailure(e, msg) => {
            let m = msg.as_deref().unwrap_or("");
            format!(
                "SqliteFailure(code={:?}, extended_code={}, message={})",
                e.code, e.extended_code, m
            )
        }
        other => format!("{other:?}"),
    }
}

pub(super) fn classify_db_error(err: &rusqlite::Error) -> ErrorCodeString {
    match err {
        rusqlite::Error::SqliteFailure(e, _) => {
            use rusqlite::ErrorCode::*;
            match e.code {
                DatabaseBusy | DatabaseLocked => ErrorCodeString::new("DB_BUSY"),
                _ => ErrorCodeString::new("DB_QUERY_FAILED"),
            }
        }
        _ => ErrorCodeString::new("DB_QUERY_FAILED"),
    }
}

pub(super) fn map_vault_decrypt_error(err: ErrorCodeString) -> ErrorCodeString {
    match err.code.as_str() {
        "CRYPTO_BLOB_INVALID" | "CRYPTO_VERSION_UNSUPPORTED" => {
            ErrorCodeString::new("VAULT_CORRUPTED")
        }
        "CRYPTO_DECRYPT_FAILED" => ErrorCodeString::new("VAULT_DECRYPT_FAILED"),
        other => {
            log::warn!("[SECURITY][vault_decrypt] unmapped_error_code={}", other);
            ErrorCodeString::new("VAULT_DECRYPT_FAILED")
        }
    }
}
