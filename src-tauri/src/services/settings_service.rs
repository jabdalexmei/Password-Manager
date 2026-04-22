use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::user_settings_path;
use crate::data::sqlite::repo_impl;
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};
use crate::services::security_service;
use crate::types::UserSettings;

pub const DEFAULT_VAULT_ID: &str = "default";
pub const BLUE_THEME: &str = "blueTheme";
pub const DARK_THEME: &str = "darkTheme";
pub const DEFAULT_APP_THEME: &str = BLUE_THEME;

const APP_SETTINGS_FILE_NAME: &str = "app_settings.json";
const APP_SETTINGS_VERSION: u8 = 1;
const AUTO_BACKUP_INTERVAL_MINUTES_MIN: i64 = 5;
const AUTO_BACKUP_INTERVAL_MINUTES_MAX: i64 = 525_600;
const BACKUP_MAX_COPIES_MIN: i64 = 1;
const BACKUP_MAX_COPIES_MAX: i64 = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    version: u8,
    theme: String,
}

fn app_settings_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(APP_SETTINGS_FILE_NAME)
}

pub fn is_supported_app_theme(theme: &str) -> bool {
    matches!(theme, BLUE_THEME | DARK_THEME)
}

fn normalize_theme(theme: &str) -> Option<String> {
    if is_supported_app_theme(theme) {
        Some(theme.to_string())
    } else {
        None
    }
}

fn read_app_settings(app_config_dir: &Path) -> Option<AppSettings> {
    let path = app_settings_path(app_config_dir);
    if !path.exists() {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    let mut parsed: AppSettings = serde_json::from_str(&content).ok()?;
    if parsed.version != APP_SETTINGS_VERSION {
        return None;
    }
    parsed.theme = normalize_theme(&parsed.theme)?;
    Some(parsed)
}

fn write_app_settings(app_config_dir: &Path, settings: AppSettings) -> Result<()> {
    if settings.version != APP_SETTINGS_VERSION || !is_supported_app_theme(&settings.theme) {
        return Err(ErrorCodeString::new("APP_SETTINGS_VALIDATION_FAILED"));
    }

    let path = app_settings_path(app_config_dir);
    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|_| ErrorCodeString::new("APP_SETTINGS_WRITE"))?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("APP_SETTINGS_WRITE"))
}

pub fn normalize_active_vault_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        DEFAULT_VAULT_ID.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_sort_field(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "created_at" => Some("created_at"),
        "updated_at" => Some("updated_at"),
        "title" => Some("title"),
        _ => None,
    }
}

fn normalize_sort_direction(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "ASC" => Some("ASC"),
        "DESC" => Some("DESC"),
        _ => None,
    }
}

fn normalize_date_time_format(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "auto" => Some("auto"),
        "ddmmyyyy_24h" => Some("ddmmyyyy_24h"),
        "mmddyyyy_12h_ampm" => Some("mmddyyyy_12h_ampm"),
        _ => None,
    }
}

fn validate_settings(settings: &UserSettings) -> Result<()> {
    let in_range = |value: i64, min: i64, max: i64| (min..=max).contains(&value);

    let valid_values = [
        in_range(settings.auto_hide_secret_timeout_seconds, 1, 600),
        in_range(settings.clipboard_clear_timeout_seconds, 1, 600),
        in_range(settings.auto_lock_timeout, 30, 86_400),
    ]
    .into_iter()
    .all(|v| v);
    let valid_trash_retention_days = if settings.trash_auto_cleanup_enabled {
        in_range(settings.trash_retention_days, 1, 3_650)
    } else {
        true
    };
    let valid_auto_backup_interval = if settings.backups_enabled {
        in_range(
            settings.auto_backup_interval_minutes,
            AUTO_BACKUP_INTERVAL_MINUTES_MIN,
            AUTO_BACKUP_INTERVAL_MINUTES_MAX,
        )
    } else {
        true
    };
    let valid_backup_max_copies = in_range(
        settings.backup_max_copies,
        BACKUP_MAX_COPIES_MIN,
        BACKUP_MAX_COPIES_MAX,
    );

    let valid_frequency =
        ["daily", "weekly", "monthly"].contains(&settings.backup_frequency.as_str());
    let valid_sort_field = normalize_sort_field(&settings.default_sort_field).is_some();
    let valid_sort_direction = normalize_sort_direction(&settings.default_sort_direction).is_some();
    let valid_active_vault_id = !settings.active_vault_id.trim().is_empty();
    let valid_date_time_format = normalize_date_time_format(&settings.date_time_format).is_some();

    if valid_values
        && valid_trash_retention_days
        && valid_auto_backup_interval
        && valid_backup_max_copies
        && valid_frequency
        && valid_sort_field
        && valid_sort_direction
        && valid_active_vault_id
        && valid_date_time_format
    {
        Ok(())
    } else {
        Err(ErrorCodeString::new("SETTINGS_VALIDATION_FAILED"))
    }
}

