use chrono::Utc;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachment_file_cleanup::remove_attachment_files_best_effort;
use crate::services::security_service;
use crate::services::settings_service::get_settings;
use crate::types::{
    CreateDataCardInput, CustomField, DataCard, DataCardSummary, MoveDataCardInput,
    SetDataCardArchivedInput, SetDataCardFavoriteInput, UpdateDataCardInput,
};

const CUSTOM_FIELD_ID_PREFIX: &str = "cf_";
const CUSTOM_PREVIEW_PREFIX: &str = "custom:";

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
    let mut cards = repo_impl::list_datacards(
        state,
        &profile_id,
        false,
        &settings.default_sort_field,
        &settings.default_sort_direction,
    )?;

    let repaired_any = repair_cards_in_place(state, &profile_id, &mut cards)?;
    if repaired_any {
        security_service::request_persist_active_vault(state.clone());
    }

    Ok(cards)
}

pub fn list_datacards_summary(state: &Arc<AppState>) -> Result<Vec<DataCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    let mut cards = repo_impl::list_datacards_summary(
        state,
        &profile_id,
        &settings.default_sort_field,
        &settings.default_sort_direction,
    )?;

    let repaired_any = repair_card_summaries_in_place(state, &profile_id, &mut cards)?;
    if repaired_any {
        security_service::request_persist_active_vault(state.clone());
    }

    Ok(cards)
}

pub fn get_datacard(id: String, state: &Arc<AppState>) -> Result<DataCard> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut card = repo_impl::get_datacard(state, &profile_id, &id)?;
    if normalize_card_fields(&mut card.custom_fields, &mut card.preview_fields) {
        repo_impl::repair_datacard_custom_fields_and_preview_fields(
            state,
            &profile_id,
            &card.id,
            &card.custom_fields,
            &card.preview_fields,
        )?;
        security_service::request_persist_active_vault(state.clone());
    }
    Ok(card)
}

