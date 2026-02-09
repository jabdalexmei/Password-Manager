use std::io::{self, Read};
use std::path::Path;
use std::ptr::NonNull;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::ffi;
use rusqlite::serialize::OwnedData;
use rusqlite::DatabaseName;
use zeroize::{Zeroize, Zeroizing};
use rand::rngs::OsRng;
use rand::RngCore;

use crate::app_state::{AppState, VaultSession};
use crate::data::crypto::{cipher, kdf, key_check, master_key};
use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::{
    ensure_profile_dirs, kdf_salt_path, key_check_path, profile_dir, vault_db_path, vault_key_path,
};
use crate::data::profiles::registry;
use crate::data::sqlite::migrations;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachments_service;
use crate::services::settings_service;
use crate::types::ProfileMeta;

fn format_rusqlite_error(err: &rusqlite::Error) -> String {
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

fn classify_db_error(err: &rusqlite::Error) -> ErrorCodeString {
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

fn owned_data_from_bytes(mut bytes: Vec<u8>) -> Result<OwnedData> {
    if bytes.is_empty() {
        return Err(ErrorCodeString::new("EMPTY_SERIALIZED_DB"));
    }

    let mem = unsafe { ffi::sqlite3_malloc64(bytes.len() as u64) };
    if mem.is_null() {
        return Err(ErrorCodeString::new("SQLITE_OOM"));
    }

    let owned = unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), mem as *mut u8, bytes.len());
        OwnedData::from_raw_nonnull(NonNull::new_unchecked(mem as *mut u8), bytes.len())
    };

    bytes.zeroize();
    Ok(owned)
}

fn apply_in_memory_pragmas(conn: &rusqlite::Connection, profile_id: &str, ctx: &str) -> Result<()> {
    // Keep this minimal and non-invasive. Setting journal_mode can itself trigger SQLITE_CANTOPEN
    // if the deserialized image is marked as WAL and SQLite attempts to open sidecars.
    conn.execute_batch(
        "PRAGMA temp_store=MEMORY;
PRAGMA synchronous=OFF;
",
    )
    .map_err(|e| {
        log::error!(
            "[SECURITY][pragmas] profile_id={} ctx={} err={}",
            profile_id,
            ctx,
            format_rusqlite_error(&e)
        );
        classify_db_error(&e)
    })
}

fn best_effort_force_journal_mode_memory(conn: &rusqlite::Connection, profile_id: &str, ctx: &str) {
    // Best-effort: we do not fail the whole flow if this pragma fails.
    // The goal is to ensure serialized in-memory images are not WAL-marked.
    let res: rusqlite::Result<String> = conn.query_row("PRAGMA journal_mode=MEMORY;", [], |row| row.get(0));
    if let Err(e) = res {
        log::warn!(
            "[SECURITY][pragmas] profile_id={} ctx={} action=journal_mode_memory_failed err={}",
            profile_id,
            ctx,
            format_rusqlite_error(&e)
        );
    }
}

fn normalize_sqlite_header_disable_wal(bytes: &mut [u8], profile_id: &str, ctx: &str) {
    // SQLite header magic: "SQLite format 3\0"
    const MAGIC: &[u8; 16] = b"SQLite format 3\0";
    if bytes.len() < 20 {
        return;
    }
    if &bytes[..16] != MAGIC {
        return;
    }

    // As per SQLite documentation/notes: WAL mode persistence is reflected in the DB header bytes.
    // Values 2 at offsets 18/19 indicate WAL read/write versions. Setting them to 1 disables WAL
    // expectations and prevents attempts to open -wal/-shm for deserialized in-memory images.
    // (This is safe for our use-case because we always serialize a consistent image.)
    let mut changed = false;
    if bytes[18] == 2 {
        bytes[18] = 1;
        changed = true;
    }
    if bytes[19] == 2 {
        bytes[19] = 1;
        changed = true;
    }
    if changed {
        log::info!(
            "[SECURITY][sqlite_header] profile_id={} ctx={} action=disable_wal_header_bytes",
            profile_id,
            ctx
        );
    }
}

