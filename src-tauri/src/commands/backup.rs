use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::backup_service::{
    backup_create as backup_create_service, backup_create_if_due_auto as backup_create_if_due_auto_service,
    backup_inspect as backup_inspect_service, backup_list as backup_list_service,
    backup_restore_workflow as backup_restore_workflow_service,
    BackupListItem,
};
use crate::types::BackupPickPayload;

fn now_ms() -> Result<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .map_err(|_| ErrorCodeString::new("TIME_UNAVAILABLE"))
}

fn file_path_to_pathbuf(fp: FilePath) -> Result<PathBuf> {
    match fp {
        FilePath::Path(p) => Ok(p),
        _ => Err(ErrorCodeString::new("DIALOG_UNSUPPORTED_FILE_URI")),
    }
}

fn cleanup_stale_backup_picks(state: &AppState, now: u128) -> Result<()> {
    const MAX_AGE_MS: u128 = 10 * 60 * 1000;
    const MAX_ENTRIES: usize = 16;
    let mut map = state
        .pending_backup_picks
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
pub async fn backup_create(
    destination_path: Option<String>,
    use_default_path: bool,
    state: State<'_, Arc<AppState>>,
) -> Result<String> {
    // Security hardening: do not accept filesystem paths from the frontend.
    if destination_path.is_some() {
        return Err(ErrorCodeString::new("BACKUP_DESTINATION_PATH_FORBIDDEN"));
    }
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backup_create_service(&app, destination_path, use_default_path)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_create_via_dialog(
    app: AppHandle,
    suggested_file_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(name) = suggested_file_name {
            builder = builder.set_file_name(name);
        }
        let selection = builder.blocking_save_file();
        let Some(fp) = selection else {
            return Ok(None);
        };
        let path = file_path_to_pathbuf(fp)?;
        let destination = path.to_string_lossy().to_string();
        let created = backup_create_service(&st, Some(destination), false)?;
        Ok(Some(created))
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_list(state: State<'_, Arc<AppState>>) -> Result<Vec<BackupListItem>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || backup_list_service(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_pick_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<BackupPickPayload>> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_ms()?;
        cleanup_stale_backup_picks(&st, now)?;

        // UX: when restoring from the Workspace screen users often keep their backups
        // inside the selected workspace (Profiles/.../backups). Start browsing there.
        // Also: do not rely on extension filters here - some platforms handle multi-dot
        // extensions inconsistently (e.g. *.pmbackup.zip). We validate the picked file
        // via backup_inspect_service anyway.
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Select backup archive (.pmbackup.zip)");

        if let Ok(sp) = st.get_storage_paths() {
            if let Ok(profiles_root) = sp.profiles_root() {
                dialog = dialog.set_directory(profiles_root);
            } else if let Ok(workspace_root) = sp.workspace_root() {
                dialog = dialog.set_directory(workspace_root);
            }
        }

        let selection = dialog.blocking_pick_file();

        let Some(fp) = selection else {
            return Ok(None);
        };

        let path = file_path_to_pathbuf(fp)?;
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?
            .to_string();

        let byte_size = std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|_| ErrorCodeString::new("BACKUP_ARCHIVE_INVALID"))?;

        let inspect = backup_inspect_service(&st, path.to_string_lossy().to_string())?;

        let token = Uuid::new_v4().to_string();
        {
            let mut map = st
                .pending_backup_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.insert(
                token.clone(),
                crate::app_state::PendingBackupPick {
                    created_at_ms: now,
                    path: path.clone(),
                },
            );
        }

        Ok(Some(BackupPickPayload {
            token,
            file_name,
            byte_size: byte_size as i64,
            inspect,
        }))
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_discard_pick(state: State<'_, Arc<AppState>>, token: String) -> Result<()> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = st
            .pending_backup_picks
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        map.remove(&token);
        Ok(())
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_restore_workflow_from_pick(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<bool> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Don't consume the pick token before restore succeeds.
        // This lets the user retry restore if it fails without getting BACKUP_PICK_NOT_FOUND.
        let pick = {
            let map = st
                .pending_backup_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.get(&token)
                .cloned()
                .ok_or_else(|| ErrorCodeString::new("BACKUP_PICK_NOT_FOUND"))?
        };

        let result = backup_restore_workflow_service(&st, pick.path.to_string_lossy().to_string());

        if result.is_ok() {
            let mut map = st
                .pending_backup_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.remove(&token);
        }

        result
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn backup_create_if_due_auto(state: State<'_, Arc<AppState>>) -> Result<Option<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || backup_create_if_due_auto_service(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
