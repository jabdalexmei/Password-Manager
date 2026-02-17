use chrono::Utc;
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::security_service;
use crate::types::BankCardPreviewFields;

const PREF_KEY_DATACARD_PREVIEW_FIELDS: &str = "datacard.preview_fields";
const PREF_KEY_DATACARD_PREVIEW_FIELDS_FOLDER_ONLY_BY_FOLDER: &str =
    "datacard.preview_fields_folder_only_by_folder";
const PREF_KEY_BANKCARD_PREVIEW_FIELDS: &str = "bankcard.preview_fields";
const PREF_KEY_DATACARD_CORE_HIDDEN_FIELDS: &str = "datacard.core_hidden_fields";
const PREF_KEY_BANKCARD_CORE_HIDDEN_FIELDS: &str = "bankcard.core_hidden_fields";
const MAX_CORE_HIDDEN_FIELDS: usize = 3;

fn is_allowed_preview_field(value: &str) -> bool {
    matches!(
        value,
        "username" | "recovery_email" | "mobile_phone" | "note" | "folder" | "tags"
    )
}

fn is_allowed_preview_field_or_custom(value: &str) -> bool {
    if is_allowed_preview_field(value) {
        return true;
    }
    match value.strip_prefix("custom:") {
        Some(rest) => !rest.trim().is_empty(),
        None => false,
    }
}

fn is_allowed_bankcard_preview_field(value: &str) -> bool {
    matches!(value, "bank_name" | "holder" | "note" | "tags")
}

fn normalize_bankcard_preview_fields(input: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_allowed_bankcard_preview_field(trimmed) {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn normalize_bankcard_card_number_mode(input: Option<String>) -> Option<String> {
    let raw = input?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    match raw.as_str() {
        "full" | "last_four" => Some(raw),
        _ => None,
    }
}

fn is_allowed_core_field(value: &str) -> bool {
    matches!(value, "title" | "url" | "email")
}

fn is_allowed_bankcard_core_field(value: &str) -> bool {
    matches!(value, "title")
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

fn normalize_preview_fields_folder_only_by_folder(
    input: BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (raw_folder_id, fields_raw) in input {
        let folder_id = raw_folder_id.trim();
        if folder_id.is_empty() {
            continue;
        }

        let mut fields: Vec<String> = Vec::new();
        for raw_field in fields_raw {
            let trimmed = raw_field.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !is_allowed_preview_field_or_custom(trimmed) {
                continue;
            }
            if fields.iter().any(|v| v == trimmed) {
                continue;
            }
            fields.push(trimmed.to_string());
        }

        if fields.is_empty() {
            continue;
        }

        out.insert(folder_id.to_string(), fields);
    }

    out
}

fn normalize_core_hidden_fields(input: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_allowed_core_field(trimmed) {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= MAX_CORE_HIDDEN_FIELDS {
            break;
        }
    }
    out
}

fn normalize_bankcard_core_hidden_fields(input: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_allowed_bankcard_core_field(trimmed) {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= MAX_CORE_HIDDEN_FIELDS {
            break;
        }
    }
    out
}

pub fn get_datacard_preview_fields(state: &Arc<AppState>) -> Result<Vec<String>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let raw = repo_impl::get_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_PREVIEW_FIELDS,
    )?;
    if let Some(value_json) = raw {
        let parsed: Result<Vec<String>> =
            serde_json::from_str(&value_json).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"));
        if let Ok(v) = parsed {
            return Ok(normalize_preview_fields(v));
        }
    }

    Ok(Vec::new())
}

pub fn set_datacard_preview_fields(fields: Vec<String>, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let cleaned = normalize_preview_fields(fields);
    let value_json =
        serde_json::to_string(&cleaned).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let now_utc = Utc::now().to_rfc3339();
    let updated = repo_impl::set_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_PREVIEW_FIELDS,
        &value_json,
        &now_utc,
    )?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn get_datacard_preview_fields_folder_only_by_folder(
    state: &Arc<AppState>,
) -> Result<BTreeMap<String, Vec<String>>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let raw = repo_impl::get_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_PREVIEW_FIELDS_FOLDER_ONLY_BY_FOLDER,
    )?;
    if let Some(value_json) = raw {
        let parsed: Result<BTreeMap<String, Vec<String>>> =
            serde_json::from_str(&value_json).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"));
        if let Ok(v) = parsed {
            return Ok(normalize_preview_fields_folder_only_by_folder(v));
        }
    }

    Ok(BTreeMap::new())
}

