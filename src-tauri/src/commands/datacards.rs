use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::datacards_service;
use crate::types::{
    CreateDataCardInput, DataCard, DataCardSummary, MoveDataCardInput, SetDataCardFavoriteInput,
    SetDataCardArchivedInput, UpdateDataCardInput,
};

#[tauri::command]
pub async fn list_datacards(state: State<'_, Arc<AppState>>) -> Result<Vec<DataCard>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::list_datacards(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_datacard(id: String, state: State<'_, Arc<AppState>>) -> Result<DataCard> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::get_datacard(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn create_datacard(
    input: CreateDataCardInput,
    state: State<'_, Arc<AppState>>,
) -> Result<DataCard> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::create_datacard(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn update_datacard(
    input: UpdateDataCardInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::update_datacard(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn move_datacard_to_folder(
    input: MoveDataCardInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        datacards_service::move_datacard_to_folder(input, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn delete_datacard(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::delete_datacard(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn list_deleted_datacards(state: State<'_, Arc<AppState>>) -> Result<Vec<DataCard>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::list_deleted_datacards(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn restore_datacard(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::restore_datacard(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn purge_datacard(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::purge_datacard(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn restore_all_deleted_datacards(state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        datacards_service::restore_all_deleted_datacards(&app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn purge_all_deleted_datacards(state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::purge_all_deleted_datacards(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_datacard_favorite(
    input: SetDataCardFavoriteInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        datacards_service::set_datacard_favorite(input, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn search_datacards(
    query: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::search_datacard_ids(query, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_datacard_archived(
    input: SetDataCardArchivedInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::set_datacard_archived(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn list_datacards_summary_command(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DataCardSummary>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || datacards_service::list_datacards_summary(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn list_deleted_datacards_summary_command(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DataCardSummary>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        datacards_service::list_deleted_datacards_summary(&app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_datacard_preview_fields_for_card(
    id: String,
    fields: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        datacards_service::set_datacard_preview_fields_for_card(id, fields, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
