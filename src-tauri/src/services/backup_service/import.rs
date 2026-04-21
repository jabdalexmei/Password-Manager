use super::*;

pub fn backup_restore_workflow(state: &Arc<AppState>, backup_path: String) -> Result<bool> {
    let _guard = ensure_backup_guard(state)?;
    // Persist any in-memory changes before restore to avoid data loss on rollback.
    security_service::lock_vault(state)?;
    let sp = state.get_storage_paths()?;

    let backup_path = PathBuf::from(&backup_path);
    let (manifest, profile_name) = read_backup_manifest_and_name(&backup_path)?;
    recover_pending_restore_tx(&sp, &manifest.profile_id)?;

    if manifest.vault_mode == "protected" {
        let mut has_kdf_salt = false;
        let mut has_key_check = false;
        let mut has_vault_key = false;
        for f in &manifest.files {
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
        if !has_kdf_salt || !has_key_check || !has_vault_key {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
        }
    } else if manifest.vault_mode == "passwordless" {
        let mut has_vault_key = false;
        for f in &manifest.files {
            if f.path == "vault_key.bin" {
                has_vault_key = true;
            }
        }
        if !has_vault_key {
            return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
        }
    } else {
        return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
    }

    let exists = registry::get_profile(&sp, &manifest.profile_id)?.is_some();
    if !exists {
        let has_password = manifest.vault_mode == "protected";
        registry::upsert_profile_with_id(&sp, &manifest.profile_id, &profile_name, has_password)?;
    }

    let restored =
        restore_archive_to_profile(state, &sp, &manifest.profile_id, &profile_name, &backup_path)?;

    // Keep profiles registry in sync with restored state (name + vault mode).
    let has_password = manifest.vault_mode == "protected";
    let _ =
        registry::upsert_profile_with_id(&sp, &manifest.profile_id, &profile_name, has_password);

    Ok(restored)
}
