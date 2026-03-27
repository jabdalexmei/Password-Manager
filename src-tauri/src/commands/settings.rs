use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::settings_service::{
    get_app_theme_command, get_settings_command, resolve_app_theme_command, set_app_theme_command,
    update_settings_command,
};
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

#[tauri::command]
pub async fn resolve_app_theme(
    preferred_theme: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || resolve_app_theme_command(&app, preferred_theme))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_app_theme(state: State<'_, Arc<AppState>>) -> Result<String> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || get_app_theme_command(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_app_theme(theme: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_app_theme_command(&app, theme))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
