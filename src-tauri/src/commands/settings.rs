use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::settings_service::{get_settings_command, update_settings_command};
use crate::types::UserSettings;

#[tauri::command]
pub async fn get_settings(state: State<'_, Arc<AppState>>) -> Result<UserSettings> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || get_settings_command(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn update_settings(
    settings: UserSettings,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || update_settings_command(&app, settings))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
