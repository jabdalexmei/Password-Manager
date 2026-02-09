use chrono::Utc;
use std::fs;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::data::profiles::paths::attachment_file_path;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::security_service;
use crate::services::settings_service::get_settings;
use crate::types::{
    CreateDataCardInput, DataCard, DataCardSummary, MoveDataCardInput, SetDataCardFavoriteInput,
    SetDataCardArchivedInput, UpdateDataCardInput,
};

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

pub fn list_datacards(state: &Arc<AppState>) -> Result<Vec<DataCard>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    repo_impl::list_datacards(
        state,
        &profile_id,
        false,
        &settings.default_sort_field,
        &settings.default_sort_direction,
    )
}

pub fn list_datacards_summary(state: &Arc<AppState>) -> Result<Vec<DataCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    repo_impl::list_datacards_summary(
        state,
        &profile_id,
        &settings.default_sort_field,
        &settings.default_sort_direction,
    )
}

pub fn get_datacard(id: String, state: &Arc<AppState>) -> Result<DataCard> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::get_datacard(state, &profile_id, &id)
}

pub fn create_datacard(input: CreateDataCardInput, state: &Arc<AppState>) -> Result<DataCard> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);
    sanitized.totp_uri = sanitized
        .totp_uri
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
    let (seed_phrase, seed_phrase_word_count) =
        normalize_seed_phrase(sanitized.seed_phrase, sanitized.seed_phrase_word_count)?;
    sanitized.seed_phrase = seed_phrase;
    sanitized.seed_phrase_word_count = seed_phrase_word_count;

    let created = repo_impl::create_datacard(state, &profile_id, &sanitized)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(created)
}

pub fn update_datacard(input: UpdateDataCardInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);
    sanitized.totp_uri = sanitized
        .totp_uri
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
    let (seed_phrase, seed_phrase_word_count) =
        normalize_seed_phrase(sanitized.seed_phrase, sanitized.seed_phrase_word_count)?;
    sanitized.seed_phrase = seed_phrase;
    sanitized.seed_phrase_word_count = seed_phrase_word_count;

    let updated = repo_impl::update_datacard(state, &profile_id, &sanitized)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

fn is_allowed_preview_field(value: &str) -> bool {
    matches!(
        value,
        "username" | "recovery_email" | "mobile_phone" | "note" | "folder" | "tags"
    )
}

fn is_allowed_custom_preview_field(value: &str) -> bool {
    // Per-card only. Format: "custom:<field_key>"
    // The key must be non-empty and reasonably short to avoid storing unbounded strings.
    const PREFIX: &str = "custom:";
    if !value.starts_with(PREFIX) {
        return false;
    }
    let key = &value[PREFIX.len()..];
    let key = key.trim();
    if key.is_empty() {
        return false;
    }
    // Prevent pathological values.
    if key.len() > 80 {
        return false;
    }
    if key.contains(['\n', '\r', '\0']) {
        return false;
    }
    true
}

fn sanitize_preview_fields(fields: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in fields {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_allowed_preview_field(trimmed) && !is_allowed_custom_preview_field(trimmed) {
            continue;
        }
        if out.iter().any(|x| x == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

pub fn set_datacard_preview_fields_for_card(
    id: String,
    fields: Vec<String>,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let sanitized = sanitize_preview_fields(fields);
    let json = serde_json::to_string(&sanitized)
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let updated = repo_impl::set_datacard_preview_fields_for_card(state, &profile_id, &id, &json)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn move_datacard_to_folder(input: MoveDataCardInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let moved = repo_impl::move_datacard(state, &profile_id, &input.id, &input.folder_id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(moved)
}

pub fn delete_datacard(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    if settings.soft_delete_enabled {
        let now = Utc::now().to_rfc3339();
        repo_impl::soft_delete_datacard(state, &profile_id, &id, &now)?;
        repo_impl::soft_delete_attachments_by_datacard(state, &profile_id, &id, &now)?;
        security_service::request_persist_active_vault(state.clone());
        Ok(true)
    } else {
        let purged = purge_datacard_with_attachments(state, &profile_id, &id)?;
        security_service::request_persist_active_vault(state.clone());
        Ok(purged)
    }
}

pub fn list_deleted_datacards(state: &Arc<AppState>) -> Result<Vec<DataCard>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::list_deleted_datacards(state, &profile_id)
}

pub fn list_deleted_datacards_summary(state: &Arc<AppState>) -> Result<Vec<DataCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::list_deleted_datacards_summary(state, &profile_id)
}

pub fn search_datacard_ids(query: String, state: &Arc<AppState>) -> Result<Vec<String>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::search_datacard_ids(state, &profile_id, &query)
}

pub fn restore_all_deleted_datacards(state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let ids = repo_impl::list_deleted_datacard_ids(state, &profile_id)?;
    if ids.is_empty() {
        return Ok(true);
    }

    for id in ids {
        repo_impl::restore_datacard(state, &profile_id, &id)?;
        repo_impl::restore_attachments_by_datacard(state, &profile_id, &id)?;
    }

    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn purge_all_deleted_datacards(state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let ids = repo_impl::list_deleted_datacard_ids(state, &profile_id)?;
    if ids.is_empty() {
        return Ok(true);
    }

    for id in ids {
        purge_datacard_with_attachments(state, &profile_id, &id)?;
    }

    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn restore_datacard(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::restore_datacard(state, &profile_id, &id)?;
    repo_impl::restore_attachments_by_datacard(state, &profile_id, &id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn purge_datacard(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let purged = purge_datacard_with_attachments(state, &profile_id, &id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(purged)
}

fn purge_datacard_with_attachments(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
) -> Result<bool> {
    let attachments = repo_impl::list_all_attachments_by_datacard(state, profile_id, id)?;
    let storage_paths = state.get_storage_paths()?;
    for attachment in attachments {
        let file_path = attachment_file_path(&storage_paths, profile_id, &attachment.id)?;
        let _ = fs::remove_file(file_path);
        if let Err(err) = repo_impl::purge_attachment(state, profile_id, &attachment.id) {
            if err.code == "ATTACHMENT_NOT_FOUND" {
                continue;
            }
            return Err(err);
        }
    }

    let purged = repo_impl::purge_datacard(state, profile_id, id)?;
    Ok(purged)
}

pub fn set_datacard_favorite(
    input: SetDataCardFavoriteInput,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let updated = repo_impl::set_datacard_favorite(state, &profile_id, &input)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn set_datacard_archived(
    input: SetDataCardArchivedInput,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let updated = repo_impl::set_datacard_archived(state, &profile_id, &input)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

fn normalize_seed_phrase(
    seed_phrase: Option<String>,
    seed_phrase_word_count: Option<i32>,
) -> Result<(Option<String>, Option<i32>)> {
    let normalized = seed_phrase.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        return Ok((None, None));
    }

    let words = seed_phrase_word_count
        .ok_or_else(|| ErrorCodeString::new("SEED_PHRASE_WORD_COUNT_MISSING"))?;
    if words != 12 && words != 18 && words != 24 {
        return Err(ErrorCodeString::new("SEED_PHRASE_WORD_COUNT_INVALID"));
    }

    let actual = normalized.split_whitespace().count() as i32;
    if actual != words {
        return Err(ErrorCodeString::new("SEED_PHRASE_WORD_COUNT_MISMATCH"));
    }

    Ok((Some(normalized), Some(words)))
}
