use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::AppHandle;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::data::fs::atomic_write::write_atomic;
use crate::data::workspaces::registry::{
    display_name_from_path, encode_workspace_path, load_registry, resolve_workspace_path,
    save_registry, WorkspaceRecord,
};
use crate::error::{ErrorCodeString, Result};
use crate::types::WorkspaceItem;

const WORKSPACE_MARKER_FILE: &str = ".pm-workspace.json";

fn app_dir_from_state(state: &Arc<AppState>) -> Result<PathBuf> {
    let storage_paths = state
        .storage_paths
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
    Ok(storage_paths.app_dir().to_path_buf())
}

fn marker_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_MARKER_FILE)
}

fn ensure_marker(root: &Path) -> Result<()> {
    let marker = marker_path(root);
    if marker.exists() {
        return Ok(());
    }
    let payload = serde_json::json!({ "schema_version": 1 });
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_NOT_WRITABLE"))?;
    write_atomic(&marker, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("WORKSPACE_NOT_WRITABLE"))
}

fn ensure_workspace_root(root: &Path) -> Result<()> {
    if root.exists() && !root.is_dir() {
        return Err(ErrorCodeString::new("WORKSPACE_NOT_WRITABLE"));
    }
    std::fs::create_dir_all(root).map_err(|_| ErrorCodeString::new("WORKSPACE_NOT_WRITABLE"))?;
    ensure_marker(root)?;
    let profiles_dir = root.join("Profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_PROFILES_CREATE_FAILED"))?;
    Ok(())
}

fn file_path_to_pathbuf(fp: FilePath) -> Result<PathBuf> {
    match fp {
        FilePath::Path(p) => Ok(p),
        _ => Err(ErrorCodeString::new("DIALOG_UNSUPPORTED_FILE_URI")),
    }
}

fn workspace_create_impl(app_state: Arc<AppState>, root: PathBuf) -> Result<bool> {
    let app_dir = app_dir_from_state(&app_state)?;
    ensure_workspace_root(&root)?;

    let mut registry = load_registry(&app_dir)?;
    let record = upsert_workspace(&mut registry.workspaces, &app_dir, &root);
    app_state.logout_and_cleanup()?;
    app_state.set_workspace_root(root)?;
    registry.active_workspace_id = Some(record.id.clone());
    if let Err(err) = save_registry(&app_dir, &registry) {
        let _ = app_state.clear_workspace_root();
        return Err(err);
    }
    Ok(true)
}

fn validate_workspace_root(root: &Path) -> Result<()> {
    if !root.exists() {
        return Err(ErrorCodeString::new("WORKSPACE_FOLDER_MISSING"));
    }
    let marker = marker_path(root);
    if !marker.exists() {
        return Err(ErrorCodeString::new("WORKSPACE_INVALID_MARKER"));
    }
    let profiles_dir = root.join("Profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_PROFILES_CREATE_FAILED"))?;
    Ok(())
}

fn upsert_workspace(
    record_list: &mut Vec<WorkspaceRecord>,
    app_dir: &Path,
    workspace_root: &Path,
) -> WorkspaceRecord {
    let display_name = display_name_from_path(workspace_root);
    let encoded_path = encode_workspace_path(app_dir, workspace_root);
    if let Some(existing) = record_list
        .iter_mut()
        .find(|record| resolve_workspace_path(app_dir, record) == workspace_root)
    {
        existing.display_name = display_name;
        existing.path = encoded_path;
        return existing.clone();
    }

    let record = WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        display_name,
        path: encoded_path,
    };
    record_list.push(record.clone());
    record
}

