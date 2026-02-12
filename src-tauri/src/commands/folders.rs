use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::folders_service;
use crate::types::{CreateFolderInput, Folder, MoveFolderInput, RenameFolderInput};

#[tauri::command]
pub async fn list_folders(state: State<'_, Arc<AppState>>) -> Result<Vec<Folder>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::list_folders(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn create_folder(
    input: CreateFolderInput,
    state: State<'_, Arc<AppState>>,
) -> Result<Folder> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::create_folder(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn rename_folder(
    input: RenameFolderInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::rename_folder(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn move_folder(input: MoveFolderInput, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::move_folder(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn delete_folder_only(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::delete_folder_only(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn delete_folder_and_cards(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || folders_service::delete_folder_and_cards(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
