use chrono::Utc;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::Result;
use crate::services::security_service;
use crate::services::settings_service::get_settings;
use crate::types::{
    BankCardItem, BankCardPreviewFields, BankCardSummary, CreateBankCardInput,
    SetBankCardArchivedInput, SetBankCardFavoriteInput, UpdateBankCardInput,
};

fn is_allowed_preview_field(value: &str) -> bool {
    matches!(value, "bank_name" | "holder" | "note" | "tags")
}

fn normalize_preview_fields(input: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_allowed_preview_field(trimmed) {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn normalize_card_number_mode(input: Option<String>) -> Option<String> {
    let raw = input?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    match raw.as_str() {
        "full" | "last_four" => Some(raw),
        _ => None,
    }
}

pub fn set_bankcard_preview_fields_for_card(
    id: String,
    preview_fields: BankCardPreviewFields,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let sanitized = BankCardPreviewFields {
        fields: normalize_preview_fields(preview_fields.fields),
        card_number_mode: normalize_card_number_mode(preview_fields.card_number_mode),
    };

    let json = serde_json::to_string(&sanitized)
        .map_err(|_| crate::error::ErrorCodeString::new("DB_QUERY_FAILED"))?;
    let updated = repo_impl::set_bankcard_preview_fields_for_card(state, &profile_id, &id, &json)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !result.contains(&trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
    }
    result
}

pub fn list_bank_cards_summary(state: &Arc<AppState>) -> Result<Vec<BankCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    repo_impl::list_bank_cards_summary(
        state,
        &profile_id,
        &settings.default_sort_field,
        &settings.default_sort_direction,
    )
}

pub fn list_deleted_bank_cards_summary(state: &Arc<AppState>) -> Result<Vec<BankCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::list_deleted_bank_cards_summary(state, &profile_id)
}

pub fn restore_all_deleted_bank_cards(state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let ids = repo_impl::list_deleted_bank_card_ids(state, &profile_id)?;
    if ids.is_empty() {
        return Ok(true);
    }

    for id in ids {
        repo_impl::restore_bank_card(state, &profile_id, &id)?;
    }

    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn purge_all_deleted_bank_cards(state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let ids = repo_impl::list_deleted_bank_card_ids(state, &profile_id)?;
    if ids.is_empty() {
        return Ok(true);
    }

    for id in ids {
        purge_bank_card_internal(state, &profile_id, &id)?;
    }

    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn get_bank_card(id: String, state: &Arc<AppState>) -> Result<BankCardItem> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::get_bank_card(state, &profile_id, &id)
}

pub fn create_bank_card(input: CreateBankCardInput, state: &Arc<AppState>) -> Result<BankCardItem> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);

    sanitized.number = sanitized.number.take().and_then(|number| {
        let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            None
        } else {
            Some(digits)
        }
    });

    let created = repo_impl::create_bank_card(state, &profile_id, &sanitized)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(created)
}

pub fn update_bank_card(input: UpdateBankCardInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);

    sanitized.number = sanitized.number.take().and_then(|number| {
        let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            None
        } else {
            Some(digits)
        }
    });

    let updated = repo_impl::update_bank_card(state, &profile_id, &sanitized)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn delete_bank_card(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    if settings.soft_delete_enabled {
        let now = Utc::now().to_rfc3339();
        repo_impl::soft_delete_bank_card(state, &profile_id, &id, &now)?;
        security_service::request_persist_active_vault(state.clone());
        Ok(true)
    } else {
        let purged = purge_bank_card_internal(state, &profile_id, &id)?;
        security_service::request_persist_active_vault(state.clone());
        Ok(purged)
    }
}

pub fn restore_bank_card(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::restore_bank_card(state, &profile_id, &id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn purge_bank_card(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let purged = purge_bank_card_internal(state, &profile_id, &id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(purged)
}

fn purge_bank_card_internal(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    let purged = repo_impl::purge_bank_card(state, profile_id, id)?;
    Ok(purged)
}

pub fn set_bank_card_favorite(
    input: SetBankCardFavoriteInput,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let updated = repo_impl::set_bank_card_favorite(state, &profile_id, &input)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn set_bankcard_archived(
    input: SetBankCardArchivedInput,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let updated = repo_impl::set_bankcard_archived(state, &profile_id, &input)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn search_bank_card_ids(query: String, state: &Arc<AppState>) -> Result<Vec<String>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::search_bank_card_ids(state, &profile_id, &query)
}
