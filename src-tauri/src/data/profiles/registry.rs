use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use uuid::Uuid;

use crate::data::crypto::cipher::PM_ENC_MAGIC;
use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::{
    ensure_profiles_dir,
    profile_config_path,
    profile_dir,
    registry_path,
    vault_key_path,
};
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};
use crate::types::ProfileMeta;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileRecord {
    pub id: String,
    pub name: String,
    pub has_password: bool,
}

impl From<ProfileRecord> for ProfileMeta {
    fn from(value: ProfileRecord) -> Self {
        ProfileMeta {
            id: value.id,
            name: value.name,
            has_password: value.has_password,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProfileRegistry {
    pub profiles: Vec<ProfileRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingProfileRename {
    // For debugging/introspection; recovery primarily trusts the directory name.
    profile_id: String,
    old_name: String,
    new_name: String,
}

const PENDING_RENAME_FILENAME: &str = "rename_profile.pending.json";

fn pending_rename_path(profile_root: &std::path::Path) -> PathBuf {
    profile_root.join("tmp").join(PENDING_RENAME_FILENAME)
}

fn recover_pending_profile_renames(
    sp: &StoragePaths,
    registry: &mut ProfileRegistry,
) -> Result<bool> {
    let root = ensure_profiles_dir(sp)?;
    let mut dirty = false;

    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(false),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let id = match p.file_name().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        let profile_root = match profile_dir(sp, id) {
            Ok(dir) => dir,
            Err(_) => continue,
        };

        let pending_path = pending_rename_path(&profile_root);
        if !pending_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&pending_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let pending: PendingProfileRename = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let desired_name = pending.new_name;

        // Ensure config.json reflects the desired rename.
        let config_path = profile_root.join("config.json");
        let config = serde_json::json!({ "name": desired_name.clone() });
        if let Ok(serialized) = serde_json::to_string_pretty(&config) {
            let _ = write_atomic(&config_path, serialized.as_bytes());
        }

        // Ensure registry.json reflects the desired rename.
        if let Some(existing) = registry.profiles.iter_mut().find(|r| r.id == id) {
            if existing.name != desired_name {
                existing.name = desired_name.clone();
                dirty = true;
            }
        } else {
            registry.profiles.push(ProfileRecord {
                id: id.to_string(),
                name: desired_name.clone(),
                has_password: infer_has_password(sp, id, false),
            });
            dirty = true;
        }

        let _ = fs::remove_file(&pending_path);
    }

    Ok(dirty)
}

fn load_registry(sp: &StoragePaths) -> Result<ProfileRegistry> {
    ensure_profiles_dir(sp)?;
    let path = registry_path(sp)?;

    let mut registry: ProfileRegistry = if path.exists() {
        let content =
            fs::read_to_string(&path).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
        serde_json::from_str(&content).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_PARSE"))?
    } else {
        ProfileRegistry::default()
    };

    let mut dirty = false;

    // Crash-safe completion for rename_profile.
    dirty |= recover_pending_profile_renames(sp, &mut registry)?;

    // Self-heal has_password based on on-disk evidence.
    for rec in registry.profiles.iter_mut() {
        let inferred = infer_has_password(sp, &rec.id, rec.has_password);
        if inferred != rec.has_password {
            rec.has_password = inferred;
            dirty = true;
        }
    }

    if dirty {
        // Best-effort self-heal; even if it fails, we still return inferred values.
        let _ = save_registry(sp, &registry);
    }

    Ok(registry)
}

fn save_registry(sp: &StoragePaths, registry: &ProfileRegistry) -> Result<()> {
    let path = registry_path(sp)?;
    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|_| ErrorCodeString::new("PROFILE_REGISTRY_SERIALIZATION_FAILED"))?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))
}

const MASTER_KEY_PREFIX: [u8; 6] = *b"PMMK1:";

fn infer_has_password(sp: &StoragePaths, id: &str, record_has_password: bool) -> bool {
    // Current model:
    // - vault.db is always encrypted on disk.
    // - password mode is determined by an *encrypted* vault_key.bin (PMENC1...)
    // - passwordless portable mode stores the master key *unwrapped* in vault_key.bin (PMMK1:...)
    if let Ok(path) = vault_key_path(sp, id) {
        if path.exists() {
            if let Ok(mut f) = fs::File::open(&path) {
                let mut buf = [0u8; 6];
                if f.read_exact(&mut buf).is_ok() {
                    if buf == PM_ENC_MAGIC {
                        return true;
                    }
                    if buf == MASTER_KEY_PREFIX {
                        return false;
                    }
                }
            }
        }
    }

    record_has_password
}

pub fn list_profiles(sp: &StoragePaths) -> Result<Vec<ProfileMeta>> {
    let registry = load_registry(sp)?;
    Ok(registry.profiles.into_iter().map(ProfileMeta::from).collect())
}

