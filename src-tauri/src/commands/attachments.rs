use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::app_state::{AppState, PendingAttachmentPick, PendingPickedFile};
use crate::error::{ErrorCodeString, Result};
use crate::services::attachments_service;
use crate::types::{
    AttachmentMeta, AttachmentPickFile, AttachmentPickPayload, AttachmentPreviewPayload,
};

#[tauri::command]
pub async fn list_attachments(app: AppHandle, datacard_id: String) -> Result<Vec<AttachmentMeta>> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::list_attachments(&app, datacard_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

fn now_ms() -> Result<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .map_err(|_| ErrorCodeString::new("TIME_UNAVAILABLE"))
}

#[tauri::command]
pub async fn remove_attachment(app: AppHandle, attachment_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::remove_attachment(&app, attachment_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn purge_attachment(app: AppHandle, attachment_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::purge_attachment(&app, attachment_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

fn file_path_to_pathbuf(fp: FilePath) -> Result<std::path::PathBuf> {
    match fp {
        FilePath::Path(p) => Ok(p),
        _ => Err(ErrorCodeString::new("DIALOG_UNSUPPORTED_FILE_URI")),
    }
}

fn cleanup_stale_picks(state: &AppState, now: u128) -> Result<()> {
    const MAX_AGE_MS: u128 = 10 * 60 * 1000;
    const MAX_ENTRIES: usize = 16;

    let mut map = state
        .pending_attachment_picks
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    map.retain(|_, v| now.saturating_sub(v.created_at_ms) <= MAX_AGE_MS);
    if map.len() > MAX_ENTRIES {
        while map.len() > MAX_ENTRIES {
            if let Some(key) = map.keys().next().cloned() {
                map.remove(&key);
            } else {
                break;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn attachments_pick_files(app: AppHandle) -> Result<Option<AttachmentPickPayload>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<std::sync::Arc<AppState>>().inner().clone();
        let now = now_ms()?;
        cleanup_stale_picks(&state, now)?;

        let selection = app.dialog().file().blocking_pick_files();
        let Some(paths) = selection else {
            return Ok(None);
        };

        let mut files: Vec<PendingPickedFile> = Vec::new();
        for fp in paths {
            let path = file_path_to_pathbuf(fp)?;
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_INVALID_FILE_NAME"))?
                .to_string();
            let byte_size = std::fs::metadata(&path)
                .map(|m| m.len())
                .map_err(|_| ErrorCodeString::new("ATTACHMENT_READ_FAILED"))?;
            files.push(PendingPickedFile {
                id: Uuid::new_v4().to_string(),
                path,
                file_name,
                byte_size,
            });
        }

        if files.is_empty() {
            return Ok(None);
        }

        let token = Uuid::new_v4().to_string();
        {
            let mut map = state
                .pending_attachment_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.insert(
                token.clone(),
                PendingAttachmentPick {
                    created_at_ms: now,
                    files: files.clone(),
                },
            );
        }

        let payload = AttachmentPickPayload {
            token,
            files: files
                .into_iter()
                .map(|f| AttachmentPickFile {
                    id: f.id,
                    file_name: f.file_name,
                    byte_size: f.byte_size as i64,
                })
                .collect(),
        };
        Ok(Some(payload))
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn attachments_discard_pick(app: AppHandle, token: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<std::sync::Arc<AppState>>().inner().clone();
        let mut map = state
            .pending_attachment_picks
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        map.remove(&token);
        Ok(())
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn add_attachments_from_pick(
    app: AppHandle,
    datacard_id: String,
    token: String,
    file_ids: Option<Vec<String>>,
) -> Result<Vec<AttachmentMeta>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<std::sync::Arc<AppState>>().inner().clone();
        let pick = {
            let mut map = state
                .pending_attachment_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.remove(&token)
                .ok_or_else(|| ErrorCodeString::new("ATTACHMENT_PICK_NOT_FOUND"))?
        };

        let wanted: Option<std::collections::HashSet<String>> =
            file_ids.map(|ids| ids.into_iter().collect());

        let mut out: Vec<AttachmentMeta> = Vec::new();
        for f in pick.files {
            if let Some(set) = &wanted {
                if !set.contains(&f.id) {
                    continue;
                }
            }
            let meta =
                attachments_service::add_attachment_from_fs_path(&app, datacard_id.clone(), &f.path)?;
            out.push(meta);
        }
        Ok(out)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn add_attachments_via_dialog(
    app: AppHandle,
    datacard_id: String,
) -> Result<Vec<AttachmentMeta>> {
    tauri::async_runtime::spawn_blocking(move || {
        let selection = app.dialog().file().blocking_pick_files();
        let Some(paths) = selection else {
            return Ok(Vec::new());
        };

        let mut out: Vec<AttachmentMeta> = Vec::new();
        for fp in paths {
            let path = file_path_to_pathbuf(fp)?;
            let meta =
                attachments_service::add_attachment_from_fs_path(&app, datacard_id.clone(), &path)?;
            out.push(meta);
        }
        Ok(out)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn save_attachment_via_dialog(app: AppHandle, attachment_id: String) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let preview = attachments_service::get_attachment_preview(&app, attachment_id.clone())?;
        let default_name = preview.file_name.clone();

        let selection = app
            .dialog()
            .file()
            .set_file_name(default_name)
            .blocking_save_file();

        let Some(fp) = selection else {
            return Ok(false);
        };

        let target = file_path_to_pathbuf(fp)?;
        attachments_service::save_attachment_to_path(
            &app,
            attachment_id,
            target.to_string_lossy().to_string(),
        )?;
        Ok(true)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_attachment_preview(
    app: AppHandle,
    attachment_id: String,
) -> Result<AttachmentPreviewPayload> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::get_attachment_preview(&app, attachment_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_attachment_bytes_base64(
    app: AppHandle,
    attachment_id: String,
) -> Result<AttachmentPreviewPayload> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::get_attachment_bytes_base64(&app, attachment_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
