use std::fs;
use std::path::Path;
use std::sync::Arc;

use base64::engine::general_purpose;
use base64::Engine;
use chrono::Utc;
use mime_guess;
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::data::crypto::cipher;
use crate::data::fs::atomic_write::write_atomic;
use crate::data::fs::output_guard::ensure_output_path_allowed;
use crate::data::profiles::paths::attachment_file_path;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachment_file_cleanup::remove_attachment_files_best_effort;
use crate::services::security_service;
use crate::types::{AttachmentMeta, AttachmentPreviewPayload};

const MAX_ATTACHMENT_SIZE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PREVIEW_BYTES: usize = 8 * 1024 * 1024;

struct ActiveSession {
    state: Arc<AppState>,
    storage_paths: crate::data::storage_paths::StoragePaths,
    profile_id: String,
    vault_key: [u8; 32],
}

fn require_logged_in(app: &AppHandle) -> Result<ActiveSession> {
    let app_state = app.state::<Arc<AppState>>().inner().clone();
    let storage_paths = app_state.get_storage_paths()?;
    let info = security_service::require_unlocked_active_profile(&app_state)?;

    Ok(ActiveSession {
        state: app_state,
        storage_paths,
        profile_id: info.profile_id,
        vault_key: info.vault_key,
    })
}

fn read_source_file(path: &Path) -> Result<Vec<u8>> {
    let metadata =
        fs::metadata(path).map_err(|_| ErrorCodeString::new("ATTACHMENT_SOURCE_NOT_FOUND"))?;
    if !metadata.is_file() {
        return Err(ErrorCodeString::new("ATTACHMENT_SOURCE_NOT_FOUND"));
    }
    if metadata.len() > MAX_ATTACHMENT_SIZE_BYTES {
        return Err(ErrorCodeString::new("ATTACHMENT_TOO_LARGE"));
    }

    fs::read(path).map_err(|_| ErrorCodeString::new("ATTACHMENT_READ_FAILED"))
}

fn ensure_target_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| ErrorCodeString::new("ATTACHMENT_WRITE_FAILED"))?;
    }
    Ok(())
}

fn get_attachment_meta_by_profile(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
) -> Result<AttachmentMeta> {
    let meta = repo_impl::get_attachment(state, profile_id, attachment_id)?
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))?;
    if meta.deleted_at.is_some() {
        return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
    }
    Ok(meta)
}

fn save_attachment_to_output_path_by_profile(
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    vault_key: &[u8; 32],
    attachment_id: &str,
    target_path: &Path,
) -> Result<()> {
    let stored_path = attachment_file_path(storage_paths, profile_id, attachment_id)?;
    let bytes =
        fs::read(&stored_path).map_err(|_| ErrorCodeString::new("ATTACHMENT_READ_FAILED"))?;
    let output_bytes = if bytes.starts_with(&cipher::PM_ENC_MAGIC) {
        cipher::decrypt_attachment_blob(profile_id, attachment_id, vault_key, &bytes)?
    } else {
        bytes
    };

    let target = ensure_output_path_allowed(
        storage_paths,
        target_path,
        "ATTACHMENT_WRITE_FAILED",
        "ATTACHMENT_TARGET_PATH_FORBIDDEN",
    )?;
    ensure_target_dir(&target)?;
    fs::write(&target, &output_bytes).map_err(|_| ErrorCodeString::new("ATTACHMENT_WRITE_FAILED"))
}

pub fn add_attachment_from_fs_path(
    app: &AppHandle,
    datacard_id: String,
    source: &Path,
) -> Result<AttachmentMeta> {
    let session = require_logged_in(app)?;
    if source.file_name().is_none() {
        return Err(ErrorCodeString::new("ATTACHMENT_SOURCE_NOT_FOUND"));
    }

    // Validate datacard exists for this profile
    let _ = repo_impl::get_datacard(&session.state, &session.profile_id, &datacard_id)?;

    let bytes = read_source_file(source)?;
    let attachment_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let file_name = source
        .file_name()
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_INVALID_SOURCE_PATH"))?
        .to_string_lossy()
        .to_string();
    let mime = mime_guess::from_path(&file_name)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    let meta = AttachmentMeta {
        id: attachment_id.clone(),
        datacard_id,
        file_name,
        mime_type: Some(mime),
        byte_size: bytes.len() as i64,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };

    let file_path = attachment_file_path(&session.storage_paths, &session.profile_id, &meta.id)?;
    ensure_target_dir(&file_path)?;

    let encrypted =
        cipher::encrypt_attachment_blob(&session.profile_id, &meta.id, &session.vault_key, &bytes)?;
    write_atomic(&file_path, &encrypted)
        .map_err(|_| ErrorCodeString::new("ATTACHMENT_WRITE_FAILED"))?;

    repo_impl::insert_attachment(&session.state, &session.profile_id, &meta)?;

    security_service::request_persist_active_vault(session.state.clone());

    Ok(meta)
}

