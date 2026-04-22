use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::app_state::AppState;
use crate::data::crypto::cipher;

// Restore hard limits (anti zip-bomb / decompression bomb DoS)
const MAX_RESTORE_FILES: usize = 4096;
const MAX_RESTORE_ENTRY_BYTES: i64 = 64 * 1024 * 1024;
const MAX_RESTORE_TOTAL_BYTES: i64 = 512 * 1024 * 1024;

use crate::data::fs::atomic_write::write_atomic;
use crate::data::fs::output_guard::ensure_output_path_allowed;
use crate::data::profiles::paths::{
    backup_registry_path, backups_dir, ensure_profile_dirs, kdf_salt_path, key_check_path,
    profile_config_path, profile_dir, user_settings_path, vault_db_path, vault_key_path,
};
use crate::data::profiles::registry;
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};
use crate::services::{security_service, settings_service};
use crate::types::UserSettings;

mod auto;
#[path = "fs.rs"]
mod backup_fs;
mod export;
mod format;
mod import;
mod inspect;

pub use auto::*;
pub use export::*;
pub use format::{BackupInspectResult, BackupListItem};
pub use import::*;
pub use inspect::*;

use backup_fs::{
    map_restore_io_error, prepare_empty_dir_for_restore, remove_dir_all_if_exists,
    remove_file_if_exists, rename_with_retry, replace_file_windows,
};
use format::{
    load_registry, now_timestamp, now_utc_string, read_backup_manifest_and_name, save_registry,
    update_registry, BackupManifest, BackupManifestFile, BackupRegistry, BackupResult,
    BackupSource,
};

fn validate_zip_entry_rel_path_windows(rel: &Path) -> bool {
    if rel.is_absolute() {
        return false;
    }

    for component in rel.components() {
        match component {
            Component::Prefix(_) => return false,
            Component::RootDir => return false,
            Component::ParentDir => return false,
            Component::CurDir => {}
            Component::Normal(_) => {}
        }
    }

    true
}

