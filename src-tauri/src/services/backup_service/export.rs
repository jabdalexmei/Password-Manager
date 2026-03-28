use super::*;

pub fn backup_create(
    state: &Arc<AppState>,
    destination_path: Option<String>,
    use_default_path: bool,
) -> Result<String> {
    let profile_id = require_unlocked_active_profile_id(state)?;
    let sp = state.get_storage_paths()?;
    let settings = settings_service::get_settings(&sp, &profile_id)?;
    let managed_root = backups_dir(&sp, &profile_id)?;

    let result = create_backup_internal(state, destination_path, use_default_path)?;

    update_registry(&sp, &profile_id, |registry| {
        registry.backups.push(BackupListItem {
            id: result.id.clone(),
            created_at_utc: result.created_at_utc.clone(),
            path: result.path.clone(),
            bytes: result.bytes,
        });
        prune_registry(registry);
        apply_max_copies(&settings, &managed_root, registry);
    })?;

    Ok(result.path)
}

pub fn backup_list(state: &Arc<AppState>) -> Result<Vec<BackupListItem>> {
    let profile_id = require_unlocked_active_profile_id(state)?;
    let sp = state.get_storage_paths()?;
    let mut registry = load_registry(&sp, &profile_id)?;
    prune_registry(&mut registry);
    save_registry(&sp, &profile_id, &registry)?;
    Ok(registry.backups)
}
