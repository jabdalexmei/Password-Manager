use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
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

fn build_export_content(
    cards: &[DataCard],
    folder_names_by_id: &HashMap<String, String>,
) -> String {
    let custom_keys = collect_export_custom_field_keys(cards);
    let mut lines: Vec<String> = Vec::with_capacity(cards.len() + 1);
    let mut header_fields: Vec<String> = vec![
        "Title",
        "URL",
        "Email",
        "Recovery email",
        "Username",
        "Password",
        "Mobile phone",
        "Note",
        "Tags",
        "Folder",
    ]
    .into_iter()
    .map(|value| value.to_string())
    .collect();
    header_fields.extend(custom_keys.iter().map(|key| format!("Custom field:{key}")));
    lines.push(serialize_csv_line(&header_fields));

    for card in cards {
        let tags = stringify_tags(&card.tags);
        let folder_name = card
            .folder_id
            .as_ref()
            .and_then(|folder_id| folder_names_by_id.get(folder_id))
            .cloned()
            .unwrap_or_default();
        let custom_values = build_export_custom_field_value_lookup(&card.custom_fields);

        let mut row_fields = vec![
            card.title.clone(),
            card.url.clone().unwrap_or_default(),
            card.email.clone().unwrap_or_default(),
            card.recovery_email.clone().unwrap_or_default(),
            card.username.clone().unwrap_or_default(),
            card.password.clone().unwrap_or_default(),
            card.mobile_phone.clone().unwrap_or_default(),
            card.note.clone().unwrap_or_default(),
            tags,
            folder_name,
        ];
        row_fields.extend(
            custom_keys
                .iter()
                .map(|key| custom_values.get(key).cloned().unwrap_or_default()),
        );

        lines.push(serialize_csv_line(&row_fields));
    }

    format!("\u{feff}{}\r\n", lines.join("\r\n"))
}

pub fn export_csv_file(path: &Path, state: &Arc<AppState>) -> Result<String> {
    let cards = datacards_service::list_datacards(state)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_names_by_id = build_folder_name_lookup(state, &profile_id)?;
    let content = build_export_content(&cards, &folder_names_by_id);

    fs::write(path, content)
        .map_err(|_| ErrorCodeString::new("LEGACY_EXPORT_FILE_WRITE_FAILED"))?;

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
            totp_uri: None,
            seed_phrase: None,
            seed_phrase_word_count: None,
            custom_fields: row.custom_fields.clone(),
            folder_id,
        };

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
        export_csv_file, import_csv_file, inspect_csv_file, normalized_title, parse_csv_records,
        parse_csv_rows, split_tags, LegacyCsvRow,
    };
    use crate::data::sqlite::repo_impl;
    use crate::services::test_support::ServiceTestHarness;
    use crate::types::{new_custom_field_id, CreateDataCardInput, CustomField, CustomFieldType};

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

        let _card = repo_impl::create_datacard(
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
        assert_eq!(rows[0].mobile_phone, "+123");
        assert_eq!(rows[0].note, "Line 1\nLine \"2\"");
        assert_eq!(rows[0].tags, "work, personal");
        assert_eq!(rows[0].folder, "Work");
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
        assert_eq!(records[0][10], "Custom field:API Key");
        assert_eq!(records[0][11], "Custom field:Server");

        let mail_row = records
            .iter()
            .find(|row| row.first().map(|v| v.as_str()) == Some("Mail"))
            .unwrap();
        assert_eq!(mail_row[10], "alpha");
        assert_eq!(mail_row[11], "");

        let infra_row = records
            .iter()
            .find(|row| row.first().map(|v| v.as_str()) == Some("Infra"))
            .unwrap();
        assert_eq!(infra_row[10], "");
        assert_eq!(infra_row[11], "prod");
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
