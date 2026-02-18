use super::*;

pub fn backup_create_if_due_auto(state: &Arc<AppState>) -> Result<Option<String>> {
    let profile_id = match security_service::require_unlocked_active_profile(state) {
        Ok(info) => info.profile_id,
        Err(e) => {
            // No auto-backup when the vault is locked / no active session.
            if e.code == "VAULT_LOCKED" {
                return Ok(None);
            }
            return Err(e);
        }
    };
    let sp = state.get_storage_paths()?;
    let settings = settings_service::get_settings(&sp, &profile_id)?;
    if !settings.backups_enabled {
        return Ok(None);
    }
    let managed_root = backups_dir(&sp, &profile_id)?;

    let mut registry = load_registry(&sp, &profile_id)?;
    let last_auto = registry
        .last_auto_backup_at_utc
        .as_ref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));

    let now = Utc::now();
    let interval = chrono::Duration::minutes(settings.auto_backup_interval_minutes);
    if let Some(last) = last_auto {
        if now < last + interval {
            return Ok(None);
        }
    }

    let result = create_backup_internal(state, None, true)?;
    registry.backups.push(BackupListItem {
        id: result.id.clone(),
        created_at_utc: result.created_at_utc.clone(),
        path: result.path.clone(),
        bytes: result.bytes,
    });
    registry.last_auto_backup_at_utc = Some(now_utc_string());
    prune_registry(&mut registry);
    apply_max_copies(&settings, &managed_root, &mut registry);
    save_registry(&sp, &profile_id, &registry)?;

    Ok(Some(result.path))
}
