use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;

use chrono::{Local, Utc};
use serde::Serialize;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::datacards_service;
use crate::services::folders_service;
use crate::services::security_service;
use crate::types::{
    new_custom_field_id, CreateDataCardInput, CreateFolderInput, CustomField, CustomFieldType,
    DataCard, LegacyImportErrorRow, LegacyImportInspectResult, LegacyImportResult,
};

#[derive(Debug, Clone)]
struct LegacyCsvRow {
    row_number: i64,
    title: String,
    url: String,
    email: String,
    recovery_email: String,
    username: String,
    password: String,
    mobile_phone: String,
    note: String,
    tags: String,
    folder: String,
    totp_uri: String,
    seed_phrase: String,
    attachments: String,
    favorite: String,
    archived: String,
    created_at: String,
    updated_at: String,
    custom_fields: Vec<CustomField>,
}

#[derive(Debug, Clone)]
struct LegacyCustomColumn {
    key: String,
    index: usize,
}

#[derive(Debug, Serialize)]
struct LegacyImportReport {
    generated_at_utc: String,
    imported_count: i64,
    error_count: i64,
    errors: Vec<LegacyImportErrorRow>,
}

fn read_text_lossy(path: &Path) -> Result<String> {
    let bytes =
        fs::read(path).map_err(|_| ErrorCodeString::new("LEGACY_IMPORT_FILE_READ_FAILED"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn normalize_header(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('\u{feff}')
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn trim_csv_header(value: &str) -> &str {
    value.trim().trim_start_matches('\u{feff}')
}

fn parse_custom_header_key(value: &str) -> Option<String> {
    let trimmed = trim_csv_header(value);
    let (prefix, rest) = trimmed.split_once(':')?;
    if !prefix.eq_ignore_ascii_case("custom field") && !prefix.eq_ignore_ascii_case("custom") {
        return None;
    }

    let key = rest.trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn split_tags(value: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in value.split(',') {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn normalized_title(row: &LegacyCsvRow) -> String {
    row.title.trim().to_string()
}

fn build_custom_fields(row: &[String], custom_columns: &[LegacyCustomColumn]) -> Vec<CustomField> {
    let mut values_by_key: HashMap<String, String> = HashMap::new();
    let mut key_order: Vec<String> = Vec::new();

    for column in custom_columns {
        let value = row
            .get(column.index)
            .map(|cell| cell.trim().to_string())
            .unwrap_or_default();

        if let Some(existing) = values_by_key.get_mut(&column.key) {
            if !value.is_empty() || existing.is_empty() {
                *existing = value;
            }
            continue;
        }

        key_order.push(column.key.clone());
        values_by_key.insert(column.key.clone(), value);
    }

    let mut out = Vec::new();
    for key in key_order {
        let value = values_by_key.remove(&key).unwrap_or_default();
        if value.is_empty() {
            continue;
        }
        out.push(CustomField {
            id: new_custom_field_id(),
            key,
            value,
            field_type: CustomFieldType::Text,
        });
    }

    out
}

fn parse_csv_records(content: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut chars = content.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if matches!(chars.peek(), Some('"')) {
                    field.push('"');
                    let _ = chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }

        match ch {
            '"' => in_quotes = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {
                if matches!(chars.peek(), Some('\n')) {
                    let _ = chars.next();
                }
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(ch),
        }
    }

    row.push(field);
    rows.push(row);
    rows
}

fn parse_csv_rows(content: &str) -> Result<Vec<LegacyCsvRow>> {
    let records = parse_csv_records(content);
    if records.is_empty() {
        return Ok(Vec::new());
    }

    let headers = &records[0];
    let header_map: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(idx, value)| (normalize_header(value), idx))
        .collect();

    let supported_headers = [
        "title",
        "url",
        "email",
        "recoveryemail",
        "username",
        "password",
        "mobilephone",
        "note",
        "tags",
        "folder",
        "totpuri",
        "seedphrase",
        "attachments",
        "favorite",
        "archived",
        "createdat",
        "updatedat",
    ];

    let has_supported_header = header_map
        .keys()
        .any(|key| supported_headers.contains(&key.as_str()));
    let custom_columns: Vec<LegacyCustomColumn> = headers
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| {
            parse_custom_header_key(value).map(|key| LegacyCustomColumn { key, index: idx })
        })
        .collect();

    if !has_supported_header && custom_columns.is_empty() {
        return Err(ErrorCodeString::new("LEGACY_IMPORT_CSV_HEADERS_INVALID"));
    }

    let get = |row: &[String], key: &str| -> String {
        let normalized_key = normalize_header(key);
        header_map
            .get(&normalized_key)
            .and_then(|idx| row.get(*idx))
            .map(|value| value.trim().to_string())
            .unwrap_or_default()
    };

    let mut out = Vec::new();

    for (idx, row) in records.iter().enumerate().skip(1) {
        if row.iter().all(|value| value.trim().is_empty()) {
            continue;
        }

        out.push(LegacyCsvRow {
            row_number: (idx + 1) as i64,
            title: get(row, "title"),
            url: get(row, "url"),
            email: get(row, "email"),
            recovery_email: get(row, "recovery email"),
            username: get(row, "username"),
            password: get(row, "password"),
            mobile_phone: get(row, "mobile phone"),
            note: get(row, "note"),
            tags: get(row, "tags"),
            folder: get(row, "folder"),
            totp_uri: get(row, "totp uri"),
            seed_phrase: get(row, "seed phrase"),
            attachments: get(row, "attachments"),
            favorite: get(row, "favorite"),
            archived: get(row, "archived"),
            created_at: get(row, "created at"),
            updated_at: get(row, "updated at"),
            custom_fields: build_custom_fields(row, &custom_columns),
        });
    }

    Ok(out)
}

fn load_rows(path: &Path) -> Result<Vec<LegacyCsvRow>> {
    let content = read_text_lossy(path)?;
    parse_csv_rows(&content)
}

fn normalize_folder_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_lowercase())
    }
}

fn build_folder_lookup(state: &Arc<AppState>, profile_id: &str) -> Result<HashMap<String, String>> {
    let folders = repo_impl::list_folders(state, profile_id)?;
    let mut out = HashMap::new();
    for folder in folders {
        if folder.is_system || folder.deleted_at.is_some() {
            continue;
        }
        out.insert(folder.name.trim().to_lowercase(), folder.id);
    }
    Ok(out)
}

fn collect_missing_folders(
    rows: &[LegacyCsvRow],
    folder_lookup: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();

    for row in rows {
        let folder_name = row.folder.trim();
        let Some(folder_key) = normalize_folder_key(folder_name) else {
            continue;
        };

        if folder_lookup.contains_key(&folder_key) || out.contains_key(&folder_key) {
            continue;
        }

        out.insert(folder_key, folder_name.to_string());
    }

    out
}

fn build_folder_name_lookup(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<HashMap<String, String>> {
    let folders = repo_impl::list_folders(state, profile_id)?;
    let mut out = HashMap::new();
    for folder in folders {
        if folder.is_system || folder.deleted_at.is_some() {
            continue;
        }
        out.insert(folder.id, folder.name.trim().to_string());
    }
    Ok(out)
}

fn normalize_export_file_name_part(value: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_underscore = false;

    for ch in value.trim().chars() {
        let next = if ch.is_ascii_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            '_'
        } else if ch.is_whitespace() {
            '_'
        } else {
            ch
        };

        if next == '_' {
            if !last_was_underscore {
                normalized.push('_');
            }
            last_was_underscore = true;
        } else {
            normalized.push(next);
            last_was_underscore = false;
        }
    }

    let normalized = normalized.trim_matches('_').to_string();
    if normalized.is_empty() {
        "vault".to_string()
    } else {
        normalized
    }
}

fn current_csv_export_date_prefix() -> String {
    Local::now().format("%d.%m.%y").to_string()
}

fn build_csv_export_file_name_with_date(
    vault_name: &str,
    profile_id: &str,
    selected: bool,
    date_prefix: &str,
) -> String {
    let selected_prefix = if selected { "selected_" } else { "" };
    format!(
        "{}_{}vault-name_{}_data-cards_profile-id_{}.csv",
        date_prefix,
        selected_prefix,
        normalize_export_file_name_part(vault_name),
        profile_id
    )
}

pub fn build_csv_export_file_name(vault_name: &str, profile_id: &str) -> String {
    build_csv_export_file_name_with_date(
        vault_name,
        profile_id,
        false,
        &current_csv_export_date_prefix(),
    )
}

pub fn build_selected_csv_export_file_name(vault_name: &str, profile_id: &str) -> String {
    build_csv_export_file_name_with_date(
        vault_name,
        profile_id,
        true,
        &current_csv_export_date_prefix(),
    )
}

pub fn build_active_csv_export_file_name(state: &Arc<AppState>, selected: bool) -> Result<String> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let active_vault_id = state
        .active_vault_id
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?
        .clone()
        .ok_or_else(|| ErrorCodeString::new("VAULT_NOT_OPEN"))?;
    let vault = repo_impl::get_vault(state, &profile_id, &active_vault_id)?;

    Ok(if selected {
        build_selected_csv_export_file_name(&vault.name, &profile_id)
    } else {
        build_csv_export_file_name(&vault.name, &profile_id)
    })
}

pub fn inspect_csv_file(path: &Path, state: &Arc<AppState>) -> Result<LegacyImportInspectResult> {
    let rows = load_rows(path)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_lookup = build_folder_lookup(state, &profile_id)?;
    let folders_to_create = collect_missing_folders(&rows, &folder_lookup);

    let mut missing_title_rows = 0_i64;

    for row in &rows {
        if normalized_title(row).trim().is_empty() {
            missing_title_rows += 1;
        }
    }

    Ok(LegacyImportInspectResult {
        total_rows: rows.len() as i64,
        unknown_folder_rows: 0,
        folders_to_create_count: folders_to_create.len() as i64,
        missing_title_rows,
    })
}

fn make_error(row: &LegacyCsvRow, code: &str, message: &str) -> LegacyImportErrorRow {
    LegacyImportErrorRow {
        row_number: row.row_number,
        title: normalized_title(row),
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn write_report(state: &Arc<AppState>, result: &LegacyImportResult) -> Result<String> {
    let report_dir = state.app_config_dir().join("import-reports");
    fs::create_dir_all(&report_dir)
        .map_err(|_| ErrorCodeString::new("LEGACY_IMPORT_REPORT_WRITE_FAILED"))?;

    let file_name = format!("legacy-import-{}.json", Utc::now().format("%Y%m%d-%H%M%S"));
    let report_path = report_dir.join(file_name);

    let payload = LegacyImportReport {
        generated_at_utc: Utc::now().to_rfc3339(),
        imported_count: result.imported_count,
        error_count: result.error_count,
        errors: result.errors.clone(),
    };

    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|_| ErrorCodeString::new("LEGACY_IMPORT_REPORT_WRITE_FAILED"))?;
    fs::write(&report_path, serialized)
        .map_err(|_| ErrorCodeString::new("LEGACY_IMPORT_REPORT_WRITE_FAILED"))?;

    Ok(report_path.to_string_lossy().to_string())
}

fn stringify_tags(tags: &[String]) -> String {
    tags.iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn stringify_attachments(card: &DataCard) -> String {
    card.attachments
        .iter()
        .filter(|attachment| attachment.deleted_at.is_none())
        .map(|attachment| attachment.file_name.trim())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CsvValueType {
    Text,
    Boolean,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CsvColumnSource {
    Title,
    Url,
    Email,
    RecoveryEmail,
    Username,
    Password,
    MobilePhone,
    Note,
    Tags,
    Folder,
    TotpUri,
    SeedPhrase,
    Attachments,
    Favorite,
    Archived,
}

#[derive(Debug, Clone, Copy)]
struct CsvColumnSpec {
    name: &'static str,
    source: CsvColumnSource,
    value_type: CsvValueType,
}

const CSV_PREFIX_COLUMNS: &[CsvColumnSpec] = &[
    CsvColumnSpec {
        name: "Title",
        source: CsvColumnSource::Title,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "URL",
        source: CsvColumnSource::Url,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Email",
        source: CsvColumnSource::Email,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Recovery email",
        source: CsvColumnSource::RecoveryEmail,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Username",
        source: CsvColumnSource::Username,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Password",
        source: CsvColumnSource::Password,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Mobile phone",
        source: CsvColumnSource::MobilePhone,
        value_type: CsvValueType::Text,
    },
];

const CSV_SUFFIX_COLUMNS: &[CsvColumnSpec] = &[
    CsvColumnSpec {
        name: "Note",
        source: CsvColumnSource::Note,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Tags",
        source: CsvColumnSource::Tags,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Folder",
        source: CsvColumnSource::Folder,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "TOTP URI",
        source: CsvColumnSource::TotpUri,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Seed phrase",
        source: CsvColumnSource::SeedPhrase,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Attachments",
        source: CsvColumnSource::Attachments,
        value_type: CsvValueType::Text,
    },
    CsvColumnSpec {
        name: "Favorite",
        source: CsvColumnSource::Favorite,
        value_type: CsvValueType::Boolean,
    },
    CsvColumnSpec {
        name: "Archived",
        source: CsvColumnSource::Archived,
        value_type: CsvValueType::Boolean,
    },
];

fn protect_formula_text(value: String) -> String {
    if matches!(value.chars().next(), Some('=') | Some('+') | Some('-') | Some('@')) {
        format!("'{value}")
    } else {
        value
    }
}

fn csv_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn serialize_csv_line<T: AsRef<str>>(fields: &[T]) -> String {
    fields
        .iter()
        .map(|value| csv_escape(value.as_ref()))
        .collect::<Vec<_>>()
        .join(",")
}

fn collect_export_custom_field_keys(cards: &[DataCard]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut keys: Vec<String> = Vec::new();

    for card in cards {
        for field in &card.custom_fields {
            let key = field.key.trim();
            if key.is_empty() {
                continue;
            }
            if seen.insert(key.to_string()) {
                keys.push(key.to_string());
            }
        }
    }

    keys.sort_by(|left, right| {
        left.to_lowercase()
            .cmp(&right.to_lowercase())
            .then_with(|| left.cmp(right))
    });
    keys
}

fn build_export_custom_field_value_lookup(fields: &[CustomField]) -> HashMap<String, String> {
    let mut values_by_key: HashMap<String, String> = HashMap::new();

    for field in fields {
        let key = field.key.trim();
        if key.is_empty() {
            continue;
        }

        let value = field.value.clone();
        if let Some(existing) = values_by_key.get_mut(key) {
            if !value.trim().is_empty() || existing.trim().is_empty() {
                *existing = value;
            }
            continue;
        }

        values_by_key.insert(key.to_string(), value);
    }

    values_by_key
}

fn csv_column_value(
    spec: CsvColumnSpec,
    card: &DataCard,
    folder_names_by_id: &HashMap<String, String>,
) -> String {
    let raw = match spec.source {
        CsvColumnSource::Title => card.title.clone(),
        CsvColumnSource::Url => card.url.clone().unwrap_or_default(),
        CsvColumnSource::Email => card.email.clone().unwrap_or_default(),
        CsvColumnSource::RecoveryEmail => card.recovery_email.clone().unwrap_or_default(),
        CsvColumnSource::Username => card.username.clone().unwrap_or_default(),
        CsvColumnSource::Password => card.password.clone().unwrap_or_default(),
        CsvColumnSource::MobilePhone => card.mobile_phone.clone().unwrap_or_default(),
        CsvColumnSource::Note => card.note.clone().unwrap_or_default(),
        CsvColumnSource::Tags => stringify_tags(&card.tags),
        CsvColumnSource::Folder => card
            .folder_id
            .as_ref()
            .and_then(|folder_id| folder_names_by_id.get(folder_id))
            .cloned()
            .unwrap_or_default(),
        CsvColumnSource::TotpUri => card.totp_uri.clone().unwrap_or_default(),
        CsvColumnSource::SeedPhrase => card.seed_phrase.clone().unwrap_or_default(),
        CsvColumnSource::Attachments => stringify_attachments(card),
        CsvColumnSource::Favorite => {
            if card.is_favorite {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        CsvColumnSource::Archived => {
            if card.archived_at.is_some() {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
    };

    match spec.value_type {
        CsvValueType::Text => protect_formula_text(raw),
        CsvValueType::Boolean => raw,
    }
}

pub(crate) fn build_data_cards_csv_content(
    cards: &[DataCard],
    folder_names_by_id: &HashMap<String, String>,
) -> String {
    let custom_keys = collect_export_custom_field_keys(cards);
    let mut lines: Vec<String> = Vec::with_capacity(cards.len() + 1);
    let mut header_fields: Vec<String> = CSV_PREFIX_COLUMNS
        .iter()
        .map(|spec| spec.name.to_string())
        .collect();
    header_fields.extend(custom_keys.iter().map(|key| format!("Custom field:{key}")));
    header_fields.extend(CSV_SUFFIX_COLUMNS.iter().map(|spec| spec.name.to_string()));
    lines.push(serialize_csv_line(&header_fields));

    for card in cards {
        let custom_values = build_export_custom_field_value_lookup(&card.custom_fields);

        let mut row_fields: Vec<String> = CSV_PREFIX_COLUMNS
            .iter()
            .map(|spec| csv_column_value(*spec, card, folder_names_by_id))
            .collect();
        row_fields.extend(custom_keys.iter().map(|key| {
            protect_formula_text(custom_values.get(key).cloned().unwrap_or_default())
        }));
        row_fields.extend(
            CSV_SUFFIX_COLUMNS
                .iter()
                .map(|spec| csv_column_value(*spec, card, folder_names_by_id)),
        );

        lines.push(serialize_csv_line(&row_fields));
    }

    format!("\u{feff}{}\r\n", lines.join("\r\n"))
}

pub fn export_csv_file(path: &Path, state: &Arc<AppState>) -> Result<String> {
    let cards = datacards_service::list_datacards(state)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_names_by_id = build_folder_name_lookup(state, &profile_id)?;
    let content = build_data_cards_csv_content(&cards, &folder_names_by_id);

    fs::write(path, content)
        .map_err(|_| ErrorCodeString::new("LEGACY_EXPORT_FILE_WRITE_FAILED"))?;

    Ok(path.to_string_lossy().to_string())
}

pub fn export_selected_datacards_csv_file(
    path: &Path,
    cards: &[DataCard],
    state: &Arc<AppState>,
) -> Result<String> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_names_by_id = build_folder_name_lookup(state, &profile_id)?;
    let content = build_data_cards_csv_content(cards, &folder_names_by_id);

    fs::write(path, content).map_err(|_| ErrorCodeString::new("SELECTED_CSV_EXPORT_FAILED"))?;

    Ok(path.to_string_lossy().to_string())
}

pub fn import_csv_file(path: &Path, state: &Arc<AppState>) -> Result<LegacyImportResult> {
    let rows = load_rows(path)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let mut folder_lookup = build_folder_lookup(state, &profile_id)?;
    let folders_to_create = collect_missing_folders(&rows, &folder_lookup);
    let mut folder_creation_errors: HashMap<String, String> = HashMap::new();
    let mut created_folder_count = 0_i64;

    for (folder_key, folder_name) in folders_to_create {
        match folders_service::create_folder(
            CreateFolderInput {
                name: folder_name.clone(),
                parent_id: None,
            },
            state,
        ) {
            Ok(folder) => {
                folder_lookup.insert(folder_key, folder.id);
                created_folder_count += 1;
            }
            Err(err) => {
                folder_creation_errors.insert(folder_key, err.code);
            }
        }
    }

    let mut imported_count = 0_i64;
    let mut errors: Vec<LegacyImportErrorRow> = Vec::new();

    for row in &rows {
        let title = normalized_title(row);

        let folder_id = match normalize_folder_key(&row.folder) {
            None => None,
            Some(folder_key) => {
                if let Some(folder_id) = folder_lookup.get(&folder_key) {
                    Some(folder_id.clone())
                } else if let Some(code) = folder_creation_errors.get(&folder_key) {
                    errors.push(make_error(
                        row,
                        code,
                        "Folder from CSV could not be created in the current vault.",
                    ));
                    continue;
                } else {
                    errors.push(make_error(
                        row,
                        "LEGACY_IMPORT_FOLDER_NOT_FOUND",
                        "Folder from CSV could not be resolved in the current vault.",
                    ));
                    continue;
                }
            }
        };

        let input = CreateDataCardInput {
            title,
            url: (!row.url.trim().is_empty()).then(|| row.url.trim().to_string()),
            email: (!row.email.trim().is_empty()).then(|| row.email.trim().to_string()),
            recovery_email: (!row.recovery_email.trim().is_empty())
                .then(|| row.recovery_email.trim().to_string()),
            username: (!row.username.trim().is_empty()).then(|| row.username.trim().to_string()),
            mobile_phone: (!row.mobile_phone.trim().is_empty())
                .then(|| row.mobile_phone.trim().to_string()),
            note: (!row.note.trim().is_empty()).then(|| row.note.trim().to_string()),
            tags: split_tags(&row.tags),
            password: (!row.password.trim().is_empty()).then(|| row.password.trim().to_string()),
            totp_uri: (!row.totp_uri.trim().is_empty()).then(|| row.totp_uri.trim().to_string()),
            seed_phrase: (!row.seed_phrase.trim().is_empty())
                .then(|| row.seed_phrase.trim().to_string()),
            seed_phrase_word_count: None,
            custom_fields: row.custom_fields.clone(),
            folder_id,
        };
        let _official_csv_metadata_fields = (
            &row.attachments,
            &row.favorite,
            &row.archived,
            &row.created_at,
            &row.updated_at,
        );

        match datacards_service::create_datacard(input, state) {
            Ok(_) => imported_count += 1,
            Err(err) => errors.push(make_error(
                row,
                &err.code,
                "Failed to create data card from CSV row.",
            )),
        }
    }

    if imported_count > 0 || created_folder_count > 0 {
        security_service::request_persist_active_vault(state.clone());
    }

    let mut result = LegacyImportResult {
        imported_count,
        error_count: errors.len() as i64,
        report_path: String::new(),
        errors,
    };
    result.report_path = write_report(state, &result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        build_csv_export_file_name, build_csv_export_file_name_with_date,
        build_selected_csv_export_file_name, export_csv_file, import_csv_file, inspect_csv_file,
        normalized_title, parse_csv_records, parse_csv_rows, split_tags, LegacyCsvRow,
    };
    use crate::data::sqlite::repo_impl;
    use crate::services::test_support::ServiceTestHarness;
    use crate::types::{new_custom_field_id, CreateDataCardInput, CustomField, CustomFieldType};

    #[test]
    fn csv_export_file_name_builder_adds_date_and_selected_prefix() {
        let regular = build_csv_export_file_name_with_date(
            "Default vault",
            "7a42c919-e33d-4f13-98f8-cec5ba61c14a",
            false,
            "28.04.26",
        );
        assert_eq!(
            regular,
            "28.04.26_vault-name_Default_vault_data-cards_profile-id_7a42c919-e33d-4f13-98f8-cec5ba61c14a.csv"
        );
        assert_eq!(
            build_csv_export_file_name_with_date(
                "Default vault",
                "7a42c919-e33d-4f13-98f8-cec5ba61c14a",
                true,
                "28.04.26",
            ),
            "28.04.26_selected_vault-name_Default_vault_data-cards_profile-id_7a42c919-e33d-4f13-98f8-cec5ba61c14a.csv"
        );
    }

    #[test]
    fn csv_export_file_name_builder_uses_current_date_for_public_helpers() {
        let today = chrono::Local::now().format("%d.%m.%y").to_string();
        assert!(build_csv_export_file_name("Default vault", "profile").starts_with(&format!("{today}_vault-name_")));
        assert!(build_selected_csv_export_file_name("Default vault", "profile")
            .starts_with(&format!("{today}_selected_vault-name_")));
    }

    #[test]
    fn parse_csv_rows_handles_quotes_and_headers() {
        let csv = "Title,URL,Recovery email,Mobile phone\n\"Mail, personal\",mail.ru,recovery@example.com,+123\n";
        let rows = parse_csv_rows(csv).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Mail, personal");
        assert_eq!(rows[0].url, "mail.ru");
        assert_eq!(rows[0].recovery_email, "recovery@example.com");
        assert_eq!(rows[0].mobile_phone, "+123");
    }

    #[test]
    fn parse_csv_rows_ignores_unsupported_extra_columns() {
        let csv = "title,status,url\nMail,review_required,mail.ru\n";
        let rows = parse_csv_rows(csv).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Mail");
        assert_eq!(rows[0].url, "mail.ru");
    }

    #[test]
    fn parse_csv_rows_reads_custom_columns_as_text_fields() {
        let csv =
            "Title,Custom field:API Key,custom field:Server,Custom field:API Key\nMail,alpha,prod,override\n";
        let rows = parse_csv_rows(csv).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].custom_fields.len(), 2);
        assert_eq!(rows[0].custom_fields[0].key, "API Key");
        assert_eq!(rows[0].custom_fields[0].value, "override");
        assert!(matches!(
            rows[0].custom_fields[0].field_type,
            CustomFieldType::Text
        ));
        assert_eq!(rows[0].custom_fields[1].key, "Server");
        assert_eq!(rows[0].custom_fields[1].value, "prod");
    }

    #[test]
    fn parse_csv_rows_allows_custom_only_headers() {
        let csv = "Custom field:API Key,Custom field:Comment\nsecret,hello\n";
        let rows = parse_csv_rows(csv).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "");
        assert_eq!(rows[0].custom_fields.len(), 2);
        assert_eq!(rows[0].custom_fields[0].key, "API Key");
        assert_eq!(rows[0].custom_fields[0].value, "secret");
        assert_eq!(rows[0].custom_fields[1].key, "Comment");
        assert_eq!(rows[0].custom_fields[1].value, "hello");
    }

    #[test]
    fn normalized_title_keeps_empty_title_even_when_url_exists() {
        let row = LegacyCsvRow {
            row_number: 2,
            title: String::new(),
            url: "mail.ru".to_string(),
            email: "mail@example.com".to_string(),
            recovery_email: String::new(),
            username: "user".to_string(),
            password: String::new(),
            mobile_phone: String::new(),
            note: String::new(),
            tags: String::new(),
            folder: String::new(),
            totp_uri: String::new(),
            seed_phrase: String::new(),
            attachments: String::new(),
            favorite: String::new(),
            archived: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            custom_fields: Vec::new(),
        };
        assert_eq!(normalized_title(&row), "");
    }

    #[test]
    fn split_tags_trims_and_deduplicates() {
        assert_eq!(
            split_tags(" work, personal, work ,, "),
            vec!["work", "personal"]
        );
    }

    #[test]
    fn import_csv_file_supports_more_than_99_rows() {
        let harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-import.csv");

        let mut csv = String::from("Title,Password\n");
        for idx in 1..=120 {
            csv.push_str(&format!("Entry {idx},password-{idx}\n"));
        }
        fs::write(&csv_path, csv).unwrap();

        let result = import_csv_file(&csv_path, &harness.state).unwrap();

        assert_eq!(result.imported_count, 120);
        assert_eq!(result.error_count, 0);

        let rows = repo_impl::list_datacards_summary(
            &harness.state,
            &harness.profile_id,
            "updated_at",
            "DESC",
        )
        .unwrap();
        assert_eq!(rows.len(), 120);
    }

    #[test]
    fn import_csv_file_keeps_empty_title_instead_of_using_url() {
        let harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-import-empty-title.csv");

        fs::write(
            &csv_path,
            "Title,URL,Username\n,https://example.com,user1\n",
        )
        .unwrap();

        let result = import_csv_file(&csv_path, &harness.state).unwrap();

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.error_count, 0);

        let cards = repo_impl::list_datacards(
            &harness.state,
            &harness.profile_id,
            false,
            "updated_at",
            "DESC",
        )
        .unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].title, "");
        assert_eq!(cards[0].url.as_deref(), Some("https://example.com"));
        assert_eq!(cards[0].username.as_deref(), Some("user1"));
    }

    #[test]
    fn import_csv_file_creates_text_custom_fields_from_custom_columns() {
        let harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-import-custom-fields.csv");

        fs::write(
            &csv_path,
            "Title,Custom field:API Key,Custom field:Server,Custom field:Empty\nMail,alpha,prod,\n",
        )
        .unwrap();

        let result = import_csv_file(&csv_path, &harness.state).unwrap();

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.error_count, 0);

        let cards = repo_impl::list_datacards(
            &harness.state,
            &harness.profile_id,
            false,
            "updated_at",
            "DESC",
        )
        .unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].custom_fields.len(), 2);
        assert_eq!(cards[0].custom_fields[0].key, "API Key");
        assert_eq!(cards[0].custom_fields[0].value, "alpha");
        assert!(matches!(
            cards[0].custom_fields[0].field_type,
            CustomFieldType::Text
        ));
        assert_eq!(cards[0].custom_fields[1].key, "Server");
        assert_eq!(cards[0].custom_fields[1].value, "prod");
    }

    #[test]
    fn inspect_csv_file_reports_folders_to_create() {
        let harness = ServiceTestHarness::new();
        let _existing = harness.create_folder("Work", None);
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-import-inspect.csv");

        fs::write(
            &csv_path,
            "Title,Folder\nPersonal mail,Personal\nWork mail,Work\nPersonal docs, Personal \n",
        )
        .unwrap();

        let inspect = inspect_csv_file(&csv_path, &harness.state).unwrap();

        assert_eq!(inspect.total_rows, 3);
        assert_eq!(inspect.unknown_folder_rows, 0);
        assert_eq!(inspect.folders_to_create_count, 1);
        assert_eq!(inspect.missing_title_rows, 0);
    }

    #[test]
    fn import_csv_file_creates_missing_folders_once_and_assigns_cards() {
        let harness = ServiceTestHarness::new();
        let existing = harness.create_folder("Work", None);
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-import-folders.csv");

        fs::write(
            &csv_path,
            "Title,Folder\nPersonal mail,Personal\nPersonal docs, personal \nWork wiki,Work\n",
        )
        .unwrap();

        let result = import_csv_file(&csv_path, &harness.state).unwrap();

        assert_eq!(result.imported_count, 3);
        assert_eq!(result.error_count, 0);

        let folders = repo_impl::list_folders(&harness.state, &harness.profile_id).unwrap();
        let personal_folders: Vec<_> = folders
            .iter()
            .filter(|folder| !folder.is_system && folder.name == "Personal")
            .collect();
        assert_eq!(personal_folders.len(), 1);

        let personal_folder_id = personal_folders[0].id.clone();
        let cards = repo_impl::list_datacards(
            &harness.state,
            &harness.profile_id,
            false,
            "updated_at",
            "DESC",
        )
        .unwrap();

        let personal_cards: Vec<_> = cards
            .iter()
            .filter(|card| card.folder_id.as_deref() == Some(personal_folder_id.as_str()))
            .collect();
        assert_eq!(personal_cards.len(), 2);

        let work_cards: Vec<_> = cards
            .iter()
            .filter(|card| card.folder_id.as_deref() == Some(existing.id.as_str()))
            .collect();
        assert_eq!(work_cards.len(), 1);
    }

    #[test]
    fn export_csv_file_writes_import_compatible_rows() {
        let harness = ServiceTestHarness::new();
        let folder = harness.create_folder("Work", None);
        let _bank_card = harness.create_bank_card("Visa", None);
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-export.csv");

        let card = repo_impl::create_datacard(
            &harness.state,
            &harness.profile_id,
            &CreateDataCardInput {
                title: "Mail, personal".to_string(),
                url: Some("https://example.com".to_string()),
                email: Some("mail@example.com".to_string()),
                recovery_email: Some("recovery@example.com".to_string()),
                username: Some("user1".to_string()),
                mobile_phone: Some("+123".to_string()),
                note: Some("Line 1\nLine \"2\"".to_string()),
                tags: vec!["work".to_string(), "personal".to_string()],
                password: Some("p@ss,word".to_string()),
                totp_uri: Some("otpauth://totp/test".to_string()),
                seed_phrase: Some(
                    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"
                        .to_string(),
                ),
                seed_phrase_word_count: Some(12),
                custom_fields: vec![
                    CustomField {
                        id: new_custom_field_id(),
                        key: "API Key".to_string(),
                        value: "secret, value".to_string(),
                        field_type: CustomFieldType::Secret,
                    },
                    CustomField {
                        id: new_custom_field_id(),
                        key: "Comment".to_string(),
                        value: "Line A\nLine B".to_string(),
                        field_type: CustomFieldType::Text,
                    },
                ],
                folder_id: Some(folder.id.clone()),
            },
        )
        .unwrap();
        harness.create_attachment(&card.id, "export-attachment");

        let exported_path = export_csv_file(&csv_path, &harness.state).unwrap();
        assert_eq!(exported_path, csv_path.to_string_lossy().to_string());

        let content = fs::read_to_string(&csv_path).unwrap();
        let rows = parse_csv_rows(&content).unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Mail, personal");
        assert_eq!(rows[0].url, "https://example.com");
        assert_eq!(rows[0].email, "mail@example.com");
        assert_eq!(rows[0].recovery_email, "recovery@example.com");
        assert_eq!(rows[0].username, "user1");
        assert_eq!(rows[0].password, "p@ss,word");
        assert_eq!(rows[0].mobile_phone, "'+123");
        assert_eq!(rows[0].note, "Line 1\nLine \"2\"");
        assert_eq!(rows[0].tags, "work, personal");
        assert_eq!(rows[0].folder, "Work");
        assert_eq!(rows[0].totp_uri, "otpauth://totp/test");
        assert_eq!(
            rows[0].seed_phrase,
            "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"
        );
        assert_eq!(rows[0].attachments, "export-attachment.bin");
        assert_eq!(rows[0].favorite, "false");
        assert_eq!(rows[0].archived, "false");
        assert_eq!(rows[0].custom_fields.len(), 2);
        assert_eq!(rows[0].custom_fields[0].key, "API Key");
        assert_eq!(rows[0].custom_fields[0].value, "secret, value");
        assert!(matches!(
            rows[0].custom_fields[0].field_type,
            CustomFieldType::Text
        ));
        assert_eq!(rows[0].custom_fields[1].key, "Comment");
        assert_eq!(rows[0].custom_fields[1].value, "Line A\nLine B");
    }

    #[test]
    fn export_csv_file_builds_union_of_custom_columns_for_multiple_cards() {
        let harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-export-custom-union.csv");

        let _first = repo_impl::create_datacard(
            &harness.state,
            &harness.profile_id,
            &CreateDataCardInput {
                title: "Mail".to_string(),
                url: None,
                email: None,
                recovery_email: None,
                username: None,
                mobile_phone: None,
                note: None,
                tags: Vec::new(),
                password: None,
                totp_uri: None,
                seed_phrase: None,
                seed_phrase_word_count: None,
                custom_fields: vec![CustomField {
                    id: new_custom_field_id(),
                    key: "API Key".to_string(),
                    value: "alpha".to_string(),
                    field_type: CustomFieldType::Secret,
                }],
                folder_id: None,
            },
        )
        .unwrap();

        let _second = repo_impl::create_datacard(
            &harness.state,
            &harness.profile_id,
            &CreateDataCardInput {
                title: "Infra".to_string(),
                url: None,
                email: None,
                recovery_email: None,
                username: None,
                mobile_phone: None,
                note: None,
                tags: Vec::new(),
                password: None,
                totp_uri: None,
                seed_phrase: None,
                seed_phrase_word_count: None,
                custom_fields: vec![CustomField {
                    id: new_custom_field_id(),
                    key: "Server".to_string(),
                    value: "prod".to_string(),
                    field_type: CustomFieldType::Text,
                }],
                folder_id: None,
            },
        )
        .unwrap();

        export_csv_file(&csv_path, &harness.state).unwrap();

        let content = fs::read_to_string(&csv_path).unwrap();
        let records: Vec<Vec<String>> = parse_csv_records(&content)
            .into_iter()
            .filter(|row| row.iter().any(|value| !value.is_empty()))
            .collect();

        assert_eq!(records.len(), 3);
        assert_eq!(records[0][0].trim_start_matches('\u{feff}'), "Title");
        assert_eq!(records[0][7], "Custom field:API Key");
        assert_eq!(records[0][8], "Custom field:Server");
        assert_eq!(records[0][9], "Note");
        assert!(!records[0].iter().any(|header| header == "Seed phrase word count"));

        let mail_row = records
            .iter()
            .find(|row| row.first().map(|v| v.as_str()) == Some("Mail"))
            .unwrap();
        assert_eq!(mail_row[7], "alpha");
        assert_eq!(mail_row[8], "");

        let infra_row = records
            .iter()
            .find(|row| row.first().map(|v| v.as_str()) == Some("Infra"))
            .unwrap();
        assert_eq!(infra_row[7], "");
        assert_eq!(infra_row[8], "prod");
    }

    #[test]
    fn export_csv_file_uses_official_order_and_formula_protection() {
        let harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-export-official-order.csv");

        repo_impl::create_datacard(
            &harness.state,
            &harness.profile_id,
            &CreateDataCardInput {
                title: "=1+1".to_string(),
                url: Some("+https://example.com".to_string()),
                email: None,
                recovery_email: None,
                username: Some("@user".to_string()),
                mobile_phone: None,
                note: Some("-note".to_string()),
                tags: vec!["work".to_string()],
                password: Some("secret".to_string()),
                totp_uri: None,
                seed_phrase: None,
                seed_phrase_word_count: Some(12),
                custom_fields: vec![CustomField {
                    id: new_custom_field_id(),
                    key: "API Key".to_string(),
                    value: "=secret".to_string(),
                    field_type: CustomFieldType::Secret,
                }],
                folder_id: None,
            },
        )
        .unwrap();

        export_csv_file(&csv_path, &harness.state).unwrap();

        let records = parse_csv_records(&fs::read_to_string(&csv_path).unwrap());
        let header = &records[0];
        assert_eq!(header[0].trim_start_matches('\u{feff}'), "Title");
        assert_eq!(header[1], "URL");
        assert_eq!(header[2], "Email");
        assert_eq!(header[3], "Recovery email");
        assert_eq!(header[4], "Username");
        assert_eq!(header[5], "Password");
        assert_eq!(header[6], "Mobile phone");
        assert_eq!(header[7], "Custom field:API Key");
        assert_eq!(header[8], "Note");
        assert_eq!(header[9], "Tags");
        assert_eq!(header[10], "Folder");
        assert_eq!(header[11], "TOTP URI");
        assert_eq!(header[12], "Seed phrase");
        assert_eq!(header[13], "Attachments");
        assert_eq!(header[14], "Favorite");
        assert_eq!(header[15], "Archived");
        assert_eq!(header.len(), 16);
        assert!(!header.iter().any(|value| value == "Seed phrase word count"));
        assert!(!header.iter().any(|value| value == "Created at"));
        assert!(!header.iter().any(|value| value == "Updated at"));

        let row = &records[1];
        assert_eq!(row[0], "'=1+1");
        assert_eq!(row[1], "'+https://example.com");
        assert_eq!(row[4], "'@user");
        assert_eq!(row[7], "'=secret");
        assert_eq!(row[8], "'-note");
        assert_eq!(row[14], "false");
        assert_eq!(row[15], "false");
    }

    #[test]
    fn export_and_reimport_roundtrip_preserves_custom_field_values() {
        let export_harness = ServiceTestHarness::new();
        let temp = tempdir().unwrap();
        let csv_path = temp.path().join("legacy-export-roundtrip.csv");

        let _card = repo_impl::create_datacard(
            &export_harness.state,
            &export_harness.profile_id,
            &CreateDataCardInput {
                title: "Mail".to_string(),
                url: None,
                email: None,
                recovery_email: None,
                username: None,
                mobile_phone: None,
                note: None,
                tags: Vec::new(),
                password: None,
                totp_uri: None,
                seed_phrase: None,
                seed_phrase_word_count: None,
                custom_fields: vec![
                    CustomField {
                        id: new_custom_field_id(),
                        key: "API Key".to_string(),
                        value: "alpha".to_string(),
                        field_type: CustomFieldType::Secret,
                    },
                    CustomField {
                        id: new_custom_field_id(),
                        key: "Server".to_string(),
                        value: "prod".to_string(),
                        field_type: CustomFieldType::Url,
                    },
                ],
                folder_id: None,
            },
        )
        .unwrap();

        export_csv_file(&csv_path, &export_harness.state).unwrap();

        let import_harness = ServiceTestHarness::new();
        let result = import_csv_file(&csv_path, &import_harness.state).unwrap();

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.error_count, 0);

        let cards = repo_impl::list_datacards(
            &import_harness.state,
            &import_harness.profile_id,
            false,
            "updated_at",
            "DESC",
        )
        .unwrap();

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].custom_fields.len(), 2);
        assert_eq!(cards[0].custom_fields[0].key, "API Key");
        assert_eq!(cards[0].custom_fields[0].value, "alpha");
        assert!(matches!(
            cards[0].custom_fields[0].field_type,
            CustomFieldType::Text
        ));
        assert_eq!(cards[0].custom_fields[1].key, "Server");
        assert_eq!(cards[0].custom_fields[1].value, "prod");
    }
}