fn repair_settings(mut settings: UserSettings) -> (UserSettings, bool) {
    let defaults = UserSettings::default();
    let mut changed = false;

    let normalized_sort_field = normalize_sort_field(&settings.default_sort_field)
        .unwrap_or(defaults.default_sort_field.as_str());
    if settings.default_sort_field != normalized_sort_field {
        settings.default_sort_field = normalized_sort_field.to_string();
        changed = true;
    }

    let normalized_sort_direction = normalize_sort_direction(&settings.default_sort_direction)
        .unwrap_or(defaults.default_sort_direction.as_str());
    if settings.default_sort_direction != normalized_sort_direction {
        settings.default_sort_direction = normalized_sort_direction.to_string();
        changed = true;
    }

    let normalized_date_time_format = normalize_date_time_format(&settings.date_time_format)
        .unwrap_or(defaults.date_time_format.as_str());
    if settings.date_time_format != normalized_date_time_format {
        settings.date_time_format = normalized_date_time_format.to_string();
        changed = true;
    }

    if !(BACKUP_MAX_COPIES_MIN..=BACKUP_MAX_COPIES_MAX).contains(&settings.backup_max_copies) {
        settings.backup_max_copies = defaults.backup_max_copies;
        changed = true;
    }

    (settings, changed)
}

pub fn get_settings(sp: &StoragePaths, profile_id: &str) -> Result<UserSettings> {
    let path = user_settings_path(sp, profile_id)?;
    if !path.exists() {
        let defaults = UserSettings::default();
        let serialized = serde_json::to_string_pretty(&defaults)
            .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))?;
        write_atomic(&path, serialized.as_bytes())
            .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))?;
        return Ok(defaults);
    }

    let content = fs::read_to_string(&path).map_err(|_| ErrorCodeString::new("SETTINGS_READ"))?;
    let parsed: UserSettings =
        serde_json::from_str(&content).map_err(|_| ErrorCodeString::new("SETTINGS_PARSE"))?;
    let (repaired, changed) = repair_settings(parsed);

    if validate_settings(&repaired).is_err() {
        log::warn!(
            "[SETTINGS] profile_id={} action=repair_failed fallback=defaults",
            profile_id
        );
        let defaults = UserSettings::default();
        if let Ok(serialized) = serde_json::to_string_pretty(&defaults) {
            let _ = write_atomic(&path, serialized.as_bytes());
        }
        return Ok(defaults);
    }

    if changed {
        log::warn!(
            "[SETTINGS] profile_id={} action=auto_repair_invalid_user_settings",
            profile_id
        );
        if let Ok(serialized) = serde_json::to_string_pretty(&repaired) {
            if let Err(err) = write_atomic(&path, serialized.as_bytes()) {
                log::warn!(
                    "[SETTINGS] profile_id={} action=auto_repair_write_failed err={}",
                    profile_id,
                    err
                );
            }
        }
    }

    Ok(repaired)
}

pub fn update_settings(
    sp: &StoragePaths,
    mut new_settings: UserSettings,
    profile_id: &str,
) -> Result<bool> {
    let defaults = UserSettings::default();
    new_settings.active_vault_id = normalize_active_vault_id(&new_settings.active_vault_id);
    new_settings.default_sort_field = normalize_sort_field(&new_settings.default_sort_field)
        .unwrap_or(defaults.default_sort_field.as_str())
        .to_string();
    new_settings.default_sort_direction =
        normalize_sort_direction(&new_settings.default_sort_direction)
            .unwrap_or(defaults.default_sort_direction.as_str())
            .to_string();
    new_settings.date_time_format = normalize_date_time_format(&new_settings.date_time_format)
        .unwrap_or(defaults.date_time_format.as_str())
        .to_string();

    validate_settings(&new_settings)?;
    let path = user_settings_path(sp, profile_id)?;
    let serialized = serde_json::to_string_pretty(&new_settings)
        .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))?;
    Ok(true)
}

pub fn resolve_active_vault_id(sp: &StoragePaths, profile_id: &str) -> Result<String> {
    let settings = get_settings(sp, profile_id)?;
    Ok(normalize_active_vault_id(&settings.active_vault_id))
}

