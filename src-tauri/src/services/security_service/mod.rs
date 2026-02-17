use std::io::{self, Read};
use std::path::Path;
use std::ptr::NonNull;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::ffi;
use rusqlite::serialize::OwnedData;
use rusqlite::DatabaseName;
use zeroize::{Zeroize, Zeroizing};

use crate::app_state::{AppState, VaultSession};
use crate::data::crypto::{cipher, kdf, key_check, master_key};
use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::{
    ensure_profile_dirs, kdf_salt_path, key_check_path, profile_dir, vault_db_path, vault_key_path,
};
use crate::data::profiles::registry;
use crate::data::sqlite::schema_migration;
use crate::data::sqlite::schema_validation;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachments_service;
use crate::services::settings_service;
use crate::types::ProfileMeta;

mod auto_lock;
mod errors;
mod password;
mod persist;
mod session;
mod sqlite_image;

pub use auto_lock::*;
pub use password::*;
pub use persist::*;
pub use session::*;

use errors::{classify_db_error, format_rusqlite_error, map_vault_decrypt_error};
use sqlite_image::{
    apply_in_memory_pragmas, best_effort_force_journal_mode_memory, ensure_ciphertext_vault_on_disk,
    normalize_sqlite_header_disable_wal, owned_data_from_bytes,
};

fn open_vault_session_with_master_key(
    profile_id: &str,
    master: Zeroizing<[u8; 32]>,
    storage_paths: &crate::data::storage_paths::StoragePaths,
    state: &Arc<AppState>,
) -> Result<()> {
    let vault_path = vault_db_path(storage_paths, profile_id)?;
    ensure_ciphertext_vault_on_disk(&vault_path, profile_id)?;

    let encrypted = cipher::read_encrypted_file(&vault_path)?;
    let decrypted = cipher::decrypt_vault_blob(profile_id, &master, &encrypted)
        .map_err(map_vault_decrypt_error)?;

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
    conn.deserialize(DatabaseName::Main, owned, false)
        .map_err(|e| {
            log::error!(
                "[SECURITY][login] profile_id={} step=deserialize err={}",
                profile_id,
                format_rusqlite_error(&e)
            );
            ErrorCodeString::new("VAULT_CORRUPTED")
        })?;

    if let Err(e) = schema_migration::schema_migrate(&conn) {
        log::error!(
            "[SECURITY][login] profile_id={} step=schema_migrate failed code={}",
            profile_id,
            e.code
        );
        return Err(e);
    }
    schema_validation::schema_validate(&conn).map_err(|_| ErrorCodeString::new("VAULT_CORRUPTED"))?;

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
            replace_file_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
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
            replace_file_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
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
                rename_retry(
                    &vault_key_new,
                    &vault_key_final,
                    20,
                    Duration::from_millis(50),
                )
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
                rename_retry(
                    &key_check_new,
                    &key_check_final,
                    20,
                    Duration::from_millis(50),
                )
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
        let _ = remove_file_retry(
            &tx_root.join("vault_key.bin.bak"),
            20,
            Duration::from_millis(50),
        );
        let _ = remove_file_retry(
            &tx_root.join("kdf_salt.bin.bak"),
            20,
            Duration::from_millis(50),
        );
        let _ = remove_file_retry(
            &tx_root.join("key_check.bin.bak"),
            20,
            Duration::from_millis(50),
        );
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
            replace_file_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
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
            replace_file_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
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
                rename_retry(
                    &vault_key_new,
                    &vault_key_final,
                    20,
                    Duration::from_millis(50),
                )
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
            replace_file_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &vault_key_bak,
                vault_key_final,
                20,
                Duration::from_millis(50),
            )?;
        }
    }

    if key_check_bak.exists() {
        if key_check_final.exists() {
            replace_file_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            rename_retry(
                &key_check_bak,
                key_check_final,
                20,
                Duration::from_millis(50),
            )?;
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
                rename_retry(
                    &vault_key_new,
                    &vault_key_final,
                    20,
                    Duration::from_millis(50),
                )
                .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        if key_check_new.exists() {
            if key_check_final.exists() {
                let _ = remove_file_retry(&key_check_new, 20, Duration::from_millis(50));
            } else {
                rename_retry(
                    &key_check_new,
                    &key_check_final,
                    20,
                    Duration::from_millis(50),
                )
                .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            }
        }

        // Best-effort cleanup of backups and tx dir.
        let _ = remove_file_retry(
            &tx_root.join("vault_key.bin.bak"),
            20,
            Duration::from_millis(50),
        );
        let _ = remove_file_retry(
            &tx_root.join("key_check.bin.bak"),
            20,
            Duration::from_millis(50),
        );
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

    let from_w: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
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

    let from_w: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
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

fn replace_file_retry(
    from: &Path,
    to: &Path,
    attempts: u32,
    base_delay: Duration,
) -> io::Result<()> {
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
    std::fs::create_dir_all(path).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    Ok(())
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
