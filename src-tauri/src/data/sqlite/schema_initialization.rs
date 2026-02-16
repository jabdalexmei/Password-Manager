use rusqlite::Connection;
use rusqlite::Error as RusqliteError;

use crate::error::{ErrorCodeString, Result};

pub const SCHEMA_VERSION: i32 = 1;

fn log_sqlite_err(ctx: &str, err: &RusqliteError) {
    match err {
        RusqliteError::SqliteFailure(e, msg) => {
            log::error!(
                "[DB][sqlite_error] ctx={} code={:?} extended_code={} msg={}",
                ctx,
                e.code,
                e.extended_code,
                msg.as_deref().unwrap_or("")
            );
        }
        other => {
            log::error!("[DB][sqlite_error] ctx={} err={other:?}", ctx);
        }
    }
}

pub fn schema_initialization(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| {
            log_sqlite_err("schema_initialization.foreign_keys_on", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    conn.execute_batch(include_str!("schema.sql"))
        .map_err(|e| {
            log_sqlite_err("schema_initialization.apply_schema", &e);
            ErrorCodeString::new("DB_MIGRATION_FAILED")
        })?;

    conn.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION))
        .map_err(|e| {
            log_sqlite_err("schema_initialization.stamp_user_version", &e);
            ErrorCodeString::new("DB_MIGRATION_FAILED")
        })?;

    Ok(())
}