pub fn update_settings_command(state: &Arc<AppState>, mut settings: UserSettings) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    if !settings.multiply_vaults_enabled {
        settings.active_vault_id = repo_impl::get_default_vault_id(state, &profile_id)?;
    } else {
        settings.active_vault_id = normalize_active_vault_id(&settings.active_vault_id);
    }

    let updated = update_settings(&storage_paths, settings.clone(), &profile_id)?;
    if updated {
        if let Ok(mut active_vault_id) = state.active_vault_id.lock() {
            *active_vault_id = Some(settings.active_vault_id);
        }
    }
    Ok(updated)
}

pub fn get_settings_command(state: &Arc<AppState>) -> Result<UserSettings> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    get_settings(&storage_paths, &profile_id)
}

pub fn resolve_app_theme_command(
    state: &Arc<AppState>,
    preferred_theme: Option<String>,
) -> Result<String> {
    let app_config_dir = state.app_config_dir();
    if let Some(existing) = read_app_settings(&app_config_dir) {
        return Ok(existing.theme);
    }

    let theme = preferred_theme
        .as_deref()
        .and_then(normalize_theme)
        .unwrap_or_else(|| DEFAULT_APP_THEME.to_string());

    write_app_settings(
        &app_config_dir,
        AppSettings {
            version: APP_SETTINGS_VERSION,
            theme: theme.clone(),
        },
    )?;
    Ok(theme)
}

pub fn get_app_theme_command(state: &Arc<AppState>) -> Result<String> {
    resolve_app_theme_command(state, None)
}

pub fn set_app_theme_command(state: &Arc<AppState>, theme: String) -> Result<bool> {
    let normalized_theme = normalize_theme(&theme)
        .ok_or_else(|| ErrorCodeString::new("APP_SETTINGS_VALIDATION_FAILED"))?;
    write_app_settings(
        &state.app_config_dir(),
        AppSettings {
            version: APP_SETTINGS_VERSION,
            theme: normalized_theme,
        },
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repair_settings_fixes_invalid_sort_values_to_defaults() {
        let mut settings = UserSettings::default();
        settings.default_sort_field = "invalid".to_string();
        settings.default_sort_direction = "down".to_string();

        let (repaired, changed) = repair_settings(settings);

        assert!(changed);
        assert_eq!(repaired.default_sort_field, "updated_at");
        assert_eq!(repaired.default_sort_direction, "DESC");
    }

    #[test]
    fn repair_settings_canonicalizes_sort_values() {
        let mut settings = UserSettings::default();
        settings.default_sort_field = "  TITLE ".to_string();
        settings.default_sort_direction = " asc ".to_string();

        let (repaired, changed) = repair_settings(settings);

        assert!(changed);
        assert_eq!(repaired.default_sort_field, "title");
        assert_eq!(repaired.default_sort_direction, "ASC");
    }

    #[test]
    fn repair_settings_keeps_valid_sort_values_unchanged() {
        let settings = UserSettings::default();
        let (repaired, changed) = repair_settings(settings.clone());

        assert!(!changed);
        assert_eq!(repaired.default_sort_field, settings.default_sort_field);
        assert_eq!(
            repaired.default_sort_direction,
            settings.default_sort_direction
        );
    }

    #[test]
    fn repair_settings_fixes_invalid_date_time_format_to_default() {
        let mut settings = UserSettings::default();
        settings.date_time_format = "INVALID".to_string();

        let (repaired, changed) = repair_settings(settings);

        assert!(changed);
        assert_eq!(repaired.date_time_format, "auto");
    }

    #[test]
    fn repair_settings_canonicalizes_date_time_format() {
        let mut settings = UserSettings::default();
        settings.date_time_format = "  MMDDYYYY_12H_AMPM ".to_string();

        let (repaired, changed) = repair_settings(settings);

        assert!(changed);
        assert_eq!(repaired.date_time_format, "mmddyyyy_12h_ampm");
    }

    #[test]
    fn repair_settings_resets_invalid_backup_max_copies_to_default() {
        let mut settings = UserSettings::default();
        settings.backup_max_copies = 50_000;

        let (repaired, changed) = repair_settings(settings);

        assert!(changed);
        assert_eq!(
            repaired.backup_max_copies,
            UserSettings::default().backup_max_copies
        );
    }

    #[test]
    fn validate_settings_rejects_invalid_backup_max_copies() {
        let mut settings = UserSettings::default();
        settings.backup_max_copies = 0;

        assert!(validate_settings(&settings).is_err());
    }
}