fn ensure_ciphertext_vault_on_disk(vault_path: &Path, profile_id: &str) -> Result<()> {
    const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
    if !vault_path.exists() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    // Detect legacy/plaintext vaults early. A plaintext SQLite DB starting with the SQLite magic
    // must never exist on disk under the "always encrypted" invariant.
    let magic = read_file_prefix(vault_path, SQLITE_MAGIC.len())
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if magic.as_slice() == SQLITE_MAGIC {
        log::error!(
            "[SECURITY][vault_at_rest] profile_id={} action=plaintext_detected path={:?}",
            profile_id,
            vault_path
        );
        return Err(ErrorCodeString::new("VAULT_PLAINTEXT_DETECTED"));
    }

    // Enforce our encrypted blob header ("PMENC1" + version).
    let header_len = cipher::PM_ENC_MAGIC.len() + 1;
    let header = read_file_prefix(vault_path, header_len)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if header.len() != header_len {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }
    if &header[..cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_MAGIC {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }
    if header[cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_VERSION {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    Ok(())
}

fn map_vault_decrypt_error(err: ErrorCodeString) -> ErrorCodeString {
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

fn open_vault_session_with_master_key(
    profile_id: &str,
    master: Zeroizing<[u8; 32]>,
    storage_paths: &crate::data::storage_paths::StoragePaths,
    state: &Arc<AppState>,
) -> Result<()> {
    let vault_path = vault_db_path(storage_paths, profile_id)?;
    ensure_ciphertext_vault_on_disk(&vault_path, profile_id)?;

    let encrypted = cipher::read_encrypted_file(&vault_path)?;
    let decrypted =
        cipher::decrypt_vault_blob(profile_id, &master, &encrypted).map_err(map_vault_decrypt_error)?;

    // If the stored DB image is marked WAL, SQLite may try to open -wal/-shm even for :memory:
    // deserialization and fail with SQLITE_CANTOPEN (14). Normalize header before deserialize.
    let mut decrypted = decrypted;
    normalize_sqlite_header_disable_wal(
        decrypted.as_mut_slice(),
        profile_id,
        "unlock_before_deserialize",
    );

    let mut conn = rusqlite::Connection::open_in_memory().map_err(|e| {
        log::error!(
            "[SECURITY][login] profile_id={} step=open_in_memory err={}",
            profile_id,
            format_rusqlite_error(&e)
        );
        ErrorCodeString::new("DB_OPEN_FAILED")
    })?;

    // Set pragmas BEFORE deserialize to avoid temp file writes during the first statements.
    apply_in_memory_pragmas(&conn, profile_id, "open_in_memory_before_deserialize")?;
    let owned = owned_data_from_bytes(decrypted)?;
    conn.deserialize(DatabaseName::Main, owned, false).map_err(|e| {
        log::error!(
            "[SECURITY][login] profile_id={} step=deserialize err={}",
            profile_id,
            format_rusqlite_error(&e)
        );
        ErrorCodeString::new("VAULT_CORRUPTED")
    })?;

    if let Err(e) = migrations::migrate_to_latest(&conn) {
        log::error!(
            "[SECURITY][login] profile_id={} step=migrate_to_latest failed code={}",
            profile_id,
            e.code
        );
        return Err(e);
    }
    migrations::validate_core_schema(&conn)
        .map_err(|_| ErrorCodeString::new("VAULT_CORRUPTED"))?;

    best_effort_force_journal_mode_memory(&conn, profile_id, "unlock_after_deserialize");

    {
        let mut session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_LOCK_POISONED"))?;

        *session = Some(VaultSession {
            profile_id: profile_id.to_string(),
            conn,
            key: master,
        });
    }

    Ok(())
}

fn open_vault_session(
    profile_id: &str,
    has_password: bool,
    password: Option<&str>,
    storage_paths: &crate::data::storage_paths::StoragePaths,
    state: &Arc<AppState>,
) -> Result<()> {
    let master = if has_password {
        let password = password
            .filter(|p| !p.is_empty())
            .ok_or_else(|| ErrorCodeString::new("PASSWORD_REQUIRED"))?;

        let salt_path = kdf_salt_path(storage_paths, profile_id)?;
        if !salt_path.exists() {
            return Err(ErrorCodeString::new("KDF_SALT_MISSING"));
        }
        let salt =
            std::fs::read(&salt_path).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;

        // Password is used ONLY to unwrap the master key (vault_key.bin). Vault data is always
        // encrypted with the master key.
        let wrapping_key = Zeroizing::new(kdf::derive_master_key(password, &salt)?);

        if !key_check::verify_key_check_file(storage_paths, profile_id, &wrapping_key)? {
            return Err(ErrorCodeString::new("INVALID_PASSWORD"));
        }

        Zeroizing::new(master_key::read_master_key_wrapped_with_password(
            storage_paths,
            profile_id,
            &wrapping_key,
        )?)
    } else {
        Zeroizing::new(master_key::read_master_key_passwordless_portable(
            storage_paths,
            profile_id,
        )?)
    };

    open_vault_session_with_master_key(profile_id, master, storage_paths, state)
}

fn is_dir_nonempty(dir: &Path) -> io::Result<bool> {
    if !dir.exists() {
        return Ok(false);
    }
    let mut it = std::fs::read_dir(dir)?;
    Ok(it.next().is_some())
}

fn read_file_prefix(path: &Path, len: usize) -> io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; len];
    let mut read = 0usize;
    while read < len {
        let n = f.read(&mut buf[read..])?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buf.truncate(read);
    Ok(buf)
}

fn file_has_prefix(path: &Path, prefix: &[u8]) -> bool {
    match read_file_prefix(path, prefix.len()) {
        Ok(buf) => buf.as_slice() == prefix,
        Err(_) => false,
    }
}

// Passwordless portable master key prefix.
const MASTER_KEY_PREFIX: &[u8] = b"PMMK1:";

// Crash-safe transaction folders for set/remove password.
// These transactions only rotate key material on disk.
const SET_PASSWORD_TX_DIR: &str = "set_password_tx";
const SET_PASSWORD_TX_COMMIT_MARKER: &str = "commit";

const REMOVE_PASSWORD_TX_DIR: &str = "remove_password_tx";
const REMOVE_PASSWORD_TX_COMMIT_MARKER: &str = "commit";

// Crash-safe transaction folder for password changes (only re-wraps the master key).
const CHANGE_PASSWORD_TX_DIR: &str = "change_password_tx";
const CHANGE_PASSWORD_TX_COMMIT_MARKER: &str = "commit";

fn rollback_set_password_tx(
    tx_root: &Path,
    vault_key_final: &Path,
    salt_final: &Path,
    key_check_final: &Path,
) -> io::Result<()> {
    let commit = tx_root.join(SET_PASSWORD_TX_COMMIT_MARKER);

    let vault_key_new = tx_root.join("vault_key.bin.new");
    let salt_new = tx_root.join("kdf_salt.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");

    // Remove commit marker to signal rollback
    let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));

    // Restore backups (overwrite if needed).
    if vault_key_bak.exists() {
        if vault_key_final.exists() {
            replace_file_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        }
    }

    if salt_bak.exists() {
        if salt_final.exists() {
            replace_file_retry(&salt_bak, salt_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&salt_bak, salt_final, 20, Duration::from_millis(50))?;
        }
    } else {
        let _ = remove_file_retry(salt_final, 20, Duration::from_millis(50));
    }

    if key_check_bak.exists() {
        if key_check_final.exists() {
            replace_file_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        }
    } else {
        let _ = remove_file_retry(key_check_final, 20, Duration::from_millis(50));
    }

    // Drop any staged new files.
    let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));
    let _ = remove_file_retry(&salt_new, 20, Duration::from_millis(50));
    let _ = remove_file_retry(&key_check_new, 20, Duration::from_millis(50));

    Ok(())
}