fn validate_profile_id_component(profile_id: &str) -> bool {
    let p = Path::new(profile_id);
    let mut components = p.components();

    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

// Backup restore safety: we refuse to write any file that looks like plaintext vault data.
// Under the "always encrypted at-rest" invariant, a plaintext SQLite header must never
// appear on disk during restore.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

// Passwordless vault_key.bin prefix (master key stored in a self-describing, unwrapped format).
const PASSWORDLESS_MASTER_KEY_PREFIX: &[u8; 6] = b"PMMK1:";

const RESTORE_STAGING_DIR: &str = "restore_staging";
const RESTORE_TX_DIR: &str = "restore_tx";
const RESTORE_TX_MANIFEST_FILE: &str = "manifest.json";
const RESTORE_TX_COMMIT_MARKER: &str = "commit";
const RESTORE_TX_ORIGINALS_DIR: &str = "originals";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RestoreTxManifest {
    version: u8,
    profile_id: String,
    profile_name: String,
    has_password: bool,
    entries: Vec<RestoreTxEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RestoreTxEntry {
    kind: RestoreTxKind,
    target_rel: String,
    backup_rel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
enum RestoreTxKind {
    FileReplace,
    FileRemove,
    DirectoryReplace,
    DirectoryCreate,
}

#[derive(Debug, Clone)]
enum RestoreApplySource {
    File(PathBuf),
    Directory(PathBuf),
    None,
}

#[derive(Debug, Clone)]
struct RestoreApplyAction {
    entry: RestoreTxEntry,
    source: RestoreApplySource,
}

#[cfg(test)]
fn restore_apply_failpoint_cell() -> &'static std::sync::Mutex<Option<usize>> {
    static CELL: std::sync::OnceLock<std::sync::Mutex<Option<usize>>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(test)]
fn restore_apply_failpoint_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
fn set_restore_apply_failpoint(trigger_after: usize) {
    *restore_apply_failpoint_cell().lock().unwrap() = Some(trigger_after);
}

#[cfg(test)]
fn clear_restore_apply_failpoint() {
    *restore_apply_failpoint_cell().lock().unwrap() = None;
}

#[cfg(test)]
fn maybe_trigger_restore_failpoint(applied_count: usize) -> Result<()> {
    let trigger_after = *restore_apply_failpoint_cell().lock().unwrap();
    if trigger_after.is_some_and(|n| applied_count >= n) {
        return Err(ErrorCodeString::new("BACKUP_RESTORE_TEST_FAILPOINT"));
    }
    Ok(())
}

#[cfg(not(test))]
fn maybe_trigger_restore_failpoint(_applied_count: usize) -> Result<()> {
    Ok(())
}

fn expected_restore_header_len(manifest: &BackupManifest, entry_path: &str) -> usize {
    let enc_header_len = cipher::PM_ENC_MAGIC.len() + 1;

    match entry_path {
        "vault.db" => SQLITE_MAGIC.len().max(enc_header_len),
        "key_check.bin" => enc_header_len,
        "vault_key.bin" => {
            if manifest.vault_mode == "protected" {
                enc_header_len
            } else if manifest.vault_mode == "passwordless" {
                PASSWORDLESS_MASTER_KEY_PREFIX.len() + manifest.profile_id.as_bytes().len() + 1
            } else {
                enc_header_len
            }
        }
        _ => {
            if entry_path.starts_with("attachments/") {
                enc_header_len
            } else {
                0
            }
        }
    }
}

fn validate_encrypted_blob_header(entry_path: &str, header: &[u8]) -> Result<()> {
    let enc_header_len = cipher::PM_ENC_MAGIC.len() + 1;
    if header.len() < enc_header_len {
        log::error!(
            "[BACKUP][restore] invalid_blob_header path={} reason=too_short len={}",
            entry_path,
            header.len()
        );
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }

    if &header[..cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_MAGIC {
        log::error!(
            "[BACKUP][restore] insecure_entry path={} reason=missing_magic",
            entry_path
        );
        return Err(ErrorCodeString::new("BACKUP_PLAINTEXT_REJECTED"));
    }
    if header[cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_VERSION {
        log::error!(
            "[BACKUP][restore] invalid_blob_header path={} reason=unsupported_version v={}",
            entry_path,
            header[cipher::PM_ENC_MAGIC.len()]
        );
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }

    Ok(())
}

fn validate_backup_entry_header(
    manifest: &BackupManifest,
    entry_path: &str,
    header: &[u8],
) -> Result<()> {
    if entry_path == "vault.db" {
        if header.len() >= SQLITE_MAGIC.len() && &header[..SQLITE_MAGIC.len()] == SQLITE_MAGIC {
            log::error!(
                "[BACKUP][restore] insecure_entry path={} reason=sqlite_plaintext",
                entry_path
            );
            return Err(ErrorCodeString::new("BACKUP_PLAINTEXT_REJECTED"));
        }
        return validate_encrypted_blob_header(entry_path, header);
    }

    if entry_path.starts_with("attachments/") || entry_path == "key_check.bin" {
        return validate_encrypted_blob_header(entry_path, header);
    }

    if entry_path == "vault_key.bin" {
        if manifest.vault_mode == "protected" {
            return validate_encrypted_blob_header(entry_path, header);
        }
        if manifest.vault_mode == "passwordless" {
            let expected_len =
                PASSWORDLESS_MASTER_KEY_PREFIX.len() + manifest.profile_id.as_bytes().len() + 1;
            if header.len() < expected_len {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
            }
            if &header[..PASSWORDLESS_MASTER_KEY_PREFIX.len()] != PASSWORDLESS_MASTER_KEY_PREFIX {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
            }
            let pid = manifest.profile_id.as_bytes();
            let start = PASSWORDLESS_MASTER_KEY_PREFIX.len();
            let end = start + pid.len();
            if &header[start..end] != pid {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
            }
            if header[end] != 0 {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
            }
            return Ok(());
        }
        return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
    }

    Ok(())
}

fn ensure_backup_guard(state: &Arc<AppState>) -> Result<std::sync::MutexGuard<'_, ()>> {
    state
        .backup_guard
        .try_lock()
        .map_err(|_| ErrorCodeString::new("BACKUP_ALREADY_RUNNING"))
}

fn require_unlocked_active_profile_id(state: &Arc<AppState>) -> Result<String> {
    Ok(security_service::require_unlocked_active_profile(state)?.profile_id)
}

fn add_file_to_zip(
    writer: &mut ZipWriter<fs::File>,
    source_path: &Path,
    archive_path: &str,
    manifest_entries: &mut Vec<BackupManifestFile>,
) -> Result<()> {
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    writer
        .start_file(archive_path, options)
        .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;
    let file =
        fs::File::open(source_path).map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?;
    let mut reader = BufReader::new(file);
    let mut buffer = [0u8; 64 * 1024];
    let mut hasher = Sha256::new();
    let mut bytes_written = 0i64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;
        hasher.update(&buffer[..read]);
        bytes_written += read as i64;
    }
    let sha256 = hex::encode(hasher.finalize());
    manifest_entries.push(BackupManifestFile {
        path: archive_path.to_string(),
        sha256,
        bytes: bytes_written,
    });
    Ok(())
}

fn add_optional_file(
    writer: &mut ZipWriter<fs::File>,
    path: Option<PathBuf>,
    archive_path: &str,
    manifest_entries: &mut Vec<BackupManifestFile>,
) -> Result<()> {
    if let Some(path) = path {
        if path.exists() {
            add_file_to_zip(writer, &path, archive_path, manifest_entries)?;
        }
    }
    Ok(())
}

fn build_backup_source(
    state: &Arc<AppState>,
    sp: &StoragePaths,
    profile_id: &str,
) -> Result<(BackupSource, String, String)> {
    let profile = registry::get_profile(sp, profile_id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;
    let profile_name = profile.name.clone();

    // Vault is always in-memory when unlocked; persist before backup for both modes.
    security_service::persist_active_vault(state)?;

    let vault_mode = if profile.has_password {
        "protected".to_string()
    } else {
        "passwordless".to_string()
    };

    let profile_root = profile_dir(sp, profile_id)?;
    let attachments_path = profile_root.join("attachments");
    let config_path = profile_config_path(sp, profile_id).ok();
    let settings_path = user_settings_path(sp, profile_id).ok();

    let (salt_path, key_check) = if profile.has_password {
        let salt = kdf_salt_path(sp, profile_id)?;
        if !salt.exists() {
            return Err(ErrorCodeString::new("KDF_SALT_MISSING"));
        }
        let key_check = key_check_path(sp, profile_id)?;
        if !key_check.exists() {
            return Err(ErrorCodeString::new("KEY_CHECK_MISSING"));
        }
        (Some(salt), Some(key_check))
    } else {
        (None, None)
    };

    let vault_key = {
        let p = vault_key_path(sp, profile_id)?;
        if !p.exists() {
            return Err(ErrorCodeString::new("VAULT_KEY_MISSING"));
        }
        Some(p)
    };

    let vault_path = vault_db_path(sp, profile_id)?;

    Ok((
        BackupSource {
            vault_path,
            attachments_path,
            config_path,
            settings_path,
            kdf_salt_path: salt_path,
            key_check_path: key_check,
            vault_key_path: vault_key,
            _temp_dir: None,
        },
        vault_mode,
        profile_name,
    ))
}

fn create_archive(
    destination: &Path,
    source: BackupSource,
    profile_id: &str,
    profile_name: &str,
    vault_mode: &str,
    created_at_utc: &str,
) -> Result<i64> {
    let tmp_dest = PathBuf::from(format!("{}.tmp", destination.display()));
    let file = fs::File::create(&tmp_dest)
        .map_err(|_| ErrorCodeString::new("BACKUP_DESTINATION_UNAVAILABLE"))?;
    let mut writer = ZipWriter::new(file);
    let mut manifest_entries = Vec::new();

    add_file_to_zip(
        &mut writer,
        &source.vault_path,
        "vault.db",
        &mut manifest_entries,
    )?;

    if source.attachments_path.exists() {
        for entry_res in WalkDir::new(&source.attachments_path).into_iter() {
            let entry =
                entry_res.map_err(|_| ErrorCodeString::new("BACKUP_ATTACHMENTS_ENUM_FAILED"))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&source.attachments_path)
                .map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?;
            let relative_str = relative.to_string_lossy().replace('\\', "/");
            let archive_path = format!("attachments/{relative_str}");
            add_file_to_zip(
                &mut writer,
                entry.path(),
                &archive_path,
                &mut manifest_entries,
            )?;
        }
    }

    add_optional_file(
        &mut writer,
        source.config_path,
        "config.json",
        &mut manifest_entries,
    )?;
    add_optional_file(
        &mut writer,
        source.settings_path,
        "user_settings.json",
        &mut manifest_entries,
    )?;
    if vault_mode == "protected" {
        let vault_key_path = source
            .vault_key_path
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_KEY_MISSING"))?;
        if !vault_key_path.exists() {
            return Err(ErrorCodeString::new("VAULT_KEY_MISSING"));
        }
        add_file_to_zip(
            &mut writer,
            vault_key_path,
            "vault_key.bin",
            &mut manifest_entries,
        )?;

        let salt_path = source
            .kdf_salt_path
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("KDF_SALT_MISSING"))?;
        if !salt_path.exists() {
            return Err(ErrorCodeString::new("KDF_SALT_MISSING"));
        }
        add_file_to_zip(
            &mut writer,
            salt_path,
            "kdf_salt.bin",
            &mut manifest_entries,
        )?;

        let key_check_path = source
            .key_check_path
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("KEY_CHECK_MISSING"))?;
        if !key_check_path.exists() {
            return Err(ErrorCodeString::new("KEY_CHECK_MISSING"));
        }
        add_file_to_zip(
            &mut writer,
            key_check_path,
            "key_check.bin",
            &mut manifest_entries,
        )?;
    } else if vault_mode == "passwordless" {
        let vault_key_path = source
            .vault_key_path
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_KEY_MISSING"))?;
        if !vault_key_path.exists() {
            return Err(ErrorCodeString::new("VAULT_KEY_MISSING"));
        }
        add_file_to_zip(
            &mut writer,
            vault_key_path,
            "vault_key.bin",
            &mut manifest_entries,
        )?;
    } else {
        return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
    }

    let manifest = BackupManifest {
        format_version: 1,
        created_at_utc: created_at_utc.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        profile_id: profile_id.to_string(),
        profile_name: Some(profile_name.to_string()),
        vault_mode: vault_mode.to_string(),
        files: manifest_entries,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;
    let options = FileOptions::default().compression_method(CompressionMethod::Stored);
    writer
        .start_file("manifest.json", options)
        .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;
    writer
        .write_all(&manifest_bytes)
        .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;
    writer
        .finish()
        .map_err(|_| ErrorCodeString::new("BACKUP_ZIP_WRITE_FAILED"))?;

    let replace_result = replace_file_windows(&tmp_dest, destination);

    if replace_result.is_err() {
        if tmp_dest.exists() {
            let _ = fs::remove_file(&tmp_dest);
        }
        return Err(ErrorCodeString::new("BACKUP_CREATE_FAILED"));
    }

    if tmp_dest.exists() {
        let _ = fs::remove_file(&tmp_dest);
    }
    let bytes = fs::metadata(destination)
        .map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?
        .len() as i64;
    Ok(bytes)
}

fn prune_registry(registry: &mut BackupRegistry) {
    registry
        .backups
        .retain(|item| PathBuf::from(&item.path).exists());
}

fn apply_max_copies(settings: &UserSettings, managed_root: &Path, registry: &mut BackupRegistry) {
    let mut max_copies = settings.backup_max_copies;
    if max_copies < 1 {
        max_copies = 1;
    }
    let max_copies = max_copies as usize;

    let mut managed: Vec<(usize, chrono::DateTime<Utc>)> = registry
        .backups
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            let path = PathBuf::from(&item.path);
            if !path.starts_with(managed_root) {
                return None;
            }
            let dt = chrono::DateTime::parse_from_rfc3339(&item.created_at_utc)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now);
            Some((idx, dt))
        })
        .collect();

    managed.sort_by_key(|(_, dt)| *dt);

    if managed.len() <= max_copies {
        return;
    }

    let to_remove = managed.len() - max_copies;
    let mut remove_indices: Vec<usize> = managed
        .into_iter()
        .take(to_remove)
        .map(|(idx, _)| idx)
        .collect();

    remove_indices.sort_unstable_by(|a, b| b.cmp(a));

    for idx in remove_indices {
        if let Some(entry) = registry.backups.get(idx) {
            let _ = fs::remove_file(&entry.path);
        }
        registry.backups.remove(idx);
    }
}