pub fn create_profile(
    sp: &StoragePaths,
    name: &str,
    password: Option<String>,
) -> Result<ProfileMeta> {
    ensure_profiles_dir(sp)?;
    let id = Uuid::new_v4().to_string();
    let has_password = password
        .as_ref()
        .map(|p| !p.chars().all(|c| c.is_whitespace()))
        .unwrap_or(false);

    let record = ProfileRecord {
        id: id.clone(),
        name: name.to_string(),
        has_password,
    };

    let profile_dir = crate::data::profiles::paths::profile_dir(sp, &id)?;
    crate::data::profiles::paths::ensure_profile_dirs(sp, &id, has_password)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let config_path: PathBuf = profile_config_path(sp, &id)?;
    let config = serde_json::json!({ "name": name });
    let serialized_config = serde_json::to_string_pretty(&config)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    if write_atomic(&config_path, serialized_config.as_bytes()).is_err() {
        let _ = fs::remove_dir_all(&profile_dir);
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let mut registry = match load_registry(sp) {
        Ok(registry) => registry,
        Err(err) => {
            let _ = fs::remove_dir_all(&profile_dir);
            return Err(err);
        }
    };
    registry.profiles.push(record.clone());
    if let Err(err) = save_registry(sp, &registry) {
        let _ = fs::remove_dir_all(&profile_dir);
        return Err(err);
    }

    Ok(record.into())
}

/// Create (or update) a profile record using a caller-provided profile_id.
/// This is used by restore-from-backup: encrypted data is bound to profile_id via AEAD AAD,
/// so we must recreate the same id to be able to decrypt restored vault/attachments.
pub fn upsert_profile_with_id(
    sp: &StoragePaths,
    id: &str,
    name: &str,
    has_password: bool,
) -> Result<ProfileMeta> {
    ensure_profiles_dir(sp)?;

    // Ensure profile dirs exist (id is used as folder name).
    let profile_dir = crate::data::profiles::paths::profile_dir(sp, id)?;
    let existed_before = profile_dir.exists();
    crate::data::profiles::paths::ensure_profile_dirs(sp, id, has_password)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    // Write config.json with the name (keeps UI consistent).
    let config_path: PathBuf = profile_config_path(sp, id)?;
    let config = serde_json::json!({ "name": name });
    let serialized_config = serde_json::to_string_pretty(&config)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    if write_atomic(&config_path, serialized_config.as_bytes()).is_err() {
        // Never delete an existing profile directory on config write failure.
        if !existed_before && profile_dir.exists() {
            let _ = fs::remove_dir_all(&profile_dir);
        }
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let mut registry = load_registry(sp)?;
    if let Some(existing) = registry.profiles.iter_mut().find(|p| p.id == id) {
        existing.name = name.to_string();
        existing.has_password = has_password;
        save_registry(sp, &registry)?;
        return Ok(ProfileMeta {
            id: id.to_string(),
            name: name.to_string(),
            has_password,
        });
    }

    registry.profiles.push(ProfileRecord {
        id: id.to_string(),
        name: name.to_string(),
        has_password,
    });
    save_registry(sp, &registry)?;

    Ok(ProfileMeta {
        id: id.to_string(),
        name: name.to_string(),
        has_password,
    })
}

pub fn rename_profile(sp: &StoragePaths, id: &str, name: &str) -> Result<ProfileMeta> {
    ensure_profiles_dir(sp)?;
    let mut registry = load_registry(sp)?;
    let idx = registry
        .profiles
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    let old_name = registry.profiles[idx].name.clone();

    // Crash-safe rename:
    // - create a pending marker under profile/tmp
    // - write config.json
    // - write registry.json
    // - remove pending marker
    // If we crash mid-way, load_registry will complete the rename on the next start.
    let profile_root = profile_dir(sp, id)?;
    let tmp_dir = profile_root.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let pending_path = pending_rename_path(&profile_root);
    let pending = PendingProfileRename {
        profile_id: id.to_string(),
        old_name: old_name.clone(),
        new_name: name.to_string(),
    };
    let pending_serialized = serde_json::to_string_pretty(&pending)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    if let Err(_) = write_atomic(&pending_path, pending_serialized.as_bytes()) {
        let _ = fs::remove_file(&pending_path);
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    // Write profile config first so we never persist a registry change without a matching config.
    let config_path: PathBuf = profile_config_path(sp, id)?;
    let config = serde_json::json!({ "name": name });
    let serialized_config = serde_json::to_string_pretty(&config)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    if let Err(_) = write_atomic(&config_path, serialized_config.as_bytes()) {
        let _ = fs::remove_file(&pending_path);
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    // Now update registry and persist.
    registry.profiles[idx].name = name.to_string();

    let meta = ProfileMeta {
        id: registry.profiles[idx].id.clone(),
        name: registry.profiles[idx].name.clone(),
        has_password: infer_has_password(
            sp,
            &registry.profiles[idx].id,
            registry.profiles[idx].has_password,
        ),
    };

    if let Err(e) = save_registry(sp, &registry) {
        let _ = fs::remove_file(&pending_path);
        return Err(e);
    }

    let _ = fs::remove_file(&pending_path);

    Ok(meta)
}

pub fn delete_profile(sp: &StoragePaths, id: &str) -> Result<bool> {
    ensure_profiles_dir(sp)?;
    let mut registry = load_registry(sp)?;
    let original_len = registry.profiles.len();
    registry.profiles.retain(|p| p.id != id);
    if registry.profiles.len() == original_len {
        return Err(ErrorCodeString::new("PROFILE_NOT_FOUND"));
    }
    save_registry(sp, &registry)?;
    let dir = crate::data::profiles::paths::profile_dir(sp, id)?;
    if dir.exists() {
        let _ = fs::remove_dir_all(dir);
    }
    Ok(true)
}

pub fn get_profile(sp: &StoragePaths, id: &str) -> Result<Option<ProfileRecord>> {
    let registry = load_registry(sp)?;
    let idx = match registry.profiles.iter().position(|p| p.id == id) {
        Some(i) => i,
        None => return Ok(None),
    };
    Ok(Some(registry.profiles[idx].clone()))
}
