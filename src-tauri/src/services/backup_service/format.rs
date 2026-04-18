use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupListItem {
    pub id: String,
    pub created_at_utc: String,
    pub path: String,
    pub bytes: i64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub(super) struct BackupRegistry {
    pub(super) last_auto_backup_at_utc: Option<String>,
    pub(super) backups: Vec<BackupListItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupManifest {
    pub(super) format_version: i64,
    pub(super) created_at_utc: String,
    pub(super) app_version: String,
    pub(super) profile_id: String,
    #[serde(default)]
    pub(super) profile_name: Option<String>,
    pub(super) vault_mode: String,
    pub(super) files: Vec<BackupManifestFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupInspectResult {
    pub profile_id: String,
    pub profile_name: String,
    pub created_at_utc: String,
    pub vault_mode: String,
    pub will_overwrite: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupManifestFile {
    pub(super) path: String,
    pub(super) sha256: String,
    pub(super) bytes: i64,
}

pub(super) struct BackupSource {
    pub(super) vault_path: PathBuf,
    pub(super) attachments_path: PathBuf,
    pub(super) config_path: Option<PathBuf>,
    pub(super) settings_path: Option<PathBuf>,
    // Protected-mode files
    pub(super) kdf_salt_path: Option<PathBuf>,
    pub(super) key_check_path: Option<PathBuf>,
    pub(super) vault_key_path: Option<PathBuf>,
    pub(super) _temp_dir: Option<tempfile::TempDir>,
}

pub(super) struct BackupResult {
    pub(super) id: String,
    pub(super) created_at_utc: String,
    pub(super) path: String,
    pub(super) bytes: i64,
}

pub(super) fn load_registry(sp: &StoragePaths, profile_id: &str) -> Result<BackupRegistry> {
    let path = backup_registry_path(sp, profile_id)?;
    if !path.exists() {
        return Ok(BackupRegistry::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?;
    serde_json::from_str(&content).map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))
}

pub(super) fn save_registry(
    sp: &StoragePaths,
    profile_id: &str,
    registry: &BackupRegistry,
) -> Result<()> {
    let path = backup_registry_path(sp, profile_id)?;
    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("BACKUP_CREATE_FAILED"))
}

pub(super) fn update_registry(
    sp: &StoragePaths,
    profile_id: &str,
    update: impl FnOnce(&mut BackupRegistry),
) -> Result<()> {
    let mut registry = load_registry(sp, profile_id)?;
    update(&mut registry);
    save_registry(sp, profile_id, &registry)
}

pub(super) fn now_timestamp() -> String {
    Utc::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

pub(super) fn now_utc_string() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(super) fn read_backup_manifest_and_name(backup_path: &Path) -> Result<(BackupManifest, String)> {
    if !backup_path.exists() {
        return Err(ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"));
    }

    let archive_file =
        fs::File::open(backup_path).map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;
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

    if manifest.format_version != 1 {
        return Err(ErrorCodeString::new("BACKUP_UNSUPPORTED_FORMAT"));
    }

    if !validate_profile_id_component(&manifest.profile_id) {
        return Err(ErrorCodeString::new("BACKUP_MANIFEST_INVALID"));
    }

    if let Some(name) = manifest.profile_name.clone() {
        return Ok((manifest, name));
    }

    if let Ok(mut cfg_file) = archive.by_name("config.json") {
        let mut cfg_contents = String::new();
        if cfg_file.read_to_string(&mut cfg_contents).is_ok() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cfg_contents) {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    return Ok((manifest, name.to_string()));
                }
            }
        }
    }

    Ok((manifest, "Restored profile".to_string()))
}