fn recover_set_password_tx(
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    profile_name: &str,
) -> Result<()> {
    let profile_root = profile_dir(storage_paths, profile_id)?;
    let tx_root = profile_root.join("tmp").join(SET_PASSWORD_TX_DIR);
    if !is_dir_nonempty(&tx_root).unwrap_or(false) {
        return Ok(());
    }

    let commit = tx_root.join(SET_PASSWORD_TX_COMMIT_MARKER);

    let vault_key_final = vault_key_path(storage_paths, profile_id)?;
    let salt_final = kdf_salt_path(storage_paths, profile_id)?;
    let key_check_final = key_check_path(storage_paths, profile_id)?;

    if commit.exists() {
        // Commit path: ensure final files exist; if any staged files remain, move them into place.
        let vault_key_new = tx_root.join("vault_key.bin.new");
        let salt_new = tx_root.join("kdf_salt.bin.new");
        let key_check_new = tx_root.join("key_check.bin.new");

        if vault_key_new.exists() {
            if vault_key_final.exists() {
                let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }
        if salt_new.exists() {
            if salt_final.exists() {
                let _ = remove_file_retry(&salt_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&salt_new, &salt_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }
        if key_check_new.exists() {
            if key_check_final.exists() {
                let _ = remove_file_retry(&key_check_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&key_check_new, &key_check_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        // Security: if the backup still contains an unwrapped master key, redact it by overwriting
        // with the new encrypted vault_key.bin (no password needed for this).
        let vault_key_bak = tx_root.join("vault_key.bin.bak");
        if vault_key_bak.exists() && file_has_prefix(&vault_key_bak, MASTER_KEY_PREFIX) {
            if let Ok(blob) = std::fs::read(&vault_key_final) {
                let _ = write_atomic(&vault_key_bak, &blob);
            }
        }

        // Best-effort cleanup of backups and tx dir.
        let _ = remove_file_retry(&tx_root.join("vault_key.bin.bak"), 20, Duration::from_millis(50));
        let _ = remove_file_retry(&tx_root.join("kdf_salt.bin.bak"), 20, Duration::from_millis(50));
        let _ = remove_file_retry(&tx_root.join("key_check.bin.bak"), 20, Duration::from_millis(50));
        let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));

        registry::upsert_profile_with_id(storage_paths, profile_id, profile_name, true)?;
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Ok(());
    }

    // Rollback path: restore backups so the profile remains passwordless.
    rollback_set_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    registry::upsert_profile_with_id(storage_paths, profile_id, profile_name, false)?;
    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    Ok(())
}

fn rollback_remove_password_tx(
    tx_root: &Path,
    vault_key_final: &Path,
    salt_final: &Path,
    key_check_final: &Path,
) -> io::Result<()> {
    let commit = tx_root.join(REMOVE_PASSWORD_TX_COMMIT_MARKER);

    let vault_key_new = tx_root.join("vault_key.bin.new");

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");

    // Remove commit marker to signal rollback
    let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));

    // Restore backups (overwrite if needed).
    if vault_key_bak.exists() {
        if vault_key_final.exists() {
            replace_file_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        }
    }

    if salt_bak.exists() {
        if salt_final.exists() {
            replace_file_retry(&salt_bak, salt_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&salt_bak, salt_final, 20, Duration::from_millis(50))?;
        }
    }

    if key_check_bak.exists() {
        if key_check_final.exists() {
            replace_file_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        }
    }

    // Drop any staged new file.
    let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));

    Ok(())
}