fn resolve_destination_path(
    sp: &StoragePaths,
    profile_id: &str,
    destination_path: Option<String>,
    use_default_path: bool,
) -> Result<(String, String)> {
    if use_default_path {
        let timestamp = now_timestamp();
        let id = format!("backup_{timestamp}");
        let file_name = format!("backup_{timestamp}_{profile_id}.pmbackup.zip");
        let dest = backups_dir(sp, profile_id)?;
        let path = dest.join(file_name);
        return Ok((id, path.to_string_lossy().to_string()));
    }

    let destination_path =
        destination_path.ok_or_else(|| ErrorCodeString::new("BACKUP_DESTINATION_REQUIRED"))?;
    let destination = ensure_output_path_allowed(
        sp,
        Path::new(&destination_path),
        "BACKUP_DESTINATION_UNAVAILABLE",
        "BACKUP_DESTINATION_PATH_FORBIDDEN",
    )?;

    let timestamp = now_timestamp();
    let id = format!("backup_{timestamp}");
    Ok((id, destination.to_string_lossy().to_string()))
}

fn create_backup_internal(
    state: &Arc<AppState>,
    destination_path: Option<String>,
    use_default_path: bool,
) -> Result<BackupResult> {
    let _guard = ensure_backup_guard(state)?;
    let profile_id = require_unlocked_active_profile_id(state)?;
    let sp = state.get_storage_paths()?;

    let (backup_id, destination) =
        resolve_destination_path(&sp, &profile_id, destination_path, use_default_path)?;
    let destination_path = PathBuf::from(&destination);

    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| ErrorCodeString::new("BACKUP_DESTINATION_UNAVAILABLE"))?;
    }

    let created_at_utc = now_utc_string();
    let (source, vault_mode, profile_name) = build_backup_source(state, &sp, &profile_id)?;
    let bytes = create_archive(
        &destination_path,
        source,
        &profile_id,
        &profile_name,
        &vault_mode,
        &created_at_utc,
    )?;

    Ok(BackupResult {
        id: backup_id,
        created_at_utc,
        path: destination,
        bytes,
    })
}

fn restore_staging_root(profile_root: &Path) -> PathBuf {
    profile_root.join("tmp").join(RESTORE_STAGING_DIR)
}

fn restore_tx_root(profile_root: &Path) -> PathBuf {
    profile_root.join("tmp").join(RESTORE_TX_DIR)
}

fn restore_tx_manifest_path(tx_root: &Path) -> PathBuf {
    tx_root.join(RESTORE_TX_MANIFEST_FILE)
}

fn restore_tx_commit_path(tx_root: &Path) -> PathBuf {
    tx_root.join(RESTORE_TX_COMMIT_MARKER)
}

fn restore_tx_originals_root(tx_root: &Path) -> PathBuf {
    tx_root.join(RESTORE_TX_ORIGINALS_DIR)
}

fn restore_original_backup_rel(target_rel: &str) -> String {
    format!(
        "{RESTORE_TX_ORIGINALS_DIR}/{}",
        target_rel.replace('\\', "/")
    )
}

fn restore_tx_path(tx_root: &Path, rel: &str) -> PathBuf {
    tx_root.join(rel)
}

fn restore_target_path(profile_root: &Path, target_rel: &str) -> PathBuf {
    profile_root.join(target_rel)
}

fn build_restore_action(
    profile_root: &Path,
    kind: RestoreTxKind,
    target_rel: &str,
    source: RestoreApplySource,
) -> RestoreApplyAction {
    let target_path = restore_target_path(profile_root, target_rel);
    let backup_rel = if target_path.exists() {
        Some(restore_original_backup_rel(target_rel))
    } else {
        None
    };

    RestoreApplyAction {
        entry: RestoreTxEntry {
            kind,
            target_rel: target_rel.to_string(),
            backup_rel,
        },
        source,
    }
}

