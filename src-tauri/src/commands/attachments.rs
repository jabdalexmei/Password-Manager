use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Window};
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
pub async fn rename_attachment(
    app: AppHandle,
    attachment_id: String,
    file_name: String,
) -> Result<AttachmentMeta> {
    tauri::async_runtime::spawn_blocking(move || {
        attachments_service::rename_attachment(&app, attachment_id, file_name)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
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

fn build_pending_files(paths: Vec<std::path::PathBuf>) -> Result<Vec<PendingPickedFile>> {
    let mut files: Vec<PendingPickedFile> = Vec::new();
    for path in paths {
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
    Ok(files)
}

fn stage_attachment_pick_from_paths(
    state: &AppState,
    paths: Vec<std::path::PathBuf>,
) -> Result<Option<AttachmentPickPayload>> {
    let now = now_ms()?;
    cleanup_stale_picks(state, now)?;

    let files = build_pending_files(paths)?;
    if files.is_empty() {
        return Ok(None);
    }

    let token = Uuid::new_v4().to_string();
    let payload_files: Vec<AttachmentPickFile> = files
        .iter()
        .map(|f| AttachmentPickFile {
            id: f.id.clone(),
            file_name: f.file_name.clone(),
            byte_size: f.byte_size as i64,
        })
        .collect();

    {
        let mut map = state
            .pending_attachment_picks
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        map.insert(
            token.clone(),
            PendingAttachmentPick {
                created_at_ms: now,
                files,
            },
        );
    }

    Ok(Some(AttachmentPickPayload {
        token,
        files: payload_files,
    }))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AttachmentsDndPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AttachmentsDndDropPickedPayload {
    pub token: String,
    pub files: Vec<AttachmentPickFile>,
    pub position: AttachmentsDndPosition,
}

fn emit_attachments_dnd_over(
    window: &Window,
    position: &tauri::PhysicalPosition<f64>,
) -> Result<()> {
    window
        .emit(
            "attachments://dnd-over",
            AttachmentsDndPosition {
                x: position.x,
                y: position.y,
            },
        )
        .map_err(|_| ErrorCodeString::new("EVENT_EMIT_FAILED"))
}

pub fn relay_attachments_drag_drop_event(window: &Window, event: &DragDropEvent) -> Result<()> {
    match event {
        DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
            emit_attachments_dnd_over(window, position)?;
        }
        DragDropEvent::Leave => {
            window
                .emit("attachments://dnd-leave", ())
                .map_err(|_| ErrorCodeString::new("EVENT_EMIT_FAILED"))?;
        }
        DragDropEvent::Drop { paths, position } => {
            let state = window
                .app_handle()
                .state::<std::sync::Arc<AppState>>()
                .inner()
                .clone();
            let Some(payload) = stage_attachment_pick_from_paths(&state, paths.clone())? else {
                return Ok(());
            };

            window
                .emit(
                    "attachments://dnd-drop-picked",
                    AttachmentsDndDropPickedPayload {
                        token: payload.token,
                        files: payload.files,
                        position: AttachmentsDndPosition {
                            x: position.x,
                            y: position.y,
                        },
                    },
                )
                .map_err(|_| ErrorCodeString::new("EVENT_EMIT_FAILED"))?;
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn attachments_pick_files(app: AppHandle) -> Result<Option<AttachmentPickPayload>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<std::sync::Arc<AppState>>().inner().clone();
        let selection = app.dialog().file().blocking_pick_files();
        let Some(paths) = selection else {
            return Ok(None);
        };

        let mut selected_paths: Vec<std::path::PathBuf> = Vec::new();
        for fp in paths {
            selected_paths.push(file_path_to_pathbuf(fp)?);
        }

        stage_attachment_pick_from_paths(&state, selected_paths)
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
            let meta = attachments_service::add_attachment_from_fs_path(
                &app,
                datacard_id.clone(),
                &f.path,
            )?;
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
        let default_name = attachments_service::get_attachment_file_name(&app, attachment_id.clone())?;

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