fn recover_remove_password_tx(
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    profile_name: &str,
) -> Result<()> {
    let profile_root = profile_dir(storage_paths, profile_id)?;
    let tx_root = profile_root.join("tmp").join(REMOVE_PASSWORD_TX_DIR);
    if !is_dir_nonempty(&tx_root).unwrap_or(false) {
        return Ok(());
    }

    let commit = tx_root.join(REMOVE_PASSWORD_TX_COMMIT_MARKER);

    let vault_key_final = vault_key_path(storage_paths, profile_id)?;
    let salt_final = kdf_salt_path(storage_paths, profile_id)?;
    let key_check_final = key_check_path(storage_paths, profile_id)?;

    if commit.exists() {
        // Commit path: ensure final vault_key exists; if any staged file remains, move it into place.
        let vault_key_new = tx_root.join("vault_key.bin.new");
        if vault_key_new.exists() {
            if vault_key_final.exists() {
                let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        // Ensure protected-only materials are removed from the profile root.
        let _ = remove_file_retry(&salt_final, 20, Duration::from_millis(50));
        let _ = remove_file_retry(&key_check_final, 20, Duration::from_millis(50));

        registry::upsert_profile_with_id(storage_paths, profile_id, profile_name, false)?;
        // Best-effort cleanup.
        let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Ok(());
    }

    // Rollback path: restore backups so the profile remains protected.
    rollback_remove_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    registry::upsert_profile_with_id(storage_paths, profile_id, profile_name, true)?;
    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    Ok(())
}


fn rollback_change_password_tx(
    tx_root: &Path,
    vault_key_final: &Path,
    key_check_final: &Path,
) -> io::Result<()> {
    let commit = tx_root.join(CHANGE_PASSWORD_TX_COMMIT_MARKER);
    let vault_key_new = tx_root.join("vault_key.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");
    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");

    // Remove commit marker to signal rollback
    let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));

    // Restore backups (overwrite if needed).
    if vault_key_bak.exists() {
        if vault_key_final.exists() {
            replace_file_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&vault_key_bak, vault_key_final, 20, Duration::from_millis(50))?;
        }
    }

    if key_check_bak.exists() {
        if key_check_final.exists() {
            replace_file_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        } else {
            rename_retry(&key_check_bak, key_check_final, 20, Duration::from_millis(50))?;
        }
    }

    // Drop any staged new files.
    let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));
    let _ = remove_file_retry(&key_check_new, 20, Duration::from_millis(50));

    Ok(())
}

