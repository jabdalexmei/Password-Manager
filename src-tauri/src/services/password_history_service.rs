use std::sync::Arc;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::Result;
use crate::services::security_service;
use crate::types::PasswordHistoryRow;

pub fn list_history(state: &Arc<AppState>, datacard_id: &str) -> Result<Vec<PasswordHistoryRow>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::list_password_history(state, &profile_id, datacard_id)
}

pub fn clear_history(state: &Arc<AppState>, datacard_id: &str) -> Result<()> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::clear_password_history(state, &profile_id, datacard_id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(())
}
