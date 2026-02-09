use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::ensure_profiles_dir;
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct UserSettings {
    pub active_profile: Option<String>,
}

fn settings_path(sp: &StoragePaths) -> Result<PathBuf> {
    ensure_profiles_dir(sp).map(|dir| dir.join("user_settings.json"))
}

pub fn load_settings(sp: &StoragePaths) -> Result<UserSettings> {
    let path = settings_path(sp)?;
    if !path.exists() {
        return Ok(UserSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|_| ErrorCodeString::new("SETTINGS_READ"))?;
    serde_json::from_str(&content).map_err(|_| ErrorCodeString::new("SETTINGS_PARSE"))
}

pub fn save_settings(sp: &StoragePaths, settings: &UserSettings) -> Result<()> {
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))?;
    let path = settings_path(sp)?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("SETTINGS_WRITE"))
}
