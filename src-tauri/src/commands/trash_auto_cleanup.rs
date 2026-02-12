use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::trash_auto_cleanup_service;
use crate::types::TrashCleanupResult;

#[tauri::command]
pub async fn run_trash_auto_cleanup_if_enabled(
    state: State<'_, Arc<AppState>>,
) -> Result<TrashCleanupResult> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        trash_auto_cleanup_service::run_trash_auto_cleanup_if_enabled(&app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