fn recover_change_password_tx(
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    _profile_name: &str,
) -> Result<()> {
    let profile_root = profile_dir(storage_paths, profile_id)?;
    let tx_root = profile_root.join("tmp").join(CHANGE_PASSWORD_TX_DIR);
    if !is_dir_nonempty(&tx_root).unwrap_or(false) {
        return Ok(());
    }

    let commit = tx_root.join(CHANGE_PASSWORD_TX_COMMIT_MARKER);
    let vault_key_final = vault_key_path(storage_paths, profile_id)?;
    let key_check_final = key_check_path(storage_paths, profile_id)?;

    if commit.exists() {
        // Commit path: ensure final files exist; if any staged files remain, move them into place.
        let vault_key_new = tx_root.join("vault_key.bin.new");
        let key_check_new = tx_root.join("key_check.bin.new");

        if vault_key_new.exists() {
            if vault_key_final.exists() {
                let _ = remove_file_retry(&vault_key_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        if key_check_new.exists() {
            if key_check_final.exists() {
                let _ = remove_file_retry(&key_check_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(&key_check_new, &key_check_final, 20, Duration::from_millis(50))
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        // Best-effort cleanup of backups and tx dir.
        let _ = remove_file_retry(&tx_root.join("vault_key.bin.bak"), 20, Duration::from_millis(50));
        let _ = remove_file_retry(&tx_root.join("key_check.bin.bak"), 20, Duration::from_millis(50));
        let _ = remove_file_retry(&commit, 20, Duration::from_millis(50));
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Ok(());
    }

    // Rollback path: restore backups so the old password continues to work.
    if let Err(_e) = rollback_change_password_tx(&tx_root, &vault_key_final, &key_check_final) {
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }
    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    Ok(())
}
fn recover_incomplete_profile_transitions_with_password(
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    profile_name: &str,
) -> Result<()> {
    // Recover any pending crash-safe password-change transaction (master key re-wrap only).
    recover_change_password_tx(storage_paths, profile_id, profile_name)?;
    recover_set_password_tx(storage_paths, profile_id, profile_name)?;
    recover_remove_password_tx(storage_paths, profile_id, profile_name)?;

    Ok(())
}

fn best_effort_fsync_parent_dir(_path: &Path) {
    // Windows-only build: directory fsync not portable; keep hook as no-op.
    let _ = _path;
}

fn remove_dir_all_retry(path: &Path, attempts: u32, base_delay: Duration) -> io::Result<()> {
    let mut i = 0;
    loop {
        match std::fs::remove_dir_all(path) {
            Ok(()) => {
                best_effort_fsync_parent_dir(path);
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                i += 1;
                if i >= attempts {
                    return Err(e);
                }
                let backoff_ms = base_delay.as_millis() as u64 * i as u64;
                std::thread::sleep(Duration::from_millis(backoff_ms.max(25).min(1500)));
            }
        }
    }
}

fn best_effort_remove_dir_all_retry(path: &Path, attempts: u32, base_delay: Duration) {
    if let Err(e) = remove_dir_all_retry(path, attempts, base_delay) {
        log::warn!(
            "[SECURITY][best_effort_remove_dir_all_retry] path={:?} err={}",
            path,
            e
        );
    }
}

fn best_effort_fsync_rename_dirs(_from: &Path, _to: &Path) {
    let _ = (_from, _to);
}


fn rename_platform(from: &Path, to: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let from_w: Vec<u16> = from.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let to_w: Vec<u16> = to.as_os_str().encode_wide().chain(iter::once(0)).collect();

    let ok = unsafe { MoveFileExW(from_w.as_ptr(), to_w.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}


fn rename_retry(from: &Path, to: &Path, attempts: u32, base_delay: Duration) -> io::Result<()> {
    let mut i = 0;
    loop {
        match rename_platform(from, to) {
            Ok(()) => {
                best_effort_fsync_rename_dirs(from, to);
                return Ok(());
            }
            Err(e) => {
                i += 1;
                if i >= attempts {
                    return Err(e);
                }
                // Windows can temporarily lock files/dirs (AV/indexer), so retry with backoff.
                let backoff_ms = base_delay.as_millis() as u64 * i as u64;
                std::thread::sleep(Duration::from_millis(backoff_ms.max(25).min(1500)));
            }
        }
    }
}

fn remove_file_retry(path: &Path, attempts: u32, base_delay: Duration) -> io::Result<()> {
    let mut i = 0;
    loop {
        match std::fs::remove_file(path) {
            Ok(()) => {
                best_effort_fsync_parent_dir(path);
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                i += 1;
                if i >= attempts {
                    return Err(e);
                }
                let backoff_ms = base_delay.as_millis() as u64 * i as u64;
                std::thread::sleep(Duration::from_millis(backoff_ms.max(25).min(1500)));
            }
        }
    }
}

fn replace_platform(from: &Path, to: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_w: Vec<u16> = from.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let to_w: Vec<u16> = to.as_os_str().encode_wide().chain(iter::once(0)).collect();

    let ok = unsafe {
        MoveFileExW(
            from_w.as_ptr(),
            to_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}


fn replace_file_retry(from: &Path, to: &Path, attempts: u32, base_delay: Duration) -> io::Result<()> {
    let mut i = 0;
    loop {
        match replace_platform(from, to) {
            Ok(()) => {
                best_effort_fsync_rename_dirs(from, to);
                return Ok(());
            }
            Err(e) => {
                i += 1;
                if i >= attempts {
                    return Err(e);
                }
                // Windows can temporarily lock files (AV/indexer), so retry with backoff.
                let backoff_ms = base_delay.as_millis() as u64 * i as u64;
                std::thread::sleep(Duration::from_millis(backoff_ms.max(25).min(1500)));
            }
        }
    }
}

fn prepare_empty_dir(path: &Path) -> Result<()> {
    if path.exists() {
        remove_dir_all_retry(path, 40, Duration::from_millis(50))
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    }
    std::fs::create_dir_all(path)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    Ok(())
}

pub fn login_vault(id: &str, password: Option<&str>, state: &Arc<AppState>) -> Result<bool> {
    // No-op if the vault is already unlocked for this profile.
    // In dev builds the UI can accidentally invoke login multiple times (e.g. React StrictMode).
    {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_LOCK_POISONED"))?;

        if let Some(session) = session_guard.as_ref() {
            if session.profile_id == id {
                log::debug!("[SECURITY][login] no-op already_unlocked profile_id={}", id);
                if let Ok(mut active) = state.active_profile.lock() {
                    *active = Some(id.to_string());
                }
                return Ok(true);
            }
        }
    }

    let storage_paths = state.get_storage_paths()?;
    let mut profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    // Recover any pending profile transitions (password changes) and incomplete restore (if any) before opening
    recover_incomplete_profile_transitions_with_password(&storage_paths, id, &profile.name)?;
    {
        use std::fs;
        use crate::data::profiles::paths::{profile_dir, vault_db_path};
        let profile_root = profile_dir(&storage_paths, id)?;
        let vault_path = vault_db_path(&storage_paths, id)?;
        if !vault_path.exists() {
            for entry in fs::read_dir(&profile_root).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))? {
                let path = entry.map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("vault.db.old.") {
                        fs::rename(&path, &vault_path)
                            .map_err(|_| ErrorCodeString::new("RESTORE_ROLLBACK_FAILED"))?;
                        break;
                    }
                }
            }
        }
        let attachments_path = profile_root.join("attachments");
        if !attachments_path.exists() {
            let mut restored = false;
            for entry in fs::read_dir(&profile_root)
                .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?
            {
                let p = entry
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?
                    .path();
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("attachments.old.") {
                        fs::rename(&p, &attachments_path)
                            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
                        restored = true;
                        break;
                    }
                }
            }

            if !restored && !attachments_path.exists() {
                fs::create_dir_all(&attachments_path)
                    .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }
    }
    profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if profile.has_password && password.filter(|p| !p.is_empty()).is_none() {
        return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
    }

    open_vault_session(id, profile.has_password, password, &storage_paths, state)?;

    if let Ok(mut active) = state.active_profile.lock() {
        *active = Some(id.to_string());
    }
    let active_vault_id =
        settings_service::resolve_active_vault_id(&storage_paths, id).unwrap_or_else(|_| {
            settings_service::DEFAULT_VAULT_ID.to_string()
        });
    if let Ok(mut active) = state.active_vault_id.lock() {
        *active = Some(active_vault_id);
    }
    Ok(true)
}

pub fn persist_active_vault(state: &Arc<AppState>) -> Result<Option<String>> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let maybe_bytes_and_meta = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        if let Some(session) = session_guard.as_ref() {
            let serialized = session
                .conn
                .serialize(DatabaseName::Main)
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

            let bytes = Zeroizing::new(serialized.to_vec());

            let profile_id = session.profile_id.clone();
            let key_material = Zeroizing::new(*session.key);

            Some((profile_id, key_material, bytes))
        } else {
            None
        }
    };

    if let Some((profile_id, key_material, bytes)) = maybe_bytes_and_meta {
        let storage_paths = state.get_storage_paths()?;
        let encrypted = cipher::encrypt_vault_blob(&profile_id, &*key_material, bytes.as_slice())?;
        cipher::write_encrypted_file(&vault_db_path(&storage_paths, &profile_id)?, &encrypted)?;
        return Ok(Some(profile_id));
    }

    Ok(None)
}

pub fn request_persist_active_vault(state: Arc<AppState>) {
    state.vault_persist_requested.store(true, Ordering::SeqCst);

    if state.vault_persist_in_flight.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        loop {
            state.vault_persist_requested.store(false, Ordering::SeqCst);

            if let Err(error) = persist_active_vault(&state) {
                log::error!("[SECURITY][persist_active_vault] failed: {error:?}");
            }

            if !state.vault_persist_requested.load(Ordering::SeqCst) {
                break;
            }
        }

        state.vault_persist_in_flight.store(false, Ordering::SeqCst);

        if state.vault_persist_requested.load(Ordering::SeqCst) {
            request_persist_active_vault(state);
        }
    });
}

pub fn lock_vault(state: &Arc<AppState>) -> Result<bool> {
    let persisted_id = persist_active_vault(state)?;

    let active_id = {
        let active = state
            .active_profile
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
            .clone();
        active
    };

    let cleanup_id = persisted_id.clone().or(active_id.clone());

    if let Some(id) = cleanup_id.as_ref() {
        attachments_service::clear_previews_for_profile(state, id)?;
    }

    {
        let mut session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        *session = None;
    }

	{
		let mut active = state
			.active_profile
			.lock()
			.map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
		*active = None;
	}
    {
        let mut active_vault_id = state
            .active_vault_id
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        *active_vault_id = None;
    }

	Ok(true)
}

pub fn set_profile_password(id: &str, password: &str, state: &Arc<AppState>) -> Result<ProfileMeta> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let storage_paths = state.get_storage_paths()?;
    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_ALREADY_PROTECTED"));
    }

    // Must be unlocked to set a password: we need the current master key.
    let master: Zeroizing<[u8; cipher::KEY_LEN]> = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        let session = session_guard
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

        if session.profile_id != id {
            return Err(ErrorCodeString::new("WRONG_PROFILE_ACTIVE"));
        }
        Zeroizing::new(*session.key)
    };

    ensure_profile_dirs(&storage_paths, id, true)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    // If there is a leftover transaction from a previous crash, recover it first.
    recover_set_password_tx(&storage_paths, id, &profile.name)?;
    recover_remove_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(SET_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    // Build new key material (salt + wrapping key + key_check + wrapped vault_key).
    let mut salt = [0u8; 16];
    let mut rng = OsRng;
    rng.fill_bytes(&mut salt);

    let wrapping_key = Zeroizing::new(
        kdf::derive_master_key(password, &salt).map_err(|_| ErrorCodeString::new("KDF_FAILED"))?,
    );

    let key_check_blob = key_check::create_key_check_blob(id, &*wrapping_key)?;
    let vault_key_blob =
        master_key::wrap_master_key_with_password_blob(id, &*wrapping_key, &*master)?;

    // Stage new files into tx dir first.
    let vault_key_new = tx_root.join("vault_key.bin.new");
    let salt_new = tx_root.join("kdf_salt.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");

    write_atomic(&vault_key_new, &vault_key_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&salt_new, &salt)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&key_check_new, &key_check_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let salt_final = kdf_salt_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");
    let commit = tx_root.join(SET_PASSWORD_TX_COMMIT_MARKER);

    let tx_result = (|| -> io::Result<()> {
        // Backup existing key file (it contains the unwrapped master key, so keep it only in tx dir).
        if !vault_key_final.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "vault_key.bin missing",
            ));
        }
        if vault_key_bak.exists() {
            remove_file_retry(&vault_key_bak, 20, Duration::from_millis(50))?;
        }
        rename_retry(&vault_key_final, &vault_key_bak, 20, Duration::from_millis(50))?;

        // Backup existing protected-only files if they exist (stale leftovers).
        if salt_final.exists() {
            if salt_bak.exists() {
                remove_file_retry(&salt_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&salt_final, &salt_bak, 20, Duration::from_millis(50))?;
        }
        if key_check_final.exists() {
            if key_check_bak.exists() {
                remove_file_retry(&key_check_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&key_check_final, &key_check_bak, 20, Duration::from_millis(50))?;
        }

        // Move staged files into place.
        rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))?;
        rename_retry(&salt_new, &salt_final, 20, Duration::from_millis(50))?;
        rename_retry(&key_check_new, &key_check_final, 20, Duration::from_millis(50))?;

        // Commit marker is written last to make crash recovery deterministic.
        write_atomic(&commit, b"1")?;
        Ok(())
    })();

    if let Err(e) = tx_result {
        log::warn!(
            "[SECURITY][set_profile_password] profile_id={} action=tx_failed err={}",
            id,
            e
        );
        let _ = rollback_set_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final);
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let updated = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, true)?;

    // Best-effort cleanup: if deletion fails, at least remove the plaintext backup by overwriting it
    // with the encrypted vault_key.bin.
    if let Err(e) = remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50)) {
        log::warn!(
            "[SECURITY][set_profile_password] profile_id={} action=cleanup_failed tx_root={:?} err={}",
            id,
            tx_root,
            e
        );
        let vault_key_bak = tx_root.join("vault_key.bin.bak");
        if vault_key_bak.exists() && file_has_prefix(&vault_key_bak, MASTER_KEY_PREFIX) {
            if let Ok(blob) = std::fs::read(&vault_key_final) {
                let _ = write_atomic(&vault_key_bak, &blob);
            }
        }
        let _ = remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    }

    Ok(updated.into())
}

