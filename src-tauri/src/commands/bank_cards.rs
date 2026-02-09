use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::bank_cards_service;
use crate::types::{
    BankCardItem, BankCardSummary, CreateBankCardInput, SetBankCardArchivedInput,
    SetBankCardFavoriteInput, UpdateBankCardInput, BankCardPreviewFields,
};

#[tauri::command]
pub async fn list_bank_cards_summary_command(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BankCardSummary>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::list_bank_cards_summary(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn list_deleted_bank_cards_summary_command(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BankCardSummary>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bank_cards_service::list_deleted_bank_cards_summary(&app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_bank_card(id: String, state: State<'_, Arc<AppState>>) -> Result<BankCardItem> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::get_bank_card(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn create_bank_card(
    input: CreateBankCardInput,
    state: State<'_, Arc<AppState>>,
) -> Result<BankCardItem> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::create_bank_card(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn update_bank_card(
    input: UpdateBankCardInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::update_bank_card(input, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_bank_card_favorite(
    input: SetBankCardFavoriteInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bank_cards_service::set_bank_card_favorite(input, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_bankcard_archived(
    input: SetBankCardArchivedInput,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bank_cards_service::set_bankcard_archived(input, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn search_bank_cards(
    query: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::search_bank_card_ids(query, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn delete_bank_card(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::delete_bank_card(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn restore_bank_card(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::restore_bank_card(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn purge_bank_card(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::purge_bank_card(id, &app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn restore_all_deleted_bank_cards(state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bank_cards_service::restore_all_deleted_bank_cards(&app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn purge_all_deleted_bank_cards(state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bank_cards_service::purge_all_deleted_bank_cards(&app))
        .await
        .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_bankcard_preview_fields_for_card(
    id: String,
    preview_fields: BankCardPreviewFields,
    state: State<'_, Arc<AppState>>,
) -> Result<bool> {
    let app = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bank_cards_service::set_bankcard_preview_fields_for_card(id, preview_fields, &app)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