fn is_dir_writable(root: &Path) -> bool {
    if !root.exists() || !root.is_dir() {
        return false;
    }
    let test_path = root.join(format!(".pm-write-test-{}", uuid::Uuid::new_v4()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&test_path)
    {
        Ok(mut f) => {
            let _ = f.write_all(b"test");
            let _ = f.sync_all();
            let _ = std::fs::remove_file(&test_path);
            true
        }
        Err(_) => false,
    }
}

fn workspace_status(root: &Path) -> Result<(bool, bool)> {
    if !root.exists() {
        return Ok((false, false));
    }
    let marker = marker_path(root);
    if !marker.exists() {
        return Ok((true, false));
    }

    Ok((true, is_dir_writable(root)))
}

#[tauri::command]
pub async fn workspace_list(state: State<'_, Arc<AppState>>) -> Result<Vec<WorkspaceItem>> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app_dir_from_state(&app_state)?;
        let registry = load_registry(&app_dir)?;
        let active_id = registry.active_workspace_id.clone();
        registry
            .workspaces
            .iter()
            .map(|record| {
                let resolved = resolve_workspace_path(&app_dir, record);
                let (exists, valid) = workspace_status(&resolved)?;
                Ok(WorkspaceItem {
                    id: record.id.clone(),
                    display_name: record.display_name.clone(),
                    path: resolved.to_string_lossy().to_string(),
                    exists,
                    valid,
                    is_active: active_id.as_deref() == Some(&record.id),
                })
            })
            .collect()
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn workspace_select(
    id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app_dir_from_state(&app_state)?;
        let mut registry = load_registry(&app_dir)?;
        let record = registry
            .workspaces
            .iter()
            .find(|record| record.id == id)
            .cloned()
            .ok_or_else(|| ErrorCodeString::new("WORKSPACE_FOLDER_MISSING"))?;

        let resolved = resolve_workspace_path(&app_dir, &record);
        validate_workspace_root(&resolved)?;

        // If user selects the already-open workspace, treat it as a no-op.
        // This avoids re-locking .pm-workspace.lock (which can fail on Windows) and avoids
        // unnecessarily logging out an active profile/session.
        if registry.active_workspace_id.as_deref() == Some(&id) {
            if let Ok(sp) = app_state.get_storage_paths() {
                if let Ok(current) = sp.workspace_root() {
                    let current_can = std::fs::canonicalize(current)
                        .unwrap_or_else(|_| current.clone());
                    let resolved_can = std::fs::canonicalize(&resolved)
                        .unwrap_or_else(|_| resolved.clone());
                    if current_can == resolved_can {
                        return Ok(true);
                    }
                }
            }
        }
        app_state.logout_and_cleanup()?;
        app_state.set_workspace_root(resolved)?;
        registry.active_workspace_id = Some(id);
        if let Err(err) = save_registry(&app_dir, &registry) {
            let _ = app_state.clear_workspace_root();
            return Err(err);
        }
        Ok(true)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn workspace_create(path: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let _ = path;
    let _ = state;
    Err(ErrorCodeString::new("WORKSPACE_CREATE_PATH_FORBIDDEN"))
}

#[tauri::command]
pub async fn workspace_create_via_dialog(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selection = app.dialog().file().blocking_pick_folder();
        let Some(fp) = selection else {
            return Ok(false);
        };
        let root = file_path_to_pathbuf(fp)?;
        workspace_create_impl(app_state, root)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn workspace_create_default(state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app_dir_from_state(&app_state)?;
        let root = app_dir.join("Password Manager Vault");
        workspace_create_impl(app_state, root)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn workspace_remove(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app_dir_from_state(&app_state)?;
        let mut registry = load_registry(&app_dir)?;
        let was_active = registry.active_workspace_id.as_deref() == Some(&id);
        registry.workspaces.retain(|record| record.id != id);
        if was_active {
            registry.active_workspace_id = None;
            app_state.logout_and_cleanup()?;
            app_state.clear_workspace_root()?;
        }
        save_registry(&app_dir, &registry)?;
        Ok(true)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn workspace_open_in_explorer(
    id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app_dir_from_state(&app_state)?;
        let registry = load_registry(&app_dir)?;

        let record = registry
            .workspaces
            .iter()
            .find(|w| w.id == id)
            .ok_or_else(|| ErrorCodeString::new("WORKSPACE_NOT_FOUND"))?;

        let root = resolve_workspace_path(&app_dir, record);
        if !root.exists() {
            return Err(ErrorCodeString::new("WORKSPACE_FOLDER_MISSING"));
        }

        std::process::Command::new("explorer")
            .arg(&root)
            .spawn()
            .map_err(|_| ErrorCodeString::new("WORKSPACE_OPEN_FAILED"))?;

        Ok(true)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