pub fn list_attachments(app: &AppHandle, datacard_id: String) -> Result<Vec<AttachmentMeta>> {
    let session = require_logged_in(app)?;
    repo_impl::list_attachments_by_datacard(&session.state, &session.profile_id, &datacard_id)
}

fn validate_file_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ErrorCodeString::new("ATTACHMENT_INVALID_FILE_NAME"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(ErrorCodeString::new("ATTACHMENT_INVALID_FILE_NAME"));
    }
    if trimmed.len() > 255 {
        return Err(ErrorCodeString::new("ATTACHMENT_INVALID_FILE_NAME"));
    }
    Ok(trimmed.to_string())
}

pub fn rename_attachment(
    app: &AppHandle,
    attachment_id: String,
    file_name: String,
) -> Result<AttachmentMeta> {
    let session = require_logged_in(app)?;
    let _ = get_attachment_meta_by_profile(&session.state, &session.profile_id, &attachment_id)?;

    let cleaned = validate_file_name(&file_name)?;
    let now = Utc::now().to_rfc3339();
    repo_impl::rename_attachment(
        &session.state,
        &session.profile_id,
        &attachment_id,
        &cleaned,
        &now,
    )?;
    security_service::request_persist_active_vault(session.state.clone());

    repo_impl::get_attachment(&session.state, &session.profile_id, &attachment_id)?
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))
}

pub fn remove_attachment(app: &AppHandle, attachment_id: String) -> Result<()> {
    let session = require_logged_in(app)?;
    let now = Utc::now().to_rfc3339();
    repo_impl::soft_delete_attachment(&session.state, &session.profile_id, &attachment_id, &now)?;
    security_service::request_persist_active_vault(session.state.clone());
    Ok(())
}

pub fn purge_attachment(app: &AppHandle, attachment_id: String) -> Result<()> {
    let session = require_logged_in(app)?;
    purge_attachment_by_profile(
        &session.state,
        &session.storage_paths,
        &session.profile_id,
        &attachment_id,
    )?;
    security_service::request_persist_active_vault(session.state.clone());
    Ok(())
}

pub(crate) fn purge_attachment_by_profile(
    state: &Arc<AppState>,
    storage_paths: &crate::data::storage_paths::StoragePaths,
    profile_id: &str,
    attachment_id: &str,
) -> Result<()> {
    let meta = repo_impl::purge_attachment_and_get_meta(state, profile_id, attachment_id)?;
    remove_attachment_files_best_effort(storage_paths, profile_id, std::slice::from_ref(&meta.id));
    Ok(())
}

pub fn save_attachment_to_path(
    app: &AppHandle,
    attachment_id: String,
    target_path: String,
) -> Result<()> {
    let session = require_logged_in(app)?;
    let _ = get_attachment_meta_by_profile(&session.state, &session.profile_id, &attachment_id)?;
    save_attachment_to_output_path_by_profile(
        &session.storage_paths,
        &session.profile_id,
        &session.vault_key,
        &attachment_id,
        Path::new(&target_path),
    )
}

pub fn get_attachment_file_name(app: &AppHandle, attachment_id: String) -> Result<String> {
    let session = require_logged_in(app)?;
    let meta = get_attachment_meta_by_profile(&session.state, &session.profile_id, &attachment_id)?;
    Ok(meta.file_name)
}