pub fn change_profile_password(id: &str, password: &str, state: &Arc<AppState>) -> Result<bool> {
    let storage_paths = state.get_storage_paths()?;

    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if !profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_NOT_PROTECTED"));
    }

    if password.chars().all(|c| c.is_whitespace()) {
        return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
    }

    // Prevent concurrent persists while we rotate key material.
    // persist_active_vault takes this guard before reading vault_session.
    let _persist_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    // Must be unlocked (session exists and matches profile) because we do NOT re-encrypt vault.db;
    // we only re-wrap the existing master key.
    let master = {
        let session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        let s = session.as_ref().ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;
        if s.profile_id != id {
            return Err(ErrorCodeString::new("VAULT_LOCKED"));
        }
        Zeroizing::new(*s.key)
    };

    // Keep the existing salt to avoid multi-file atomicity problems.
    let salt_path = kdf_salt_path(&storage_paths, id)?;
    let salt = std::fs::read(&salt_path)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if salt.is_empty() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    let wrapping_key = Zeroizing::new(kdf::derive_master_key(password, &salt)?);
    // Crash-safety: update vault_key.bin and key_check.bin as a single transaction.
    // If the app crashes mid-flight, we rollback to the old password on next launch.
    recover_change_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(CHANGE_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    if !vault_key_final.exists() || !key_check_final.exists() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    let vault_key_new = tx_root.join("vault_key.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");
    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");

    let vault_key_blob = master_key::wrap_master_key_with_password_blob(id, &*wrapping_key, &*master)?;
    let key_check_blob = key_check::create_key_check_blob(id, &*wrapping_key)?;

    write_atomic(&vault_key_new, &vault_key_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&key_check_new, &key_check_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let tx_result: Result<()> = (|| {
        // 1) Move the old files into tx_root as backups
        rename_retry(&vault_key_final, &vault_key_bak, 20, Duration::from_millis(50))
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        rename_retry(&key_check_final, &key_check_bak, 20, Duration::from_millis(50))
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

        // 2) Move the new files into place
        rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        rename_retry(&key_check_new, &key_check_final, 20, Duration::from_millis(50))
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

        // 3) Mark commit (best-effort cleanup will remove tx_root later)
        write_atomic(&tx_root.join(CHANGE_PASSWORD_TX_COMMIT_MARKER), b"1")
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        Ok(())
    })();

    if tx_result.is_err() {
        // Best-effort rollback: keep the profile unlockable with the old password.
        let _ = rollback_change_password_tx(&tx_root, &vault_key_final, &key_check_final);
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    // Best-effort cleanup.
    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));

    let _ = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, true)?;
    Ok(true)
}

