use rusqlite::Connection;
use rusqlite::Error as RusqliteError;
use rusqlite::OptionalExtension;

use crate::error::{ErrorCodeString, Result};

const CURRENT_SCHEMA_VERSION: i32 = 2;

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

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&sql).map_err(|e| {
        log_sqlite_err(&format!("has_column.prepare table={table} sql={sql}"), &e);
        ErrorCodeString::new("DB_QUERY_FAILED")
    })?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| {
            log_sqlite_err(&format!("has_column.query_map table={table} sql={sql}"), &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| {
            log_sqlite_err(&format!("has_column.collect table={table} sql={sql}"), &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    Ok(rows.iter().any(|name| name == column))
}

fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    if !has_column(conn, "folders", "vault_id")? {
        conn.execute(
            "ALTER TABLE folders ADD COLUMN vault_id TEXT NOT NULL DEFAULT 'default';",
            [],
        )
        .map_err(|e| {
            log_sqlite_err("migrate_v1_to_v2.alter_folders_vault_id", &e);
            ErrorCodeString::new("DB_MIGRATION_FAILED")
        })?;
    }

    if !has_column(conn, "datacards", "vault_id")? {
        conn.execute(
            "ALTER TABLE datacards ADD COLUMN vault_id TEXT NOT NULL DEFAULT 'default';",
            [],
        )
        .map_err(|e| {
            log_sqlite_err("migrate_v1_to_v2.alter_datacards_vault_id", &e);
            ErrorCodeString::new("DB_MIGRATION_FAILED")
        })?;
    }

    if !has_column(conn, "bank_cards", "vault_id")? {
        conn.execute(
            "ALTER TABLE bank_cards ADD COLUMN vault_id TEXT NOT NULL DEFAULT 'default';",
            [],
        )
        .map_err(|e| {
            log_sqlite_err("migrate_v1_to_v2.alter_bank_cards_vault_id", &e);
            ErrorCodeString::new("DB_MIGRATION_FAILED")
        })?;
    }

    conn.execute(
        "UPDATE folders SET vault_id = 'default' WHERE vault_id IS NULL OR TRIM(vault_id) = '';",
        [],
    )
    .map_err(|e| {
        log_sqlite_err("migrate_v1_to_v2.backfill_folders_vault_id", &e);
        ErrorCodeString::new("DB_MIGRATION_FAILED")
    })?;

    conn.execute(
        "UPDATE datacards SET vault_id = 'default' WHERE vault_id IS NULL OR TRIM(vault_id) = '';",
        [],
    )
    .map_err(|e| {
        log_sqlite_err("migrate_v1_to_v2.backfill_datacards_vault_id", &e);
        ErrorCodeString::new("DB_MIGRATION_FAILED")
    })?;

    conn.execute(
        "UPDATE bank_cards SET vault_id = 'default' WHERE vault_id IS NULL OR TRIM(vault_id) = '';",
        [],
    )
    .map_err(|e| {
        log_sqlite_err("migrate_v1_to_v2.backfill_bank_cards_vault_id", &e);
        ErrorCodeString::new("DB_MIGRATION_FAILED")
    })?;

    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS vaults (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vaults_unique_name ON vaults(name);
INSERT OR IGNORE INTO vaults (id, name, is_default, created_at, updated_at)
VALUES ('default', 'Default vault', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
DROP INDEX IF EXISTS idx_folders_unique_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_name
ON folders(vault_id, parent_id, name)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folders_vault ON folders(vault_id);
CREATE INDEX IF NOT EXISTS idx_datacards_vault ON datacards(vault_id);
CREATE INDEX IF NOT EXISTS idx_bank_cards_vault ON bank_cards(vault_id);
"#,
    )
    .map_err(|e| {
        log_sqlite_err("migrate_v1_to_v2.execute_batch", &e);
        ErrorCodeString::new("DB_MIGRATION_FAILED")
    })?;

    Ok(())
}

pub fn migrate_to_latest(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| {
            log_sqlite_err("migrate_to_latest.execute_batch PRAGMA foreign_keys=ON", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    let version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|e| {
            log_sqlite_err("migrate_to_latest.query_row PRAGMA user_version", &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

    if version == CURRENT_SCHEMA_VERSION {
        log::debug!("[DB][migrate] up_to_date version={version}");
        return Ok(());
    }

    // Fresh DB: create schema and stamp it with the baseline version.
    if version == 0 {
        log::info!("[DB][migrate] init schema user_version={CURRENT_SCHEMA_VERSION}");
        conn.execute_batch(include_str!("schema.sql"))
            .map_err(|_| ErrorCodeString::new("DB_MIGRATION_FAILED"))?;
        conn.execute_batch(&format!("PRAGMA user_version = {CURRENT_SCHEMA_VERSION};"))
            .map_err(|_| ErrorCodeString::new("DB_MIGRATION_FAILED"))?;
        return Ok(());
    }

    if version == 1 {
        log::info!("[DB][migrate] migrate from=1 to=2");
        migrate_v1_to_v2(conn)?;
        conn.execute_batch("PRAGMA user_version = 2;")
            .map_err(|_| ErrorCodeString::new("DB_MIGRATION_FAILED"))?;
        return Ok(());
    }

    log::warn!("[DB][migrate] unsupported schema version={version}");
    Err(ErrorCodeString::new("DB_MIGRATION_FAILED"))
}

pub fn validate_core_schema(conn: &Connection) -> Result<()> {
    let required = ["vaults", "folders", "datacards", "bank_cards"];
    for table in required {
        if !has_table(conn, table)? {
            return Err(ErrorCodeString::new("DB_SCHEMA_MISSING"));
        }
    }
    Ok(())
}
