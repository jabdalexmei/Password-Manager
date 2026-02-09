use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::ui_prefs_service;
use crate::types::BankCardPreviewFields;

#[tauri::command]
pub async fn get_datacard_preview_fields(state: State<'_, Arc<AppState>>) -> Result<Vec<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::get_datacard_preview_fields(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_datacard_preview_fields(
    fields: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::set_datacard_preview_fields(fields, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_bankcard_preview_fields(state: State<'_, Arc<AppState>>) -> Result<BankCardPreviewFields> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::get_bankcard_preview_fields(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_bankcard_preview_fields(
    prefs: BankCardPreviewFields,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::set_bankcard_preview_fields(prefs, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_datacard_core_hidden_fields(state: State<'_, Arc<AppState>>) -> Result<Vec<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::get_datacard_core_hidden_fields(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_datacard_core_hidden_fields(
    fields: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::set_datacard_core_hidden_fields(fields, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_bankcard_core_hidden_fields(state: State<'_, Arc<AppState>>) -> Result<Vec<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::get_bankcard_core_hidden_fields(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_bankcard_core_hidden_fields(
    fields: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ui_prefs_service::set_bankcard_core_hidden_fields(fields, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