pub fn remove_profile_password(id: &str, state: &Arc<AppState>) -> Result<ProfileMeta> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let storage_paths = state.get_storage_paths()?;
    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if !profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_ALREADY_PASSWORDLESS"));
    }

    // Must be unlocked to remove a password: we need the current master key.
    let master: Zeroizing<[u8; cipher::KEY_LEN]> = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        let session = session_guard
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

        if session.profile_id != id {
            return Err(ErrorCodeString::new("WRONG_PROFILE_ACTIVE"));
        }
        Zeroizing::new(*session.key)
    };

    ensure_profile_dirs(&storage_paths, id, true)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    // If there is a leftover transaction from a previous crash, recover it first.
    recover_change_password_tx(&storage_paths, id, &profile.name)?;
    recover_set_password_tx(&storage_paths, id, &profile.name)?;
    recover_remove_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(REMOVE_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let salt_final = kdf_salt_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    // Stage the new unwrapped vault_key.bin into tx dir first.
    let vault_key_new = tx_root.join("vault_key.bin.new");
    let master_arr: [u8; master_key::MASTER_KEY_LEN] = *master;
    let plain_blob = master_key::unwrapped_master_key_blob(id, &master_arr);
    write_atomic(&vault_key_new, plain_blob.as_slice())
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");
    let commit = tx_root.join(REMOVE_PASSWORD_TX_COMMIT_MARKER);

    let tx_result = (|| -> io::Result<()> {
        // Backup old protected materials into tx dir.
        if vault_key_final.exists() {
            if vault_key_bak.exists() {
                remove_file_retry(&vault_key_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&vault_key_final, &vault_key_bak, 20, Duration::from_millis(50))?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "vault_key.bin missing",
            ));
        }

        if salt_final.exists() {
            if salt_bak.exists() {
                remove_file_retry(&salt_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&salt_final, &salt_bak, 20, Duration::from_millis(50))?;
        }

        if key_check_final.exists() {
            if key_check_bak.exists() {
                remove_file_retry(&key_check_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&key_check_final, &key_check_bak, 20, Duration::from_millis(50))?;
        }

        // Move staged new vault_key.bin into place.
        rename_retry(&vault_key_new, &vault_key_final, 20, Duration::from_millis(50))?;

        // Commit marker is written last to make crash recovery deterministic.
        write_atomic(&commit, b"1")?;
        Ok(())
    })();

    if let Err(e) = tx_result {
        log::warn!(
            "[SECURITY][remove_profile_password] profile_id={} action=tx_failed err={}",
            id,
            e
        );
        let _ = rollback_remove_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final);
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let updated = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, false)?;

    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    Ok(updated.into())
}