pub fn create_datacard(input: CreateDataCardInput, state: &Arc<AppState>) -> Result<DataCard> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);
    sanitized.totp_uri = sanitized.totp_uri.and_then(|value| {
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
    sanitized.custom_fields = normalize_custom_fields(sanitized.custom_fields);

    let created = repo_impl::create_datacard(state, &profile_id, &sanitized)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(created)
}

pub fn update_datacard(input: UpdateDataCardInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut sanitized = input;
    sanitized.title = sanitized.title.trim().to_string();
    sanitized.tags = normalize_tags(sanitized.tags);
    sanitized.totp_uri = sanitized.totp_uri.and_then(|value| {
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
    sanitized.custom_fields = normalize_custom_fields(sanitized.custom_fields);

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
    if !value.starts_with(CUSTOM_PREVIEW_PREFIX) {
        return false;
    }
    let field_id = value[CUSTOM_PREVIEW_PREFIX.len()..].trim();
    is_valid_custom_field_id(field_id)
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

fn generate_custom_field_id() -> String {
    format!("{CUSTOM_FIELD_ID_PREFIX}{}", Uuid::new_v4())
}

fn is_valid_custom_field_id(value: &str) -> bool {
    if !value.starts_with(CUSTOM_FIELD_ID_PREFIX) {
        return false;
    }

    let raw_uuid = &value[CUSTOM_FIELD_ID_PREFIX.len()..];
    if raw_uuid.is_empty() || raw_uuid != raw_uuid.to_ascii_lowercase() {
        return false;
    }

    let Ok(uuid) = Uuid::try_parse(raw_uuid) else {
        return false;
    };

    uuid.get_version_num() == 4 && uuid.to_string() == raw_uuid
}

fn normalize_custom_fields(fields: Vec<CustomField>) -> Vec<CustomField> {
    let mut out: Vec<CustomField> = Vec::with_capacity(fields.len());
    let mut seen_ids: HashSet<String> = HashSet::new();

    for mut field in fields {
        let next_id = if is_valid_custom_field_id(&field.id) && !seen_ids.contains(&field.id) {
            field.id.clone()
        } else {
            loop {
                let generated = generate_custom_field_id();
                if seen_ids.contains(&generated) {
                    continue;
                }
                break generated;
            }
        };

        seen_ids.insert(next_id.clone());
        field.id = next_id;
        out.push(field);
    }

    out
}

fn normalize_preview_fields_for_existing_card(
    fields: Vec<String>,
    custom_fields: &[CustomField],
) -> Vec<String> {
    let known_field_ids: HashSet<&str> = custom_fields.iter().map(|field| field.id.as_str()).collect();
    let mut unique_key_to_id: HashMap<String, Option<String>> = HashMap::new();
    for field in custom_fields {
        let key = field.key.trim();
        if key.is_empty() {
            continue;
        }

        match unique_key_to_id.get_mut(key) {
            Some(entry) => *entry = None,
            None => {
                unique_key_to_id.insert(key.to_string(), Some(field.id.clone()));
            }
        }
    }

    let mut out: Vec<String> = Vec::new();
    for raw_token in fields {
        let token = raw_token.trim();
        if token.is_empty() {
            continue;
        }

        if is_allowed_preview_field(token) {
            if !out.iter().any(|existing| existing == token) {
                out.push(token.to_string());
            }
            continue;
        }

        if !token.starts_with(CUSTOM_PREVIEW_PREFIX) {
            continue;
        }

        let raw_custom = token[CUSTOM_PREVIEW_PREFIX.len()..].trim();
        if raw_custom.is_empty() {
            continue;
        }

        let migrated = if is_valid_custom_field_id(raw_custom) {
            known_field_ids
                .contains(raw_custom)
                .then(|| format!("{CUSTOM_PREVIEW_PREFIX}{raw_custom}"))
        } else {
            match unique_key_to_id.get(raw_custom) {
                Some(Some(field_id)) => Some(format!("{CUSTOM_PREVIEW_PREFIX}{field_id}")),
                _ => None,
            }
        };

        let Some(next_token) = migrated else {
            continue;
        };

        if out.iter().any(|existing| existing == &next_token) {
            continue;
        }
        out.push(next_token);
    }

    out
}

fn normalize_card_fields(custom_fields: &mut Vec<CustomField>, preview_fields: &mut Vec<String>) -> bool {
    let original_custom_fields = custom_fields.clone();
    let original_preview_fields = preview_fields.clone();

    *custom_fields = normalize_custom_fields(std::mem::take(custom_fields));
    *preview_fields =
        normalize_preview_fields_for_existing_card(std::mem::take(preview_fields), custom_fields);

    *custom_fields != original_custom_fields || *preview_fields != original_preview_fields
}

fn repair_cards_in_place(
    state: &Arc<AppState>,
    profile_id: &str,
    cards: &mut [DataCard],
) -> Result<bool> {
    let mut repaired_any = false;

    for card in cards.iter_mut() {
        if !normalize_card_fields(&mut card.custom_fields, &mut card.preview_fields) {
            continue;
        }

        repo_impl::repair_datacard_custom_fields_and_preview_fields(
            state,
            profile_id,
            &card.id,
            &card.custom_fields,
            &card.preview_fields,
        )?;
        repaired_any = true;
    }

    Ok(repaired_any)
}

fn repair_card_summaries_in_place(
    state: &Arc<AppState>,
    profile_id: &str,
    cards: &mut [DataCardSummary],
) -> Result<bool> {
    let mut repaired_any = false;

    for card in cards.iter_mut() {
        if !normalize_card_fields(&mut card.custom_fields, &mut card.preview_fields) {
            continue;
        }

        repo_impl::repair_datacard_custom_fields_and_preview_fields(
            state,
            profile_id,
            &card.id,
            &card.custom_fields,
            &card.preview_fields,
        )?;
        repaired_any = true;
    }

    Ok(repaired_any)
}

pub fn set_datacard_preview_fields_for_card(
    id: String,
    fields: Vec<String>,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let sanitized = sanitize_preview_fields(fields);
    let json =
        serde_json::to_string(&sanitized).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

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
    let mut cards = repo_impl::list_deleted_datacards(state, &profile_id)?;
    let repaired_any = repair_cards_in_place(state, &profile_id, &mut cards)?;
    if repaired_any {
        security_service::request_persist_active_vault(state.clone());
    }
    Ok(cards)
}

pub fn list_deleted_datacards_summary(state: &Arc<AppState>) -> Result<Vec<DataCardSummary>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut cards = repo_impl::list_deleted_datacards_summary(state, &profile_id)?;
    let repaired_any = repair_card_summaries_in_place(state, &profile_id, &mut cards)?;
    if repaired_any {
        security_service::request_persist_active_vault(state.clone());
    }
    Ok(cards)
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
        purge_datacard_by_profile_with_attachments(state, &profile_id, &id)?;
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
    let purged = purge_datacard_by_profile_with_attachments(state, &profile_id, &id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(purged)
}

pub(crate) fn purge_datacard_by_profile_with_attachments(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
) -> Result<bool> {
    purge_datacard_with_attachments(state, profile_id, id)
}

fn purge_datacard_with_attachments(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
) -> Result<bool> {
    let storage_paths = state.get_storage_paths()?;
    let attachment_ids = repo_impl::purge_datacard_and_collect_attachment_ids(state, profile_id, id)?;
    remove_attachment_files_best_effort(&storage_paths, profile_id, &attachment_ids);
    Ok(true)
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::data::sqlite::repo_impl;
    use crate::services::password_history_service;
    use crate::services::test_support::ServiceTestHarness;

    #[test]
    fn purge_datacard_removes_card_attachments_and_password_history() {
        let harness = ServiceTestHarness::new();
        let card = harness.create_datacard("Login", None, Some("old-password".to_string()));
        harness.update_datacard_password(&card, Some("new-password".to_string()));
        assert_eq!(
            password_history_service::list_history(&harness.state, &card.id)
                .unwrap()
                .len(),
            1
        );

        let attachment = harness.create_attachment(&card.id, "card-attachment");
        let attachment_path = harness.attachment_path(&attachment.id);

        let purged =
            purge_datacard_by_profile_with_attachments(&harness.state, &harness.profile_id, &card.id)
                .unwrap();

        assert!(purged);
        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
                .unwrap_err()
                .code,
            "DATACARD_NOT_FOUND"
        );
        assert!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &attachment.id)
                .unwrap()
                .is_none()
        );
        assert!(
            password_history_service::list_history(&harness.state, &card.id)
                .unwrap()
                .is_empty()
        );
        assert!(!attachment_path.exists());
    }
}