fn build_restore_tx_manifest_and_actions(
    profile_root: &Path,
    staging_root: &Path,
    manifest: &BackupManifest,
    profile_name: &str,
) -> Result<(RestoreTxManifest, Vec<RestoreApplyAction>)> {
    let mut actions = Vec::new();

    let extracted_vault = staging_root.join("vault.db");
    if !extracted_vault.exists() {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }
    actions.push(build_restore_action(
        profile_root,
        RestoreTxKind::FileReplace,
        "vault.db",
        RestoreApplySource::File(extracted_vault),
    ));

    let extracted_attachments = staging_root.join("attachments");
    if extracted_attachments.exists() {
        actions.push(build_restore_action(
            profile_root,
            RestoreTxKind::DirectoryReplace,
            "attachments",
            RestoreApplySource::Directory(extracted_attachments),
        ));
    } else {
        actions.push(build_restore_action(
            profile_root,
            RestoreTxKind::DirectoryCreate,
            "attachments",
            RestoreApplySource::None,
        ));
    }

    for file_name in ["config.json", "user_settings.json", "vault_key.bin"] {
        let extracted = staging_root.join(file_name);
        if extracted.exists() {
            actions.push(build_restore_action(
                profile_root,
                RestoreTxKind::FileReplace,
                file_name,
                RestoreApplySource::File(extracted),
            ));
        }
    }

    match manifest.vault_mode.as_str() {
        "protected" => {
            for file_name in ["kdf_salt.bin", "key_check.bin"] {
                let extracted = staging_root.join(file_name);
                if !extracted.exists() {
                    return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
                }
                actions.push(build_restore_action(
                    profile_root,
                    RestoreTxKind::FileReplace,
                    file_name,
                    RestoreApplySource::File(extracted),
                ));
            }
        }
        "passwordless" => {
            for file_name in ["kdf_salt.bin", "key_check.bin"] {
                let live = profile_root.join(file_name);
                if live.exists() {
                    actions.push(build_restore_action(
                        profile_root,
                        RestoreTxKind::FileRemove,
                        file_name,
                        RestoreApplySource::None,
                    ));
                }
            }
        }
        _ => return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID")),
    }

    let tx_manifest = RestoreTxManifest {
        version: 1,
        profile_id: manifest.profile_id.clone(),
        profile_name: profile_name.to_string(),
        has_password: manifest.vault_mode == "protected",
        entries: actions.iter().map(|action| action.entry.clone()).collect(),
    };

    Ok((tx_manifest, actions))
}

fn write_restore_tx_manifest(profile_root: &Path, manifest: &RestoreTxManifest) -> Result<PathBuf> {
    let tx_root = restore_tx_root(profile_root);
    prepare_empty_dir_for_restore(&tx_root)
        .map_err(|e| map_restore_io_error("prepare_restore_tx_root", Some(&tx_root), None, e))?;

    let originals_root = restore_tx_originals_root(&tx_root);
    fs::create_dir_all(&originals_root).map_err(|e| {
        map_restore_io_error(
            "create_restore_tx_originals_root",
            Some(&originals_root),
            None,
            e,
        )
    })?;

    let manifest_path = restore_tx_manifest_path(&tx_root);
    let serialized = serde_json::to_vec_pretty(manifest)
        .map_err(|_| ErrorCodeString::new("BACKUP_RESTORE_FAILED"))?;
    write_atomic(&manifest_path, &serialized)
        .map_err(|_| ErrorCodeString::new("BACKUP_RESTORE_FAILED"))?;

    Ok(tx_root)
}

fn move_target_to_restore_backup(
    profile_root: &Path,
    tx_root: &Path,
    entry: &RestoreTxEntry,
) -> Result<()> {
    let Some(backup_rel) = entry.backup_rel.as_deref() else {
        return Ok(());
    };

    let target_path = restore_target_path(profile_root, &entry.target_rel);
    if !target_path.exists() {
        return Ok(());
    }

    let backup_path = restore_tx_path(tx_root, backup_rel);
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            map_restore_io_error("create_restore_backup_parent", Some(parent), None, e)
        })?;
    }

    rename_with_retry(&target_path, &backup_path).map_err(|e| {
        map_restore_io_error(
            "move_restore_target_to_backup",
            Some(&target_path),
            Some(&backup_path),
            e,
        )
    })?;

    Ok(())
}

fn apply_restore_tx_action(
    profile_root: &Path,
    tx_root: &Path,
    action: &RestoreApplyAction,
) -> Result<()> {
    let target_path = restore_target_path(profile_root, &action.entry.target_rel);
    move_target_to_restore_backup(profile_root, tx_root, &action.entry)?;

    match (&action.entry.kind, &action.source) {
        (RestoreTxKind::FileReplace, RestoreApplySource::File(source))
        | (RestoreTxKind::DirectoryReplace, RestoreApplySource::Directory(source)) => {
            rename_with_retry(source, &target_path).map_err(|e| {
                map_restore_io_error(
                    "move_restore_source_to_live",
                    Some(source),
                    Some(&target_path),
                    e,
                )
            })?;
        }
        (RestoreTxKind::FileRemove, RestoreApplySource::None) => {}
        (RestoreTxKind::DirectoryCreate, RestoreApplySource::None) => {
            fs::create_dir_all(&target_path).map_err(|e| {
                map_restore_io_error("create_restore_live_dir", Some(&target_path), None, e)
            })?;
        }
        _ => return Err(ErrorCodeString::new("BACKUP_RESTORE_FAILED")),
    }

    Ok(())
}

fn apply_restore_tx(
    profile_root: &Path,
    tx_root: &Path,
    actions: &[RestoreApplyAction],
) -> Result<()> {
    let mut applied_count = 0usize;

    for action in actions {
        apply_restore_tx_action(profile_root, tx_root, action)?;
        applied_count += 1;
        maybe_trigger_restore_failpoint(applied_count)?;
    }

    Ok(())
}

