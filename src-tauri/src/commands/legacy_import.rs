use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::legacy_import_service;
use crate::types::{LegacyImportPickPayload, LegacyImportResult};

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

fn cleanup_stale_legacy_import_picks(state: &AppState, now: u128) -> Result<()> {
    const MAX_AGE_MS: u128 = 10 * 60 * 1000;
    const MAX_ENTRIES: usize = 16;
    let mut map = state
        .pending_legacy_import_picks
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
pub async fn legacy_import_pick_csv(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<LegacyImportPickPayload>> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_ms()?;
        cleanup_stale_legacy_import_picks(&st, now)?;

        let mut dialog = app
            .dialog()
            .file()
            .set_title("Select reviewed CSV for legacy import");

        if let Ok(sp) = st.get_storage_paths() {
            if let Ok(workspace_root) = sp.workspace_root() {
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
            .ok_or_else(|| ErrorCodeString::new("LEGACY_IMPORT_FILE_INVALID"))?
            .to_string();
        let byte_size = std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|_| ErrorCodeString::new("LEGACY_IMPORT_FILE_INVALID"))?;
        let inspect = legacy_import_service::inspect_csv_file(&path, &st)?;

        let token = Uuid::new_v4().to_string();
        {
            let mut map = st
                .pending_legacy_import_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.insert(
                token.clone(),
                crate::app_state::PendingLegacyImportPick {
                    created_at_ms: now,
                    path: path.clone(),
                },
            );
        }

        Ok(Some(LegacyImportPickPayload {
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
pub async fn legacy_import_discard_pick(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<()> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut map = st
            .pending_legacy_import_picks
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        map.remove(&token);
        Ok(())
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn legacy_import_from_pick(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<LegacyImportResult> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let pick = {
            let map = st
                .pending_legacy_import_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.get(&token)
                .cloned()
                .ok_or_else(|| ErrorCodeString::new("LEGACY_IMPORT_PICK_NOT_FOUND"))?
        };

        let result = legacy_import_service::import_csv_file(&pick.path, &st);

        if result.is_ok() {
            let mut map = st
                .pending_legacy_import_picks
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            map.remove(&token);
        }

        result
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
