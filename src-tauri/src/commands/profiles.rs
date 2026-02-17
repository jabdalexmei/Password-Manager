use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::data::profiles::registry;
use crate::error::{ErrorCodeString, Result};
use crate::services::profiles_service;
use crate::services::security_service;
use crate::types::{ProfileMeta, ProfilesList};

#[tauri::command]
pub async fn profiles_list(state: State<'_, Arc<AppState>>) -> Result<ProfilesList> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        profiles_service::list_profiles(&storage_paths)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn profile_create(
    name: String,
    password: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ProfileMeta> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        profiles_service::create_profile(&storage_paths, &name, password)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn profile_rename(
    id: String,
    name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ProfileMeta> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        profiles_service::rename_profile(&storage_paths, &id, &name)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn profile_delete(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        let should_lock = app_state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
            .as_ref()
            .map(|s| s.profile_id == id)
            .unwrap_or(false);
        if should_lock {
            app_state.logout_and_cleanup()?;
        }
        let delete_result = profiles_service::delete_profile(&storage_paths, &id);
        if delete_result.is_ok() {
            if let Ok(mut active) = app_state.active_profile.lock() {
                if active.as_deref() == Some(&id) {
                    *active = None;
                }
            }
        }
        delete_result
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn get_active_profile(state: State<'_, Arc<AppState>>) -> Result<Option<ProfileMeta>> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        if let Ok(active) = app_state.active_profile.lock() {
            if let Some(id) = &*active {
                return profiles_service::get_active_profile(&storage_paths)
                    .map(|opt| opt.and_then(|p| if p.id == *id { Some(p) } else { None }));
            }
        }
        profiles_service::get_active_profile(&storage_paths)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}

#[tauri::command]
pub async fn set_active_profile(id: String, state: State<'_, Arc<AppState>>) -> Result<bool> {
    let app_state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let storage_paths = app_state.get_storage_paths()?;
        if !profiles_service::list_profiles(&storage_paths)?
            .profiles
            .iter()
            .any(|p| p.id == id)
        {
            return Err(ErrorCodeString::new("PROFILE_NOT_FOUND"));
        }

        let old_active_profile_id = app_state
            .active_profile
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
            .clone();

        // If we are switching profiles, persist and clear any currently-unlocked vault session.
        if old_active_profile_id.as_deref() != Some(id.as_str()) {
            security_service::persist_active_vault(&app_state)?;
            if let Ok(mut session) = app_state.vault_session.lock() {
                *session = None;
            }
        }

        if let Ok(mut active) = app_state.active_profile.lock() {
            *active = Some(id.clone());
        }
        profiles_service::set_active_profile(&storage_paths, &id)?;

        // Passwordless profiles can unlock on selection (no password needed to unwrap master key).
        let profile = registry::get_profile(&storage_paths, &id)?
            .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;
        if !profile.has_password {
            security_service::login_vault(&id, None, &app_state)?;
        }

        Ok(true)
    })
    .await
    .map_err(|_| ErrorCodeString::new("TASK_JOIN_FAILED"))?
}
