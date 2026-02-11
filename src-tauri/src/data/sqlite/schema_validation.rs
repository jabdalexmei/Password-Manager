use rusqlite::Connection;
use rusqlite::Error as RusqliteError;
use rusqlite::OptionalExtension;

use crate::error::{ErrorCodeString, Result};

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

fn has_table(conn: &Connection, name: &str) -> Result<bool> {
    let sql = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1";
    let exists: Option<i32> = conn
        .query_row(sql, [name], |row| row.get(0))
        .optional()
        .map_err(|e| {
            log_sqlite_err(&format!("has_table.query_row name={name} sql={sql}"), &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;
    Ok(exists.is_some())
}

pub fn schema_validate(conn: &Connection) -> Result<()> {
    let required = ["vaults", "folders", "datacards", "bank_cards"];
    for table in required {
        if !has_table(conn, table)? {
            return Err(ErrorCodeString::new("DB_SCHEMA_MISSING"));
        }
    }
    Ok(())
}
