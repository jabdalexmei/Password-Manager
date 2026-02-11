use rusqlite::Connection;
use rusqlite::Error as RusqliteError;
use rusqlite::OptionalExtension;

use crate::data::sqlite::schema_initialization;
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

fn has_any_user_table(conn: &Connection) -> Result<bool> {
    let sql = "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1";
    let exists: Option<i32> = conn
        .query_row(sql, [], |row| row.get(0))
        .optional()
        .map_err(|e| {
            log_sqlite_err(&format!("has_any_user_table.query_row sql={sql}"), &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;
    Ok(exists.is_some())
}

pub fn schema_migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| {
            log_sqlite_err("schema_migrate.foreign_keys_on", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    let version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|e| {
            log_sqlite_err("schema_migrate.query_row PRAGMA user_version", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    if version == schema_initialization::SCHEMA_VERSION {
        log::debug!("[DB][schema_migrate] up_to_date version={version}");
        return Ok(());
    }

    if version == 0 {
        if has_any_user_table(conn)? {
            log::warn!("[DB][schema_migrate] user_version=0 but schema exists");
            return Err(ErrorCodeString::new("DB_MIGRATION_FAILED"));
        }

        log::info!(
            "[DB][schema_migrate] initialization schema user_version={}",
            schema_initialization::SCHEMA_VERSION
        );
        return schema_initialization::schema_initialization(conn);
    }

    if version == 2 || version == 3 {
        conn.execute_batch(&format!(
            "PRAGMA user_version = {};",
            schema_initialization::SCHEMA_VERSION
        ))
        .map_err(|e| {
            log_sqlite_err("schema_migrate.stamp_user_version", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;
        return Ok(());
    }

    log::warn!("[DB][schema_migrate] unsupported schema version={version}");
    Err(ErrorCodeString::new("DB_MIGRATION_FAILED"))
}
