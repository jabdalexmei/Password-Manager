use super::*;

pub fn login_vault(id: &str, password: Option<&str>, state: &Arc<AppState>) -> Result<bool> {
    // No-op if the vault is already unlocked for this profile.
    // In dev builds the UI can accidentally invoke login multiple times (e.g. React StrictMode).
    {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_LOCK_POISONED"))?;

        if let Some(session) = session_guard.as_ref() {
            if session.profile_id == id {
                log::debug!("[SECURITY][login] no-op already_unlocked profile_id={}", id);
                if let Ok(mut active) = state.active_profile.lock() {
                    *active = Some(id.to_string());
                }
                return Ok(true);
            }
        }
    }

    let storage_paths = state.get_storage_paths()?;
    crate::services::backup_service::recover_pending_restore_tx(&storage_paths, id)?;
    let mut profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    // Recover any pending profile transitions (password changes) before opening.
    recover_incomplete_profile_transitions_with_password(&storage_paths, id, &profile.name)?;
    profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if profile.has_password && password.filter(|p| !p.is_empty()).is_none() {
        return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
    }

    open_vault_session(id, profile.has_password, password, &storage_paths, state)?;

    if let Ok(mut active) = state.active_profile.lock() {
        *active = Some(id.to_string());
    }
    let multiply_vaults_enabled = settings_service::get_settings(&storage_paths, id)
        .map(|s| s.multiply_vaults_enabled)
        .unwrap_or(true);

    let active_vault_id = if multiply_vaults_enabled {
        settings_service::resolve_active_vault_id(&storage_paths, id)
            .ok()
            .and_then(|candidate| {
                repo_impl::get_vault(state, id, &candidate)
                    .ok()
                    .map(|_| candidate)
            })
            .or_else(|| repo_impl::get_default_vault_id(state, id).ok())
            .unwrap_or_else(|| "default".to_string())
    } else {
        repo_impl::get_default_vault_id(state, id).unwrap_or_else(|_| "default".to_string())
    };
    if let Ok(mut active) = state.active_vault_id.lock() {
        *active = Some(active_vault_id);
    }
    Ok(true)
}

pub fn lock_vault(state: &Arc<AppState>) -> Result<bool> {
    let persisted_id = persist_active_vault(state)?;

    let active_id = {
        let active = state
            .active_profile
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
            .clone();
        active
    };

    let cleanup_id = persisted_id.clone().or(active_id.clone());

    if let Some(id) = cleanup_id.as_ref() {
        attachments_service::clear_previews_for_profile(state, id)?;
    }

    {
        let mut session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        *session = None;
    }

    {
        let mut active = state
            .active_profile
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        *active = None;
    }
    {
        let mut active_vault_id = state
            .active_vault_id
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        *active_vault_id = None;
    }

    Ok(true)
}

pub fn is_logged_in(state: &Arc<AppState>) -> Result<bool> {
    let active_id = state
        .active_profile
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
        .clone();

    let Some(id) = active_id else {
        return Ok(false);
    };

    let session = state
        .vault_session
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    Ok(session
        .as_ref()
        .map(|s| s.profile_id == id)
        .unwrap_or(false))
}

pub struct ActiveSessionInfo {
    pub profile_id: String,
    pub vault_key: [u8; 32],
}

pub fn require_unlocked_active_profile(state: &Arc<AppState>) -> Result<ActiveSessionInfo> {
    let active_id = state
        .active_profile
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
        .clone()
        .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

    let session = state
        .vault_session
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    if let Some(s) = session.as_ref() {
        if s.profile_id == active_id {
            return Ok(ActiveSessionInfo {
                profile_id: active_id,
                vault_key: *s.key,
            });
        }
    }

    Err(ErrorCodeString::new("VAULT_LOCKED"))
}

pub fn health_check() -> Result<bool> {
    Ok(true)
}
