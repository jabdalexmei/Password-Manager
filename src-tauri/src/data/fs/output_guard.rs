use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};

const WORKSPACE_MARKER_FILE: &str = ".pm-workspace.json";
const WORKSPACE_LOCK_FILE: &str = ".pm-workspace.lock";

fn invalid_path(code: &str) -> ErrorCodeString {
    ErrorCodeString::new(code)
}

fn forbidden_path(code: &str) -> ErrorCodeString {
    ErrorCodeString::new(code)
}

fn validate_target_file_name<'a>(target: &'a Path, invalid_code: &str) -> Result<&'a OsStr> {
    match target.components().next_back() {
        Some(Component::Normal(name)) => Ok(name),
        _ => Err(invalid_path(invalid_code)),
    }
}

fn normalize_output_target(target: &Path, invalid_code: &str) -> Result<PathBuf> {
    let file_name = validate_target_file_name(target, invalid_code)?;

    if target.exists() {
        return std::fs::canonicalize(target).map_err(|_| invalid_path(invalid_code));
    }

    let parent = target.parent().ok_or_else(|| invalid_path(invalid_code))?;
    if !parent.exists() {
        return Err(invalid_path(invalid_code));
    }

    let parent_canonical = std::fs::canonicalize(parent).map_err(|_| invalid_path(invalid_code))?;
    Ok(parent_canonical.join(file_name))
}

#[cfg(windows)]
fn file_name_matches(name: &OsStr, expected: &str) -> bool {
    name.to_string_lossy().eq_ignore_ascii_case(expected)
}

#[cfg(not(windows))]
fn file_name_matches(name: &OsStr, expected: &str) -> bool {
    name == OsStr::new(expected)
}

fn is_workspace_metadata_target(target: &Path, workspace_root: &Path) -> bool {
    if target.parent() != Some(workspace_root) {
        return false;
    }

    let Some(file_name) = target.file_name() else {
        return false;
    };

    file_name_matches(file_name, WORKSPACE_MARKER_FILE)
        || file_name_matches(file_name, WORKSPACE_LOCK_FILE)
}

pub fn ensure_output_path_allowed(
    sp: &StoragePaths,
    target: &Path,
    invalid_code: &str,
    forbidden_code: &str,
) -> Result<PathBuf> {
    let normalized_target = normalize_output_target(target, invalid_code)?;
    let profiles_root =
        std::fs::canonicalize(sp.profiles_root()?).map_err(|_| invalid_path(invalid_code))?;
    if normalized_target.starts_with(&profiles_root) {
        return Err(forbidden_path(forbidden_code));
    }

    let workspace_root =
        std::fs::canonicalize(sp.workspace_root()?).map_err(|_| invalid_path(invalid_code))?;
    if is_workspace_metadata_target(&normalized_target, &workspace_root) {
        return Err(forbidden_path(forbidden_code));
    }

    Ok(normalized_target)
}

#[cfg(test)]
mod tests {
    use super::*;

    use tempfile::tempdir;

    fn configured_storage_paths(workspace_root: &Path) -> StoragePaths {
        let mut sp = StoragePaths::new_unconfigured().unwrap();
        sp.configure_workspace(workspace_root.to_path_buf()).unwrap();
        sp
    }

    #[test]
    fn blocks_backup_targets_inside_profile_root() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let target = sp.profiles_root().unwrap().join("p1").join("vault.db");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();

        let err = ensure_output_path_allowed(
            &sp,
            &target,
            "BACKUP_DESTINATION_UNAVAILABLE",
            "BACKUP_DESTINATION_PATH_FORBIDDEN",
        )
        .unwrap_err();

        assert_eq!(err.code, "BACKUP_DESTINATION_PATH_FORBIDDEN");
    }

    #[test]
    fn blocks_attachment_targets_inside_attachments_dir() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let target = sp
            .profiles_root()
            .unwrap()
            .join("p1")
            .join("attachments")
            .join("file.bin");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();

        let err = ensure_output_path_allowed(
            &sp,
            &target,
            "ATTACHMENT_WRITE_FAILED",
            "ATTACHMENT_TARGET_PATH_FORBIDDEN",
        )
        .unwrap_err();

        assert_eq!(err.code, "ATTACHMENT_TARGET_PATH_FORBIDDEN");
    }

    #[test]
    fn blocks_profiles_registry_targets() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let target = sp.profiles_root().unwrap().join("registry.json");

        let err = ensure_output_path_allowed(
            &sp,
            &target,
            "ATTACHMENT_WRITE_FAILED",
            "ATTACHMENT_TARGET_PATH_FORBIDDEN",
        )
        .unwrap_err();

        assert_eq!(err.code, "ATTACHMENT_TARGET_PATH_FORBIDDEN");
    }

    #[test]
    fn blocks_workspace_metadata_targets() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);

        for file_name in [WORKSPACE_MARKER_FILE, WORKSPACE_LOCK_FILE] {
            let target = workspace_root.join(file_name);
            let err = ensure_output_path_allowed(
                &sp,
                &target,
                "BACKUP_DESTINATION_UNAVAILABLE",
                "BACKUP_DESTINATION_PATH_FORBIDDEN",
            )
            .unwrap_err();

            assert_eq!(err.code, "BACKUP_DESTINATION_PATH_FORBIDDEN");
        }
    }

    #[test]
    fn allows_targets_outside_managed_storage() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        let export_root = dir.path().join("exports");
        std::fs::create_dir_all(&workspace_root).unwrap();
        std::fs::create_dir_all(&export_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let target = export_root.join("backup.pmbackup.zip");

        let normalized = ensure_output_path_allowed(
            &sp,
            &target,
            "BACKUP_DESTINATION_UNAVAILABLE",
            "BACKUP_DESTINATION_PATH_FORBIDDEN",
        )
        .unwrap();

        assert_eq!(normalized, std::fs::canonicalize(&export_root).unwrap().join("backup.pmbackup.zip"));
    }

    #[test]
    fn rejects_targets_without_existing_parent() {
        let dir = tempdir().unwrap();
        let workspace_root = dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let sp = configured_storage_paths(&workspace_root);
        let target = dir.path().join("missing").join("file.bin");

        let err = ensure_output_path_allowed(
            &sp,
            &target,
            "ATTACHMENT_WRITE_FAILED",
            "ATTACHMENT_TARGET_PATH_FORBIDDEN",
        )
        .unwrap_err();

        assert_eq!(err.code, "ATTACHMENT_WRITE_FAILED");
    }
}