pub fn is_logged_in(state: &Arc<AppState>) -> Result<bool> {
    let active_id = state
        .active_profile
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
        .clone();

    let Some(id) = active_id else {
        return Ok(false);
    };

    let session = state
        .vault_session
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    Ok(session
        .as_ref()
        .map(|s| s.profile_id == id)
        .unwrap_or(false))
}

pub struct ActiveSessionInfo {
    pub profile_id: String,
    pub vault_key: [u8; 32],
}

pub fn require_unlocked_active_profile(state: &Arc<AppState>) -> Result<ActiveSessionInfo> {
    let active_id = state
        .active_profile
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
        .clone()
        .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

    let session = state
        .vault_session
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    if let Some(s) = session.as_ref() {
        if s.profile_id == active_id {
            return Ok(ActiveSessionInfo {
                profile_id: active_id,
                vault_key: *s.key,
            });
        }
    }

    Err(ErrorCodeString::new("VAULT_LOCKED"))
}

pub fn auto_lock_cleanup(state: &Arc<AppState>) -> Result<bool> {
    if let Some(id) = persist_active_vault(state)? {
        attachments_service::clear_previews_for_profile(state, &id)?;
    }
    is_logged_in(state)
}

pub fn health_check() -> Result<bool> {
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_plaintext_sqlite_vault_on_disk() {
        const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

        let dir = tempfile::tempdir().unwrap();
        let vault_path = dir.path().join("vault.db");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(SQLITE_MAGIC);
        bytes.extend_from_slice(&[0u8; 64]);
        std::fs::write(&vault_path, bytes).unwrap();

        let err = ensure_ciphertext_vault_on_disk(&vault_path, "p1").unwrap_err();
        assert_eq!(err.code, "VAULT_PLAINTEXT_DETECTED");
    }

    #[test]
    fn accepts_encrypted_blob_header_for_vault_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let vault_path = dir.path().join("vault.db");

        let mut bytes = Vec::new();
        bytes.extend_from_slice(&cipher::PM_ENC_MAGIC);
        bytes.push(cipher::PM_ENC_VERSION);
        bytes.extend_from_slice(&[0u8; 64]);
        std::fs::write(&vault_path, bytes).unwrap();

        ensure_ciphertext_vault_on_disk(&vault_path, "p1").unwrap();
    }
}
