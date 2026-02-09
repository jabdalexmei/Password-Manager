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
use crate::data::profiles::paths::attachment_file_path;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
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

pub fn remove_attachment(app: &AppHandle, attachment_id: String) -> Result<()> {
    let session = require_logged_in(app)?;
    let now = Utc::now().to_rfc3339();
    repo_impl::soft_delete_attachment(&session.state, &session.profile_id, &attachment_id, &now)?;
    security_service::request_persist_active_vault(session.state.clone());
    Ok(())
}

pub fn purge_attachment(app: &AppHandle, attachment_id: String) -> Result<()> {
    let session = require_logged_in(app)?;
    let meta = repo_impl::get_attachment(&session.state, &session.profile_id, &attachment_id)?
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))?;

    let file_path = attachment_file_path(&session.storage_paths, &session.profile_id, &meta.id)?;
    let _ = fs::remove_file(file_path);
    repo_impl::purge_attachment(&session.state, &session.profile_id, &attachment_id)?;
    security_service::request_persist_active_vault(session.state.clone());
    Ok(())
}

pub fn save_attachment_to_path(
    app: &AppHandle,
    attachment_id: String,
    target_path: String,
) -> Result<()> {
    let session = require_logged_in(app)?;
    let meta = repo_impl::get_attachment(&session.state, &session.profile_id, &attachment_id)?
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))?;
    if meta.deleted_at.is_some() {
        return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
    }

    let stored_path =
        attachment_file_path(&session.storage_paths, &session.profile_id, &meta.id)?;
    let bytes =
        fs::read(&stored_path).map_err(|_| ErrorCodeString::new("ATTACHMENT_READ_FAILED"))?;
    let output_bytes = if bytes.starts_with(&cipher::PM_ENC_MAGIC) {
        cipher::decrypt_attachment_blob(&session.profile_id, &meta.id, &session.vault_key, &bytes)?
    } else {
        bytes
    };

    let target = Path::new(&target_path);
    ensure_target_dir(target)?;
    fs::write(target, &output_bytes).map_err(|_| ErrorCodeString::new("ATTACHMENT_WRITE_FAILED"))
}

pub fn get_attachment_preview(
    app: &AppHandle,
    attachment_id: String,
) -> Result<AttachmentPreviewPayload> {
    let session = require_logged_in(app)?;
    let meta = repo_impl::get_attachment(&session.state, &session.profile_id, &attachment_id)?
        .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))?;
    if meta.deleted_at.is_some() {
        return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
    }

    if meta.byte_size as usize > MAX_PREVIEW_BYTES {
        return Err(ErrorCodeString::new("ATTACHMENT_TOO_LARGE_FOR_PREVIEW"));
    }

    let stored_path =
        attachment_file_path(&session.storage_paths, &session.profile_id, &meta.id)?;
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
