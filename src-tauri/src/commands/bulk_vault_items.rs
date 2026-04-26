use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::bulk_vault_items_service;
use crate::types::{BulkVaultItemsInput, BulkVaultItemsResult};

fn file_path_to_pathbuf(fp: FilePath) -> Result<PathBuf> {
    match fp {
        FilePath::Path(p) => Ok(p),
        _ => Err(ErrorCodeString::new("DIALOG_UNSUPPORTED_FILE_URI")),
    }
}

fn ensure_csv_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension("csv")
    }
}

#[tauri::command]
pub async fn bulk_apply_vault_items(
    input: BulkVaultItemsInput,
    state: State<'_, Arc<AppState>>,
) -> Result<BulkVaultItemsResult> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bulk_vault_items_service::bulk_apply_vault_items(input, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn export_selected_datacards_csv_via_dialog(
    app: AppHandle,
    input: BulkVaultItemsInput,
    suggested_file_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>> {
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Export selected data cards as CSV")
            .add_filter("CSV files", &["csv"]);
        if let Some(name) = suggested_file_name {
            dialog = dialog.set_file_name(name);
        }
        if let Ok(sp) = st.get_storage_paths() {
            if let Ok(workspace_root) = sp.workspace_root() {
                dialog = dialog.set_directory(workspace_root);
            }
        }

        let Some(fp) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = ensure_csv_extension(file_path_to_pathbuf(fp)?);
        let exported_path =
            bulk_vault_items_service::export_selected_datacards_csv(&path, input, &st)?;
        Ok(Some(exported_path))
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