pub fn set_datacard_preview_fields_folder_only_by_folder(
    fields_by_folder: BTreeMap<String, Vec<String>>,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let cleaned = normalize_preview_fields_folder_only_by_folder(fields_by_folder);
    let value_json =
        serde_json::to_string(&cleaned).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let now_utc = Utc::now().to_rfc3339();
    let updated = repo_impl::set_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_PREVIEW_FIELDS_FOLDER_ONLY_BY_FOLDER,
        &value_json,
        &now_utc,
    )?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn get_bankcard_preview_fields(state: &Arc<AppState>) -> Result<BankCardPreviewFields> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let raw = repo_impl::get_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_BANKCARD_PREVIEW_FIELDS,
    )?;
    if let Some(value_json) = raw {
        let parsed: Result<BankCardPreviewFields> =
            serde_json::from_str(&value_json).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"));
        if let Ok(v) = parsed {
            return Ok(BankCardPreviewFields {
                fields: normalize_bankcard_preview_fields(v.fields),
                card_number_mode: normalize_bankcard_card_number_mode(v.card_number_mode),
            });
        }
    }

    Ok(BankCardPreviewFields::default())
}

pub fn set_bankcard_preview_fields(
    prefs: BankCardPreviewFields,
    state: &Arc<AppState>,
) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let cleaned = BankCardPreviewFields {
        fields: normalize_bankcard_preview_fields(prefs.fields),
        card_number_mode: normalize_bankcard_card_number_mode(prefs.card_number_mode),
    };
    let value_json =
        serde_json::to_string(&cleaned).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let now_utc = Utc::now().to_rfc3339();
    let updated = repo_impl::set_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_BANKCARD_PREVIEW_FIELDS,
        &value_json,
        &now_utc,
    )?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn get_datacard_core_hidden_fields(state: &Arc<AppState>) -> Result<Vec<String>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let raw = repo_impl::get_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_CORE_HIDDEN_FIELDS,
    )?;
    if let Some(value_json) = raw {
        let parsed: Result<Vec<String>> =
            serde_json::from_str(&value_json).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"));
        if let Ok(v) = parsed {
            return Ok(normalize_core_hidden_fields(v));
        }
    }

    Ok(Vec::new())
}

pub fn set_datacard_core_hidden_fields(fields: Vec<String>, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let cleaned = normalize_core_hidden_fields(fields);
    let value_json =
        serde_json::to_string(&cleaned).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let now_utc = Utc::now().to_rfc3339();
    let updated = repo_impl::set_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_DATACARD_CORE_HIDDEN_FIELDS,
        &value_json,
        &now_utc,
    )?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}

pub fn get_bankcard_core_hidden_fields(state: &Arc<AppState>) -> Result<Vec<String>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let raw = repo_impl::get_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_BANKCARD_CORE_HIDDEN_FIELDS,
    )?;
    if let Some(value_json) = raw {
        let parsed: Result<Vec<String>> =
            serde_json::from_str(&value_json).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"));
        if let Ok(v) = parsed {
            return Ok(normalize_bankcard_core_hidden_fields(v));
        }
    }

    Ok(Vec::new())
}

pub fn set_bankcard_core_hidden_fields(fields: Vec<String>, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;

    let cleaned = normalize_bankcard_core_hidden_fields(fields);
    let value_json =
        serde_json::to_string(&cleaned).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let now_utc = Utc::now().to_rfc3339();
    let updated = repo_impl::set_ui_preference_value_json(
        state,
        &profile_id,
        PREF_KEY_BANKCARD_CORE_HIDDEN_FIELDS,
        &value_json,
        &now_utc,
    )?;
    security_service::request_persist_active_vault(state.clone());
    Ok(updated)
}