fn rollback_restore_tx(
    profile_root: &Path,
    tx_root: &Path,
    manifest: &RestoreTxManifest,
) -> Result<()> {
    for entry in manifest.entries.iter().rev() {
        let target_path = restore_target_path(profile_root, &entry.target_rel);

        match entry.kind {
            RestoreTxKind::FileReplace | RestoreTxKind::FileRemove => {
                if let Some(backup_rel) = entry.backup_rel.as_deref() {
                    let backup_path = restore_tx_path(tx_root, backup_rel);
                    if backup_path.exists() {
                        if target_path.exists() {
                            remove_file_if_exists(&target_path).map_err(|e| {
                                map_restore_io_error(
                                    "rollback_remove_live_file",
                                    Some(&target_path),
                                    None,
                                    e,
                                )
                            })?;
                        }

                        rename_with_retry(&backup_path, &target_path).map_err(|e| {
                            map_restore_io_error(
                                "rollback_restore_file",
                                Some(&backup_path),
                                Some(&target_path),
                                e,
                            )
                        })?;
                    }
                } else if target_path.exists() {
                    remove_file_if_exists(&target_path).map_err(|e| {
                        map_restore_io_error(
                            "rollback_remove_created_file",
                            Some(&target_path),
                            None,
                            e,
                        )
                    })?;
                }
            }
            RestoreTxKind::DirectoryReplace | RestoreTxKind::DirectoryCreate => {
                if let Some(backup_rel) = entry.backup_rel.as_deref() {
                    let backup_path = restore_tx_path(tx_root, backup_rel);
                    if backup_path.exists() {
                        if target_path.exists() {
                            remove_dir_all_if_exists(&target_path).map_err(|e| {
                                map_restore_io_error(
                                    "rollback_remove_live_dir",
                                    Some(&target_path),
                                    None,
                                    e,
                                )
                            })?;
                        }

                        rename_with_retry(&backup_path, &target_path).map_err(|e| {
                            map_restore_io_error(
                                "rollback_restore_dir",
                                Some(&backup_path),
                                Some(&target_path),
                                e,
                            )
                        })?;
                    }
                } else if target_path.exists() {
                    remove_dir_all_if_exists(&target_path).map_err(|e| {
                        map_restore_io_error(
                            "rollback_remove_created_dir",
                            Some(&target_path),
                            None,
                            e,
                        )
                    })?;
                }
            }
        }
    }

    Ok(())
}

fn cleanup_restore_dir_best_effort(path: &Path, step: &'static str) {
    if let Err(e) = remove_dir_all_if_exists(path) {
        log::warn!(
            "[BACKUP][restore] cleanup_failed step={} path={:?} err={}",
            step,
            path,
            e
        );
    }
}

fn cleanup_restore_state_best_effort(profile_root: &Path) {
    cleanup_restore_dir_best_effort(
        &restore_staging_root(profile_root),
        "cleanup_restore_staging",
    );
    cleanup_restore_dir_best_effort(&restore_tx_root(profile_root), "cleanup_restore_tx");
}

fn load_restore_tx_manifest(tx_root: &Path) -> Result<RestoreTxManifest> {
    let manifest_path = restore_tx_manifest_path(tx_root);
    let content = fs::read_to_string(&manifest_path).map_err(|e| {
        map_restore_io_error("read_restore_tx_manifest", Some(&manifest_path), None, e)
    })?;

    serde_json::from_str(&content).map_err(|_| ErrorCodeString::new("BACKUP_RESTORE_FAILED"))
}

pub fn recover_pending_restore_tx(sp: &StoragePaths, profile_id: &str) -> Result<()> {
    let profile_root = profile_dir(sp, profile_id)?;
    if !profile_root.exists() {
        return Ok(());
    }

    let staging_root = restore_staging_root(&profile_root);
    let tx_root = restore_tx_root(&profile_root);
    if !tx_root.exists() {
        if staging_root.exists() {
            cleanup_restore_dir_best_effort(&staging_root, "cleanup_orphan_restore_staging");
        }
        return Ok(());
    }

    let manifest_path = restore_tx_manifest_path(&tx_root);
    if !manifest_path.exists() {
        cleanup_restore_state_best_effort(&profile_root);
        return Ok(());
    }

    let manifest = load_restore_tx_manifest(&tx_root)?;
    if manifest.version != 1 || manifest.profile_id != profile_id {
        return Err(ErrorCodeString::new("BACKUP_RESTORE_FAILED"));
    }

    let commit_path = restore_tx_commit_path(&tx_root);
    if commit_path.exists() {
        registry::upsert_profile_with_id(
            sp,
            profile_id,
            &manifest.profile_name,
            manifest.has_password,
        )?;
        cleanup_restore_state_best_effort(&profile_root);
        return Ok(());
    }

    rollback_restore_tx(&profile_root, &tx_root, &manifest)?;
    cleanup_restore_state_best_effort(&profile_root);
    Ok(())
}

