use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use serde::Serialize;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::{datacards_service, security_service};
use crate::types::{
    CreateDataCardInput, LegacyImportErrorRow, LegacyImportInspectResult, LegacyImportResult,
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

fn split_tags(value: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in value.split(',') {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|existing| existing.eq_ignore_ascii_case(trimmed)) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn fallback_title(row: &LegacyCsvRow) -> String {
    let title = row.title.trim();
    if !title.is_empty() {
        return title.to_string();
    }
    let url = row.url.trim();
    if !url.is_empty() {
        return url.to_string();
    }
    let email = row.email.trim();
    if !email.is_empty() {
        return email.to_string();
    }
    let username = row.username.trim();
    if !username.is_empty() {
        return username.to_string();
    }
    String::new()
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

    if !header_map
        .keys()
        .any(|key| supported_headers.contains(&key.as_str()))
    {
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
        });
    }

    Ok(out)
}

fn load_rows(path: &Path) -> Result<Vec<LegacyCsvRow>> {
    let content = read_text_lossy(path)?;
    parse_csv_rows(&content)
}

fn build_folder_lookup(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<HashMap<String, String>> {
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

pub fn inspect_csv_file(path: &Path, state: &Arc<AppState>) -> Result<LegacyImportInspectResult> {
    let rows = load_rows(path)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_lookup = build_folder_lookup(state, &profile_id)?;

    let mut unknown_folder_rows = 0_i64;
    let mut missing_title_rows = 0_i64;

    for row in &rows {
        if fallback_title(row).trim().is_empty() {
            missing_title_rows += 1;
        }

        let folder = row.folder.trim();
        if !folder.is_empty() && !folder_lookup.contains_key(&folder.to_lowercase()) {
            unknown_folder_rows += 1;
        }
    }

    Ok(LegacyImportInspectResult {
        total_rows: rows.len() as i64,
        unknown_folder_rows,
        missing_title_rows,
    })
}

fn make_error(row: &LegacyCsvRow, code: &str, message: &str) -> LegacyImportErrorRow {
    LegacyImportErrorRow {
        row_number: row.row_number,
        title: fallback_title(row),
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

pub fn import_csv_file(path: &Path, state: &Arc<AppState>) -> Result<LegacyImportResult> {
    let rows = load_rows(path)?;
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder_lookup = build_folder_lookup(state, &profile_id)?;

    let mut imported_count = 0_i64;
    let mut errors: Vec<LegacyImportErrorRow> = Vec::new();

    for row in &rows {
        let title = fallback_title(row);
        if title.trim().is_empty() {
            errors.push(make_error(
                row,
                "LEGACY_IMPORT_TITLE_REQUIRED",
                "Row does not have title or fallback value (url/email/username).",
            ));
            continue;
        }

        let folder_id = {
            let folder_name = row.folder.trim();
            if folder_name.is_empty() {
                None
            } else if let Some(folder_id) = folder_lookup.get(&folder_name.to_lowercase()) {
                Some(folder_id.clone())
            } else {
                errors.push(make_error(
                    row,
                    "LEGACY_IMPORT_FOLDER_NOT_FOUND",
                    "Folder from CSV was not found in the current vault.",
                ));
                continue;
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
            custom_fields: Vec::new(),
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
    use super::{fallback_title, parse_csv_rows, split_tags, LegacyCsvRow};

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
    fn fallback_title_prefers_title_then_url_then_email_then_username() {
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
        };
        assert_eq!(fallback_title(&row), "mail.ru");
    }

    #[test]
    fn split_tags_trims_and_deduplicates() {
        assert_eq!(split_tags(" work, personal, work ,, "), vec!["work", "personal"]);
    }
}