pub fn get_attachment_preview(
    app: &AppHandle,
    attachment_id: String,
) -> Result<AttachmentPreviewPayload> {
    let session = require_logged_in(app)?;
    let meta = get_attachment_meta_by_profile(&session.state, &session.profile_id, &attachment_id)?;

    if meta.byte_size as usize > MAX_PREVIEW_BYTES {
        return Err(ErrorCodeString::new("ATTACHMENT_TOO_LARGE_FOR_PREVIEW"));
    }

    let stored_path = attachment_file_path(&session.storage_paths, &session.profile_id, &meta.id)?;
    let bytes =
        fs::read(&stored_path).map_err(|_| ErrorCodeString::new("ATTACHMENT_READ_FAILED"))?;

    let output_bytes = if bytes.starts_with(&cipher::PM_ENC_MAGIC) {
        cipher::decrypt_attachment_blob(&session.profile_id, &meta.id, &session.vault_key, &bytes)?
    } else {
        bytes
    };

    if output_bytes.len() > MAX_PREVIEW_BYTES {
        return Err(ErrorCodeString::new("ATTACHMENT_TOO_LARGE_FOR_PREVIEW"));
    }

    let mime = meta
        .mime_type
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let base64_data = general_purpose::STANDARD.encode(output_bytes);

    Ok(AttachmentPreviewPayload {
        attachment_id: meta.id,
        file_name: meta.file_name,
        mime_type: mime,
        byte_size: meta.byte_size,
        base64_data,
    })
}

pub fn get_attachment_bytes_base64(
    app: &AppHandle,
    attachment_id: String,
) -> Result<AttachmentPreviewPayload> {
    get_attachment_preview(app, attachment_id)
}

pub fn clear_previews_for_profile(_state: &Arc<AppState>, _profile_id: &str) -> Result<()> {
    // Attachment previews are currently streamed to the UI as base64 payloads.
    // There is no on-disk preview cache to clear.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::data::sqlite::repo_impl;
    use crate::services::test_support::ServiceTestHarness;

    #[test]
    fn purge_attachment_removes_db_row_and_blob() {
        let harness = ServiceTestHarness::new();
        let card = harness.create_datacard("Card", None, None);
        let attachment = harness.create_attachment(&card.id, "att-1");
        let file_path = harness.attachment_path(&attachment.id);

        purge_attachment_by_profile(
            &harness.state,
            &harness.storage_paths(),
            &harness.profile_id,
            &attachment.id,
        )
        .unwrap();

        assert!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &attachment.id)
                .unwrap()
                .is_none()
        );
        assert!(!file_path.exists());
    }

    #[test]
    fn purge_attachment_succeeds_when_blob_is_already_missing() {
        let harness = ServiceTestHarness::new();
        let card = harness.create_datacard("Card", None, None);
        let attachment = harness.create_attachment(&card.id, "att-missing");
        let file_path = harness.attachment_path(&attachment.id);
        std::fs::remove_file(&file_path).unwrap();

        purge_attachment_by_profile(
            &harness.state,
            &harness.storage_paths(),
            &harness.profile_id,
            &attachment.id,
        )
        .unwrap();

        assert!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &attachment.id)
                .unwrap()
                .is_none()
        );
        assert!(!file_path.exists());
    }

    #[test]
    fn save_attachment_by_profile_supports_files_larger_than_preview_limit() {
        let harness = ServiceTestHarness::new();
        let card = harness.create_datacard("Card", None, None);
        let attachment_id = "att-large-save";
        let large_bytes = vec![42u8; MAX_PREVIEW_BYTES + 1];
        let meta = AttachmentMeta {
            id: attachment_id.to_string(),
            datacard_id: card.id.clone(),
            file_name: "large.bin".to_string(),
            mime_type: Some("application/octet-stream".to_string()),
            byte_size: large_bytes.len() as i64,
            created_at: "2026-03-28T00:00:00Z".to_string(),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
            deleted_at: None,
        };

        repo_impl::insert_attachment(&harness.state, &harness.profile_id, &meta).unwrap();
        fs::write(harness.attachment_path(attachment_id), &large_bytes).unwrap();

        let save_target = harness
            .storage_paths()
            .workspace_root()
            .unwrap()
            .join("exports")
            .join("large.bin");
        fs::create_dir_all(save_target.parent().unwrap()).unwrap();

        let looked_up =
            get_attachment_meta_by_profile(&harness.state, &harness.profile_id, &meta.id).unwrap();
        assert_eq!(looked_up.file_name, "large.bin");
        assert!(looked_up.byte_size as usize > MAX_PREVIEW_BYTES);

        save_attachment_to_output_path_by_profile(
            &harness.storage_paths(),
            &harness.profile_id,
            &[7u8; 32],
            &meta.id,
            &save_target,
        )
        .unwrap();

        assert_eq!(fs::read(&save_target).unwrap(), large_bytes);
    }
}
