use crate::data::crypto::kdf::{derive_master_key, generate_kdf_salt};
use crate::data::crypto::key_check;
use crate::data::crypto::master_key;
use crate::data::fs::atomic_write::write_atomic;
use crate::data::profiles::paths::{ensure_profile_dirs, kdf_salt_path};
use crate::data::profiles::registry;
use crate::data::settings::config;
use crate::data::sqlite::init::init_database_protected_encrypted;
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};
use crate::services::settings_service::get_settings;
use crate::types::{ProfileMeta, ProfilesList};
use std::fs;
use zeroize::Zeroizing;

pub fn list_profiles(sp: &StoragePaths) -> Result<ProfilesList> {
    let profiles = registry::list_profiles(sp)?;
    Ok(ProfilesList { profiles })
}

pub fn create_profile(
    sp: &StoragePaths,
    name: &str,
    password: Option<String>,
) -> Result<ProfileMeta> {
    if name.trim().is_empty() {
        return Err(ErrorCodeString::new("PROFILE_NAME_REQUIRED"));
    }

    if let Some(pwd) = password.as_ref() {
        if pwd.chars().all(|c| c.is_whitespace()) {
            return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
        }
    }
    let profile = registry::create_profile(sp, name, password.clone())?;

    let init_result: Result<()> = (|| {
        let is_passwordless = password.as_ref().map(|p| p.is_empty()).unwrap_or(true);
        ensure_profile_dirs(sp, &profile.id, !is_passwordless)
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

        // New security model: vault.db is ALWAYS an encrypted blob on disk.
        // Password vs passwordless only changes how the master key is wrapped:
        //   - password mode: master key is wrapped by a KDF-derived wrapping key (vault_key.bin + salt + key_check)
        //   - passwordless: master key is stored unwrapped for portability (vault_key.bin)

        let mk = master_key::generate_master_key();
        init_database_protected_encrypted(sp, &profile.id, &mk)?;

        if is_passwordless {
            master_key::write_master_key_unwrapped(sp, &profile.id, &mk)?;
        } else {
            let salt = generate_kdf_salt();
            let salt_path = kdf_salt_path(sp, &profile.id)?;
            write_atomic(&salt_path, &salt)
                .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
            let pwd = password.unwrap_or_default();
            let wrapping = Zeroizing::new(derive_master_key(&pwd, &salt)?);
            key_check::create_key_check_file(sp, &profile.id, &wrapping)?;
            master_key::write_master_key_wrapped_with_password(sp, &profile.id, &wrapping, &mk)?;
        }

        let _ = get_settings(sp, &profile.id)?;
        Ok(())
    })();

    if let Err(err) = init_result {
        let _ = registry::delete_profile(sp, &profile.id);
        if let Ok(dir) = crate::data::profiles::paths::profile_dir(sp, &profile.id) {
            let _ = fs::remove_dir_all(dir);
        }
        return Err(err);
    }

    Ok(profile)
}

pub fn delete_profile(sp: &StoragePaths, id: &str) -> Result<bool> {
    registry::delete_profile(sp, id)
}

pub fn rename_profile(sp: &StoragePaths, id: &str, name: &str) -> Result<ProfileMeta> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ErrorCodeString::new("PROFILE_NAME_REQUIRED"));
    }
    registry::rename_profile(sp, id, trimmed)
}

pub fn get_active_profile(sp: &StoragePaths) -> Result<Option<ProfileMeta>> {
    let settings = config::load_settings(sp)?;
    if let Some(id) = settings.active_profile {
        if let Some(record) = registry::get_profile(sp, &id)? {
            return Ok(Some(record.into()));
        }
    }
    Ok(None)
}

pub fn set_active_profile(sp: &StoragePaths, id: &str) -> Result<bool> {
    let mut settings = config::load_settings(sp)?;
    settings.active_profile = Some(id.to_string());
    config::save_settings(sp, &settings)?;
    Ok(true)
}
