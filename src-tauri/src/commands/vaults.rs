use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::vaults_service;
use crate::types::Vault;

#[tauri::command]
pub async fn list_vaults(state: State<'_, Arc<AppState>>) -> Result<Vec<Vault>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || vaults_service::list_vaults(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn create_vault(name: String, state: State<'_, Arc<AppState>>) -> Result<Vault> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || vaults_service::create_vault(name, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn rename_vault(id: String, name: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || vaults_service::rename_vault(id, name, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn delete_vault(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || vaults_service::delete_vault(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_active_vault(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || vaults_service::set_active_vault(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
