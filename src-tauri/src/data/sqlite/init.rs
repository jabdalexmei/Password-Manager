use rusqlite::Connection;

use crate::data::crypto::cipher::{encrypt_vault_blob, write_encrypted_file};
use crate::data::profiles::paths::{ensure_profile_dirs, vault_db_path};
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};
use rusqlite::DatabaseName;

use super::migrations;

pub fn init_database_protected_encrypted(
    sp: &StoragePaths,
    profile_id: &str,
    key: &[u8; 32],
) -> Result<()> {
    ensure_profile_dirs(sp, profile_id, true)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let conn = Connection::open_in_memory().map_err(|_| ErrorCodeString::new("DB_OPEN_FAILED"))?;
    migrations::migrate_to_latest(&conn)?;

    let bytes = conn
        .serialize(DatabaseName::Main)
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
    let encrypted = encrypt_vault_blob(profile_id, key, &bytes)?;
    write_encrypted_file(&vault_db_path(sp, profile_id)?, &encrypted)
}
