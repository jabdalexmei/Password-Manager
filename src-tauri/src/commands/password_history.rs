use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;

use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::services::password_history_service;

#[derive(Serialize)]
pub struct PasswordHistoryRowDto {
    pub id: String,
    pub password_value: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_datacard_password_history(
    app: tauri::AppHandle,
    datacard_id: String,
) -> Result<Vec<PasswordHistoryRowDto>> {
    let app_state = app.state::<Arc<AppState>>().inner().clone();

    let rows = tauri::async_runtime::spawn_blocking(move || {
        password_history_service::list_history(&app_state, &datacard_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))??;

    Ok(rows
        .into_iter()
        .map(|row| PasswordHistoryRowDto {
            id: row.id,
            password_value: row.password_value,
            created_at: row.created_at,
        })
        .collect())
}

#[tauri::command]
pub async fn clear_datacard_password_history(
    app: tauri::AppHandle,
    datacard_id: String,
) -> Result<()> {
    let app_state = app.state::<Arc<AppState>>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        password_history_service::clear_history(&app_state, &datacard_id)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))??;

    Ok(())
}
