use rusqlite::Error;

pub fn log_sqlite_err(op: &str, sql: &str, err: &Error) {
    log::error!("[DB][{op}] rusqlite error: {err:?}");
    log::error!("[DB][{op}] sql: {sql}");
}
