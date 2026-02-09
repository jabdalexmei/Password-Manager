use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};

fn validate_profile_id(id: &str) -> Result<()> {
    if id.trim().is_empty() {
        return Err(ErrorCodeString::new("PROFILE_ID_INVALID"));
    }

    // Profile IDs are used as directory names under the workspace storage.
    // Reject anything that looks like a path (separators, prefixes, parent dirs, etc).
    let p = Path::new(id);
    let mut components = p.components();

    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(ErrorCodeString::new("PROFILE_ID_INVALID")),
    }
}

#[cfg(windows)]
fn set_dir_private(path: &Path) -> std::io::Result<()> {
    use std::ffi::OsString;
    use std::process::{Command, Stdio};
    // On Windows, hide any console window when invoking external commands.
    // `creation_flags(0x08000000)` sets CREATE_NO_WINDOW so that icacls.exe
    // doesn't steal focus or flash a console. See
    // https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
    use std::os::windows::process::CommandExt;

    // Harden directory ACLs on Windows:
    // - remove inherited ACEs
    // - grant ONLY: current user + LocalSystem (SID S-1-5-18)
    // We call icacls.exe directly to avoid PATH hijacking.
    // NOTE: This is best-effort but intentionally returns an error on failure.

    let icacls = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("icacls.exe"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows").join("System32").join("icacls.exe"));

    if !icacls.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "set_dir_private: icacls.exe not found",
        ));
    }

    // Use DOMAIN\\User if available, otherwise fallback to USERNAME.
    let username = std::env::var_os("USERNAME").unwrap_or_default();
    let userdomain = std::env::var_os("USERDOMAIN").unwrap_or_default();
    let principal: OsString = if !userdomain.is_empty() && !username.is_empty() {
        let mut s = OsString::new();
        s.push(userdomain);
        s.push("\\");
        s.push(username);
        s
    } else {
        username
    };

    if principal.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "set_dir_private: unable to resolve current user principal",
        ));
    }

    let mut user_grant = principal.clone();
    user_grant.push(":(OI)(CI)F");
    let system_grant: OsString = "*S-1-5-18:(OI)(CI)F".into();

    // Remove common broad SIDs (Everyone / Authenticated Users / BUILTIN\\Users).
    // Using well-known SIDs avoids localization issues.
    let output = Command::new(&icacls)
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(user_grant)
        .arg("/grant:r")
        .arg(system_grant)
        .arg("/remove")
        .arg("*S-1-1-0")
        .arg("*S-1-5-11")
        .arg("*S-1-5-32-545")
        .arg("/c")
        // Suppress any console window when executing icacls.exe
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    if !output.status.success() {
        let mut msg = String::from("icacls failed");
        if !output.stdout.is_empty() {
            msg.push_str(": ");
            msg.push_str(&String::from_utf8_lossy(&output.stdout));
        }
        if !output.stderr.is_empty() {
            msg.push_str(" ");
            msg.push_str(&String::from_utf8_lossy(&output.stderr));
        }
        return Err(std::io::Error::new(std::io::ErrorKind::Other, msg));
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_dir_private(_path: &Path) -> std::io::Result<()> {
    Ok(())
}


pub fn profiles_root(sp: &StoragePaths) -> Result<PathBuf> {
    Ok(sp.profiles_root()?.to_path_buf())
}

pub fn ensure_profiles_dir(sp: &StoragePaths) -> Result<PathBuf> {
    let dir = profiles_root(sp)?;
    std::fs::create_dir_all(&dir)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_UNAVAILABLE"))?;
    Ok(dir)
}

pub fn profile_dir(sp: &StoragePaths, id: &str) -> Result<PathBuf> {
    validate_profile_id(id)?;
    Ok(profiles_root(sp)?.join(id))
}

pub fn vault_db_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("vault.db"))
}

pub fn kdf_salt_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("kdf_salt.bin"))
}

pub fn key_check_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("key_check.bin"))
}

pub fn vault_key_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("vault_key.bin"))
}

pub fn attachment_file_path(
    sp: &StoragePaths,
    profile_id: &str,
    attachment_id: &str,
) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?
        .join("attachments")
        .join(format!("{attachment_id}.bin")))
}

pub fn user_settings_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("user_settings.json"))
}

pub fn backups_dir(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, profile_id)?.join("backups"))
}

pub fn backup_registry_path(sp: &StoragePaths, profile_id: &str) -> Result<PathBuf> {
    Ok(backups_dir(sp, profile_id)?.join("registry.json"))
}

pub fn registry_path(sp: &StoragePaths) -> Result<PathBuf> {
    Ok(profiles_root(sp)?.join("registry.json"))
}

pub fn profile_config_path(sp: &StoragePaths, id: &str) -> Result<PathBuf> {
    Ok(profile_dir(sp, id)?.join("config.json"))
}

pub fn ensure_profile_dirs(sp: &StoragePaths, profile_id: &str, has_password: bool) -> Result<()> {
    let root = profile_dir(sp, profile_id)?;

    fs::create_dir_all(&root)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    if has_password {
        set_dir_private(&root)
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    }
    for sub in ["attachments", "backups", "tmp"] {
        let dir = root.join(sub);
        fs::create_dir_all(&dir)
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        if has_password {
            set_dir_private(&dir)
                .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        }
    }
    Ok(())
}
