use super::*;

pub fn backup_inspect(state: &Arc<AppState>, backup_path: String) -> Result<BackupInspectResult> {
    let sp = state.get_storage_paths()?;
    let backup_path = PathBuf::from(&backup_path);
    let (manifest, profile_name) = read_backup_manifest_and_name(&backup_path)?;
    let will_overwrite = registry::get_profile(&sp, &manifest.profile_id)?.is_some();

    Ok(BackupInspectResult {
        profile_id: manifest.profile_id,
        profile_name,
        created_at_utc: manifest.created_at_utc,
        vault_mode: manifest.vault_mode,
        will_overwrite,
    })
}