fn restore_archive_to_profile(
    _state: &Arc<AppState>,
    sp: &StoragePaths,
    target_profile_id: &str,
    profile_name: &str,
    backup_path: &Path,
) -> Result<bool> {
    let backup_path = PathBuf::from(backup_path);
    if !backup_path.exists() {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }

    recover_pending_restore_tx(sp, target_profile_id)?;

    let profile_root = profile_dir(sp, target_profile_id)?;

    log::info!(
        "[BACKUP][restore] begin profile_id={} backup_path={:?}",
        target_profile_id,
        backup_path
    );

    let archive_file =
        fs::File::open(&backup_path).map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;

    let mut manifest_contents = String::new();
    {
        let mut manifest_file = archive
            .by_name("manifest.json")
            .map_err(|_| ErrorCodeString::new("BACKUP_MANIFEST_MISSING"))?;
        manifest_file
            .read_to_string(&mut manifest_contents)
            .map_err(|_| ErrorCodeString::new("BACKUP_MANIFEST_INVALID"))?;
    }

    let manifest: BackupManifest = serde_json::from_str(&manifest_contents)
        .map_err(|_| ErrorCodeString::new("BACKUP_MANIFEST_INVALID"))?;

    let has_password = manifest.vault_mode == "protected";
    ensure_profile_dirs(sp, target_profile_id, has_password)?;

    let staging_root = restore_staging_root(&profile_root);
    // Keep staging paths short (important on Windows) and deterministic for easier debugging.
    // We clear it on each restore attempt.
    prepare_empty_dir_for_restore(&staging_root)
        .map_err(|e| map_restore_io_error("prepare_staging_root", Some(&staging_root), None, e))?;

    if manifest.format_version != 1 {
        return Err(ErrorCodeString::new("BACKUP_UNSUPPORTED_FORMAT"));
    }

    if !validate_profile_id_component(&manifest.profile_id) {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }

    if manifest.profile_id != target_profile_id {
        return Err(ErrorCodeString::new("BACKUP_PROFILE_MISMATCH"));
    }

    if manifest.files.len() > MAX_RESTORE_FILES {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_TOO_MANY_FILES"));
    }

    let mut total_declared: i64 = 0;
    for f in &manifest.files {
        if f.bytes < 0 {
            return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
        }
        if f.bytes > MAX_RESTORE_ENTRY_BYTES {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"));
        }
        total_declared = total_declared
            .checked_add(f.bytes)
            .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"))?;
        if total_declared > MAX_RESTORE_TOTAL_BYTES {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"));
        }
    }

    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut has_vault = false;
    let mut has_kdf_salt = false;
    let mut has_key_check = false;
    let mut has_vault_key = false;

    for f in &manifest.files {
        if !seen.insert(&f.path) {
            return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
        }
        if f.path == "vault.db" {
            has_vault = true;
        }
        if f.path == "kdf_salt.bin" {
            has_kdf_salt = true;
        }
        if f.path == "key_check.bin" {
            has_key_check = true;
        }
        if f.path == "vault_key.bin" {
            has_vault_key = true;
        }
    }

    if !has_vault {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }
    if manifest.vault_mode == "protected" {
        if !has_kdf_salt || !has_key_check || !has_vault_key {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
        }
    } else if manifest.vault_mode == "passwordless" {
        // Passwordless portable format requires vault_key.bin.
        if !has_vault_key {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
        }
    } else {
        return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
    }

    let mut total_written: i64 = 0;
    for entry in &manifest.files {
        let rel_path = Path::new(&entry.path);
        if !validate_zip_entry_rel_path_windows(rel_path) {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
        }

        let mut zipped_file = archive
            .by_name(&entry.path)
            .map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;
        let header_len = expected_restore_header_len(&manifest, &entry.path);
        let mut pre_read: Vec<u8> = Vec::new();
        if header_len > 0 {
            pre_read.resize(header_len, 0);
            let n = zipped_file
                .read(&mut pre_read)
                .map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;
            pre_read.truncate(n);
            validate_backup_entry_header(&manifest, &entry.path, &pre_read)?;
        }

        let target_path = staging_root.as_path().join(rel_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| map_restore_io_error("create_parent_dirs", Some(parent), None, e))?;
        }

        let file = fs::File::create(&target_path).map_err(|e| {
            map_restore_io_error("create_extracted_file", Some(&target_path), None, e)
        })?;
        let mut writer = BufWriter::new(file);
        let mut buffer = [0u8; 64 * 1024];
        let mut hasher = Sha256::new();
        let mut bytes_written = 0i64;

        if !pre_read.is_empty() {
            writer.write_all(&pre_read).map_err(|e| {
                map_restore_io_error("write_extracted_file", Some(&target_path), None, e)
            })?;
            bytes_written = bytes_written
                .checked_add(pre_read.len() as i64)
                .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"))?;
            total_written = total_written
                .checked_add(pre_read.len() as i64)
                .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"))?;

            if bytes_written > MAX_RESTORE_ENTRY_BYTES || total_written > MAX_RESTORE_TOTAL_BYTES {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"));
            }

            hasher.update(&pre_read);
        }

        loop {
            let read = zipped_file
                .read(&mut buffer)
                .map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read]).map_err(|e| {
                map_restore_io_error("write_extracted_file", Some(&target_path), None, e)
            })?;
            bytes_written = bytes_written
                .checked_add(read as i64)
                .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"))?;
            total_written = total_written
                .checked_add(read as i64)
                .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"))?;

            if bytes_written > MAX_RESTORE_ENTRY_BYTES || total_written > MAX_RESTORE_TOTAL_BYTES {
                return Err(ErrorCodeString::new("BACKUP_ARCHIVE_TOO_LARGE"));
            }

            hasher.update(&buffer[..read]);
        }

        writer.flush().map_err(|e| {
            map_restore_io_error("flush_extracted_file", Some(&target_path), None, e)
        })?;
        writer.get_ref().sync_all().map_err(|e| {
            map_restore_io_error("sync_extracted_file", Some(&target_path), None, e)
        })?;

        let sha256 = hex::encode(hasher.finalize());
        if sha256 != entry.sha256 || bytes_written != entry.bytes {
            return Err(ErrorCodeString::new("BACKUP_INTEGRITY_FAILED"));
        }
    }

    let (tx_manifest, actions) = build_restore_tx_manifest_and_actions(
        &profile_root,
        &staging_root,
        &manifest,
        profile_name,
    )?;
    let tx_root = write_restore_tx_manifest(&profile_root, &tx_manifest)?;

    let restore_result = apply_restore_tx(&profile_root, &tx_root, &actions);
    if let Err(err) = restore_result {
        log::error!(
            "[BACKUP][restore] failed code={} profile_id={} backup_path={:?}",
            err.code,
            target_profile_id,
            backup_path
        );

        if let Err(rollback_err) = rollback_restore_tx(&profile_root, &tx_root, &tx_manifest) {
            cleanup_restore_state_best_effort(&profile_root);
            return Err(rollback_err);
        }

        cleanup_restore_state_best_effort(&profile_root);
        return Err(err);
    }

    let commit_path = restore_tx_commit_path(&tx_root);
    write_atomic(&commit_path, b"committed")
        .map_err(|_| ErrorCodeString::new("BACKUP_RESTORE_FAILED"))?;

    log::info!(
        "[BACKUP][restore] success profile_id={} backup_path={:?}",
        target_profile_id,
        backup_path
    );

    cleanup_restore_state_best_effort(&profile_root);

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn configured_storage_paths(workspace_root: &Path) -> StoragePaths {
        let mut sp = StoragePaths::new_unconfigured().unwrap();
        sp.configure_workspace(workspace_root.to_path_buf())
            .unwrap();
        sp
    }

    fn test_manifest(vault_mode: &str, profile_id: &str) -> BackupManifest {
        BackupManifest {
            format_version: 1,
            created_at_utc: "2026-01-23T00:00:00Z".to_string(),
            app_version: "test".to_string(),
            profile_id: profile_id.to_string(),
            profile_name: Some("Test".to_string()),
            vault_mode: vault_mode.to_string(),
            files: vec![],
        }
    }

    fn write_bytes(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, bytes).unwrap();
    }

    fn read_bytes(path: &Path) -> Vec<u8> {
        std::fs::read(path).unwrap()
    }

    fn test_restore_tx_manifest(
        profile_id: &str,
        profile_name: &str,
        has_password: bool,
        entries: Vec<RestoreTxEntry>,
    ) -> RestoreTxManifest {
        RestoreTxManifest {
            version: 1,
            profile_id: profile_id.to_string(),
            profile_name: profile_name.to_string(),
            has_password,
            entries,
        }
    }

    fn write_restore_tx_fixture(
        profile_root: &Path,
        manifest: &RestoreTxManifest,
        committed: bool,
    ) -> PathBuf {
        let tx_root = write_restore_tx_manifest(profile_root, manifest).unwrap();
        if committed {
            write_atomic(&restore_tx_commit_path(&tx_root), b"committed").unwrap();
        }
        tx_root
    }

    fn configured_state(workspace_root: &Path) -> std::sync::Arc<AppState> {
        std::fs::create_dir_all(workspace_root).unwrap();
        let sp = configured_storage_paths(workspace_root);
        std::sync::Arc::new(AppState::new(sp, workspace_root.join("app-config")))
    }

    fn create_protected_profile_fixture(
        sp: &StoragePaths,
        profile_id: &str,
        profile_name: &str,
        password: &str,
        config_marker: &str,
        settings_marker: &str,
    ) {
        registry::upsert_profile_with_id(sp, profile_id, profile_name, true).unwrap();

        let master_key = crate::data::crypto::master_key::generate_master_key();
        crate::data::sqlite::init::init_database_protected_encrypted(sp, profile_id, &master_key)
            .unwrap();

        let salt = crate::data::crypto::kdf::generate_kdf_salt();
        write_atomic(&kdf_salt_path(sp, profile_id).unwrap(), &salt).unwrap();

        let wrapping = zeroize::Zeroizing::new(
            crate::data::crypto::kdf::derive_master_key(password, &salt).unwrap(),
        );
        crate::data::crypto::key_check::create_key_check_file(sp, profile_id, &wrapping).unwrap();
        crate::data::crypto::master_key::write_master_key_wrapped_with_password(
            sp,
            profile_id,
            &wrapping,
            &master_key,
        )
        .unwrap();

        let config = serde_json::json!({
            "name": profile_name,
            "marker": config_marker,
        });
        let config_bytes = serde_json::to_vec_pretty(&config).unwrap();
        write_atomic(&profile_config_path(sp, profile_id).unwrap(), &config_bytes).unwrap();
        write_atomic(
            &user_settings_path(sp, profile_id).unwrap(),
            settings_marker.as_bytes(),
        )
        .unwrap();
    }

    fn protected_backup_source(sp: &StoragePaths, profile_id: &str) -> BackupSource {
        BackupSource {
            vault_path: vault_db_path(sp, profile_id).unwrap(),
            attachments_path: profile_dir(sp, profile_id).unwrap().join("attachments"),
            config_path: Some(profile_config_path(sp, profile_id).unwrap()),
            settings_path: Some(user_settings_path(sp, profile_id).unwrap()),
            kdf_salt_path: Some(kdf_salt_path(sp, profile_id).unwrap()),
            key_check_path: Some(key_check_path(sp, profile_id).unwrap()),
            vault_key_path: Some(vault_key_path(sp, profile_id).unwrap()),
            _temp_dir: None,
        }
    }

    #[test]
    fn restore_rejects_plaintext_sqlite_vault_db_header() {
        let manifest = test_manifest("passwordless", "p1");
        let err = validate_backup_entry_header(&manifest, "vault.db", SQLITE_MAGIC).unwrap_err();
        assert_eq!(err.code, "BACKUP_PLAINTEXT_REJECTED");
    }

    #[test]
    fn restore_accepts_encrypted_vault_db_header() {
        let manifest = test_manifest("passwordless", "p1");
        let mut header = Vec::new();
        header.extend_from_slice(&cipher::PM_ENC_MAGIC);
        header.push(cipher::PM_ENC_VERSION);
        header.extend_from_slice(&[0u8; 8]);
        validate_backup_entry_header(&manifest, "vault.db", &header).unwrap();
    }

    #[test]
    fn restore_accepts_passwordless_vault_key_prefix_and_profile_id() {
        let manifest = test_manifest("passwordless", "abc");
        let mut header = Vec::new();
        header.extend_from_slice(PASSWORDLESS_MASTER_KEY_PREFIX);
        header.extend_from_slice(manifest.profile_id.as_bytes());
        header.push(0);
        validate_backup_entry_header(&manifest, "vault_key.bin", &header).unwrap();
    }

    #[test]
    fn restore_rejects_protected_vault_key_in_passwordless_manifest() {
        let manifest = test_manifest("passwordless", "abc");
        let mut header = Vec::new();
        header.extend_from_slice(&cipher::PM_ENC_MAGIC);
        header.push(cipher::PM_ENC_VERSION);
        header.extend_from_slice(&[0u8; 8]);
        let err = validate_backup_entry_header(&manifest, "vault_key.bin", &header).unwrap_err();
        assert_eq!(err.code, "BACKUP_ARCHIVE_INVALID");
    }

    #[test]
    fn expected_header_len_for_passwordless_vault_key_includes_profile_id() {
        let manifest = test_manifest("passwordless", "abc");
        let len = expected_restore_header_len(&manifest, "vault_key.bin");
        assert_eq!(len, PASSWORDLESS_MASTER_KEY_PREFIX.len() + 3 + 1);
    }

    #[test]
    fn resolve_destination_path_allows_default_managed_backup_location() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);

        let (_id, path) = resolve_destination_path(&sp, "profile1", None, true).unwrap();

        let backups_root = backups_dir(&sp, "profile1").unwrap();
        assert!(Path::new(&path).starts_with(&backups_root));
        assert!(path.ends_with(".pmbackup.zip"));
    }

    #[test]
    fn resolve_destination_path_blocks_manual_targets_in_managed_storage() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);

        let managed_target = profile_dir(&sp, "profile1")
            .unwrap()
            .join("backups")
            .join("custom.pmbackup.zip");
        std::fs::create_dir_all(managed_target.parent().unwrap()).unwrap();

        let err = resolve_destination_path(
            &sp,
            "profile1",
            Some(managed_target.to_string_lossy().to_string()),
            false,
        )
        .unwrap_err();

        assert_eq!(err.code, "BACKUP_DESTINATION_PATH_FORBIDDEN");
    }

    #[test]
    fn rollback_restores_replaced_root_files() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let profile_id = "profile-rollback";
        ensure_profile_dirs(&sp, profile_id, true).unwrap();

        let profile_root = profile_dir(&sp, profile_id).unwrap();
        let files = [
            (
                "config.json",
                b"new-config".as_slice(),
                b"old-config".as_slice(),
            ),
            (
                "user_settings.json",
                b"new-settings".as_slice(),
                b"old-settings".as_slice(),
            ),
            (
                "vault_key.bin",
                b"new-vault-key".as_slice(),
                b"old-vault-key".as_slice(),
            ),
            (
                "kdf_salt.bin",
                b"new-salt".as_slice(),
                b"old-salt".as_slice(),
            ),
            (
                "key_check.bin",
                b"new-key-check".as_slice(),
                b"old-key-check".as_slice(),
            ),
        ];

        let entries = files
            .iter()
            .map(|(name, _, _)| RestoreTxEntry {
                kind: RestoreTxKind::FileReplace,
                target_rel: (*name).to_string(),
                backup_rel: Some(restore_original_backup_rel(name)),
            })
            .collect();
        let manifest = test_restore_tx_manifest(profile_id, "Rollback", true, entries);
        let tx_root = write_restore_tx_fixture(&profile_root, &manifest, false);

        for (name, live, backup) in files {
            write_bytes(&profile_root.join(name), live);
            write_bytes(
                &restore_tx_path(&tx_root, &restore_original_backup_rel(name)),
                backup,
            );
        }

        recover_pending_restore_tx(&sp, profile_id).unwrap();

        for (name, _, backup) in files {
            assert_eq!(read_bytes(&profile_root.join(name)), backup);
        }
        assert!(!tx_root.exists());
    }

    #[test]
    fn rollback_removes_newly_created_files_without_originals() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let profile_id = "profile-created-file";
        ensure_profile_dirs(&sp, profile_id, false).unwrap();

        let profile_root = profile_dir(&sp, profile_id).unwrap();
        let created_path = profile_root.join("user_settings.json");
        write_bytes(&created_path, b"created-by-restore");

        let manifest = test_restore_tx_manifest(
            profile_id,
            "Created File",
            false,
            vec![RestoreTxEntry {
                kind: RestoreTxKind::FileReplace,
                target_rel: "user_settings.json".to_string(),
                backup_rel: None,
            }],
        );
        let tx_root = write_restore_tx_fixture(&profile_root, &manifest, false);

        recover_pending_restore_tx(&sp, profile_id).unwrap();

        assert!(!created_path.exists());
        assert!(!tx_root.exists());
    }

    #[test]
    fn rollback_restores_passwordless_cleanup_files() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let profile_id = "profile-passwordless-cleanup";
        ensure_profile_dirs(&sp, profile_id, false).unwrap();

        let profile_root = profile_dir(&sp, profile_id).unwrap();
        let manifest = test_restore_tx_manifest(
            profile_id,
            "Passwordless",
            false,
            vec![
                RestoreTxEntry {
                    kind: RestoreTxKind::FileRemove,
                    target_rel: "kdf_salt.bin".to_string(),
                    backup_rel: Some(restore_original_backup_rel("kdf_salt.bin")),
                },
                RestoreTxEntry {
                    kind: RestoreTxKind::FileRemove,
                    target_rel: "key_check.bin".to_string(),
                    backup_rel: Some(restore_original_backup_rel("key_check.bin")),
                },
            ],
        );
        let tx_root = write_restore_tx_fixture(&profile_root, &manifest, false);

        write_bytes(
            &restore_tx_path(&tx_root, &restore_original_backup_rel("kdf_salt.bin")),
            b"salt-before-remove",
        );
        write_bytes(
            &restore_tx_path(&tx_root, &restore_original_backup_rel("key_check.bin")),
            b"key-check-before-remove",
        );

        recover_pending_restore_tx(&sp, profile_id).unwrap();

        assert_eq!(
            read_bytes(&profile_root.join("kdf_salt.bin")),
            b"salt-before-remove"
        );
        assert_eq!(
            read_bytes(&profile_root.join("key_check.bin")),
            b"key-check-before-remove"
        );
        assert!(!tx_root.exists());
    }

    #[test]
    fn committed_restore_tx_keeps_live_files_and_updates_registry() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let profile_id = "profile-committed";
        registry::upsert_profile_with_id(&sp, profile_id, "Old Name", true).unwrap();

        let profile_root = profile_dir(&sp, profile_id).unwrap();
        let live_vault_key = profile_root.join("vault_key.bin");
        write_bytes(&live_vault_key, b"restored-live-vault-key");

        let manifest = test_restore_tx_manifest(
            profile_id,
            "Recovered Name",
            false,
            vec![RestoreTxEntry {
                kind: RestoreTxKind::FileReplace,
                target_rel: "vault_key.bin".to_string(),
                backup_rel: Some(restore_original_backup_rel("vault_key.bin")),
            }],
        );
        let tx_root = write_restore_tx_fixture(&profile_root, &manifest, true);
        write_bytes(
            &restore_tx_path(&tx_root, &restore_original_backup_rel("vault_key.bin")),
            b"stale-backup",
        );

        recover_pending_restore_tx(&sp, profile_id).unwrap();

        assert_eq!(read_bytes(&live_vault_key), b"restored-live-vault-key");
        let profile = registry::get_profile(&sp, profile_id).unwrap().unwrap();
        assert_eq!(profile.name, "Recovered Name");
        assert!(!profile.has_password);
        assert!(!tx_root.exists());
    }

    #[test]
    fn restore_failpoint_rolls_back_and_keeps_profile_unlockable() {
        let _failpoint_lock = restore_apply_failpoint_lock().lock().unwrap();
        clear_restore_apply_failpoint();
        struct ResetFailpoint;
        impl Drop for ResetFailpoint {
            fn drop(&mut self) {
                clear_restore_apply_failpoint();
            }
        }
        let _reset = ResetFailpoint;

        let dir = tempdir().unwrap();
        let target_workspace = dir.path().join("target-workspace");
        let source_workspace = dir.path().join("source-workspace");
        let state = configured_state(&target_workspace);
        let target_sp = state.get_storage_paths().unwrap();
        let source_sp = configured_storage_paths(&source_workspace);
        let profile_id = "profile-e2e-failpoint";

        create_protected_profile_fixture(
            &target_sp,
            profile_id,
            "Original",
            "old-password",
            "old-config",
            "old-settings",
        );
        create_protected_profile_fixture(
            &source_sp,
            profile_id,
            "Restored",
            "new-password",
            "new-config",
            "new-settings",
        );

        let target_profile_root = profile_dir(&target_sp, profile_id).unwrap();
        let original_files = [
            (
                "vault.db",
                read_bytes(&vault_db_path(&target_sp, profile_id).unwrap()),
            ),
            (
                "config.json",
                read_bytes(&profile_config_path(&target_sp, profile_id).unwrap()),
            ),
            (
                "user_settings.json",
                read_bytes(&user_settings_path(&target_sp, profile_id).unwrap()),
            ),
            (
                "vault_key.bin",
                read_bytes(&vault_key_path(&target_sp, profile_id).unwrap()),
            ),
            (
                "kdf_salt.bin",
                read_bytes(&kdf_salt_path(&target_sp, profile_id).unwrap()),
            ),
            (
                "key_check.bin",
                read_bytes(&key_check_path(&target_sp, profile_id).unwrap()),
            ),
        ];

        let backup_path = dir.path().join("restore-e2e.pmbackup.zip");
        create_archive(
            &backup_path,
            protected_backup_source(&source_sp, profile_id),
            profile_id,
            "Restored",
            "protected",
            "2026-01-23T00:00:00Z",
        )
        .unwrap();

        set_restore_apply_failpoint(4);
        let err =
            restore_archive_to_profile(&state, &target_sp, profile_id, "Restored", &backup_path)
                .unwrap_err();
        assert_eq!(err.code, "BACKUP_RESTORE_TEST_FAILPOINT");

        for (name, expected) in original_files {
            assert_eq!(read_bytes(&target_profile_root.join(name)), expected);
        }

        assert!(crate::services::security_service::login_vault(
            profile_id,
            Some("old-password"),
            &state,
        )
        .unwrap());
    }
}
