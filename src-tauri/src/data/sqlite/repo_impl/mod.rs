use chrono::Utc;
use rusqlite::params;
use rusqlite::types::Type;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use uuid::Uuid;

use super::diagnostics::log_sqlite_err;
use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::types::{
    AttachmentMeta, BankCardItem, BankCardSummary, CreateBankCardInput, CreateDataCardInput,
    CustomField, DataCard, DataCardSummary, Folder, PasswordHistoryRow, SetBankCardArchivedInput,
    SetBankCardFavoriteInput, SetDataCardArchivedInput, SetDataCardFavoriteInput,
    UpdateBankCardInput, UpdateDataCardInput, Vault,
};

use std::sync::Arc;

mod connection;
mod datacards;
mod bank_cards;
mod folders;
mod attachments;
mod vaults;
mod settings;
mod ui_prefs;
mod trash;
mod password_history;

use connection::{
    deserialize_json, get_default_vault_id_conn, serialize_json, with_connection,
    with_connection_in_active_vault,
};

pub use attachments::*;
pub use bank_cards::*;
pub use datacards::*;
pub use folders::*;
pub use password_history::*;
pub use trash::*;
pub use ui_prefs::*;
pub use vaults::*;

fn normalize_for_search(input: &str) -> String {
    input.to_lowercase()
}

fn matches_all_tokens(haystack: &str, query: &str) -> bool {
    let q = normalize_for_search(query);
    let tokens: Vec<&str> = q.split_whitespace().filter(|t| !t.is_empty()).collect();
    if tokens.is_empty() {
        return true;
    }
    let h = normalize_for_search(haystack);
    tokens.into_iter().all(|t| h.contains(t))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DataCardSearchField {
    Title,
    Url,
    Email,
    RecoveryEmail,
    Username,
    MobilePhone,
    Password,
    Note,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DataCardSearchTerm {
    FreeText(String),
    Field {
        field: DataCardSearchField,
        value: String,
    },
}

fn tokenize_search_query(input: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut escaped = false;

    for ch in input.chars() {
        if escaped {
            cur.push(ch);
            escaped = false;
            continue;
        }

        if in_quotes && ch == '\\' {
            escaped = true;
            continue;
        }

        if ch == '"' {
            in_quotes = !in_quotes;
            cur.push(ch);
            continue;
        }

        if !in_quotes && ch.is_whitespace() {
            if !cur.trim().is_empty() {
                tokens.push(cur.trim().to_string());
            }
            cur.clear();
            continue;
        }

        cur.push(ch);
    }

    if !cur.trim().is_empty() {
        tokens.push(cur.trim().to_string());
    }

    tokens
}

fn strip_wrapping_quotes(input: &str) -> String {
    let s = input.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        return s[1..s.len() - 1].to_string();
    }
    s.to_string()
}

fn canonicalize_datacard_field_key(raw: &str) -> String {
    let key = raw.trim().to_lowercase();
    match key.as_str() {
        "mail" => "email".to_string(),
        "tags" => "tag".to_string(),
        "notes" => "note".to_string(),
        "site" => "url".to_string(),
        "recoveryemail" => "recovery_email".to_string(),
        "mobilephone" => "mobile_phone".to_string(),
        _ => key,
    }
}

fn parse_datacard_search_term(token: &str) -> Option<DataCardSearchTerm> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }

    let Some(pos) = token.find(':') else {
        return Some(DataCardSearchTerm::FreeText(strip_wrapping_quotes(token)));
    };

    let (field_raw, value_raw_with_colon) = token.split_at(pos);
    let value_raw = &value_raw_with_colon[1..]; // skip ':'

    if field_raw.trim().is_empty() || value_raw.trim().is_empty() {
        // Treat as plain text (e.g. "http://", "email:" with empty value, etc.)
        return Some(DataCardSearchTerm::FreeText(strip_wrapping_quotes(token)));
    }

    let key = canonicalize_datacard_field_key(field_raw);
    let field = match key.as_str() {
        "title" => DataCardSearchField::Title,
        "url" => DataCardSearchField::Url,
        "email" => DataCardSearchField::Email,
        "recovery_email" => DataCardSearchField::RecoveryEmail,
        "username" => DataCardSearchField::Username,
        "mobile_phone" => DataCardSearchField::MobilePhone,
        "password" => DataCardSearchField::Password,
        "note" => DataCardSearchField::Note,
        "tag" => DataCardSearchField::Tag,
        _ => {
            return Some(DataCardSearchTerm::FreeText(strip_wrapping_quotes(token)));
        }
    };

    let value = strip_wrapping_quotes(value_raw);
    if value.trim().is_empty() {
        return Some(DataCardSearchTerm::FreeText(strip_wrapping_quotes(token)));
    }

    Some(DataCardSearchTerm::Field { field, value })
}

fn parse_datacard_search_terms(query: &str) -> Vec<DataCardSearchTerm> {
    tokenize_search_query(query)
        .into_iter()
        .filter_map(|t| parse_datacard_search_term(&t))
        .filter(|t| match t {
            DataCardSearchTerm::FreeText(v) => !v.trim().is_empty(),
            DataCardSearchTerm::Field { value, .. } => !value.trim().is_empty(),
        })
        .collect()
}


fn map_folder(row: &rusqlite::Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get("id")?,
        name: row.get("name")?,
        parent_id: row.get("parent_id")?,
        is_system: row.get::<_, i64>("is_system")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn map_vault(row: &rusqlite::Row) -> rusqlite::Result<Vault> {
    Ok(Vault {
        id: row.get("id")?,
        name: row.get("name")?,
        is_default: row.get::<_, i64>("is_default")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_datacard(row: &rusqlite::Row) -> rusqlite::Result<DataCard> {
    Ok(DataCard {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        title: row.get("title")?,
        url: row.get("url")?,
        email: row.get("email")?,
        recovery_email: row.get("recovery_email")?,
        username: row.get("username")?,
        mobile_phone: row.get("mobile_phone")?,
        note: row.get("note")?,
        is_favorite: row.get::<_, i64>("is_favorite")? != 0,
        tags: deserialize_json(row.get::<_, String>("tags_json")?)?,
        preview_fields: deserialize_json(row.get::<_, String>("preview_fields_json")?)?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        deleted_at: row.get("deleted_at")?,
        password: row.get("password_value")?,
        totp_uri: row.get("totp_uri")?,
        seed_phrase: row.get("seed_phrase_value")?,
        seed_phrase_word_count: row.get("seed_phrase_word_count")?,
        custom_fields: deserialize_json(row.get::<_, String>("custom_fields_json")?)?,
    })
}

fn map_datacard_summary(row: &rusqlite::Row) -> rusqlite::Result<DataCardSummary> {
    let tags: Vec<String> = deserialize_json(row.get::<_, String>("tags_json")?)?;
    let custom_fields: Vec<CustomField> =
        deserialize_json(row.get::<_, String>("custom_fields_json")?).unwrap_or_default();
    let is_favorite = row.get::<_, i64>("is_favorite")? != 0;
    let has_totp = row.get::<_, Option<String>>("totp_uri")?.is_some();
    let has_seed_phrase = row.get::<_, i64>("has_seed_phrase")? != 0;
    let has_phone = row.get::<_, i64>("has_phone")? != 0;
    let has_note = row.get::<_, i64>("has_note")? != 0;
    let has_attachments = row.get::<_, i64>("has_attachments")? != 0;

    Ok(DataCardSummary {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        title: row.get("title")?,
        url: row.get("url")?,
        email: row.get("email")?,
        recovery_email: row.get("recovery_email")?,
        username: row.get("username")?,
        mobile_phone: row.get("mobile_phone")?,
        note: row.get("note")?,
        tags,
        preview_fields: deserialize_json(row.get::<_, String>("preview_fields_json")?)?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        deleted_at: row.get("deleted_at")?,
        is_favorite,
        has_totp,
        has_seed_phrase,
        has_phone,
        has_note,
        has_attachments,

        // Needed for rendering per-card-only custom preview fields in the list view.
        custom_fields,
    })
}

fn map_bank_card(row: &rusqlite::Row) -> rusqlite::Result<BankCardItem> {
    Ok(BankCardItem {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        title: row.get("title")?,
        bank_name: row.get("bank_name")?,
        holder: row.get("holder")?,
        number: row.get("number")?,
        expiry_mm_yy: row.get("expiry_mm_yy")?,
        cvc: row.get("cvc")?,
        note: row.get("note")?,
        tags: deserialize_json(
            row.get::<_, Option<String>>("tags_json")?
                .unwrap_or_else(|| "[]".to_string()),
        )?,
        preview_fields: deserialize_json(
            row.get::<_, Option<String>>("preview_fields_json")?
                .unwrap_or_else(|| "{}".to_string()),
        )?,
        is_favorite: row.get::<_, i64>("is_favorite")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn map_bank_card_summary(row: &rusqlite::Row) -> rusqlite::Result<BankCardSummary> {
    let tags: Vec<String> = deserialize_json(
        row.get::<_, Option<String>>("tags_json")?
            .unwrap_or_else(|| "[]".to_string()),
    )?;
    let is_favorite = row.get::<_, i64>("is_favorite")? != 0;

    Ok(BankCardSummary {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        title: row.get("title")?,
        bank_name: row.get("bank_name")?,
        holder: row.get("holder")?,
        number: row.get("number")?,
        note: row.get("note")?,
        tags,
        preview_fields: deserialize_json(
            row.get::<_, Option<String>>("preview_fields_json")?
                .unwrap_or_else(|| "{}".to_string()),
        )?,
        is_favorite,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn map_attachment(row: &rusqlite::Row) -> rusqlite::Result<AttachmentMeta> {
    Ok(AttachmentMeta {
        id: row.get("id")?,
        datacard_id: row.get("datacard_id")?,
        file_name: row.get("file_name")?,
        mime_type: row.get("mime_type")?,
        byte_size: row.get("byte_size")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn map_password_history_row(row: &rusqlite::Row) -> rusqlite::Result<PasswordHistoryRow> {
    Ok(PasswordHistoryRow {
        id: row.get("id")?,
        datacard_id: row.get("datacard_id")?,
        password_value: row.get("password_value")?,
        created_at: row.get("created_at")?,
    })
}

fn order_clause(sort_field: &str, sort_dir: &str) -> Option<&'static str> {
    match (sort_field, sort_dir) {
        ("updated_at", "DESC") => Some("ORDER BY updated_at DESC, title ASC"),
        ("updated_at", "ASC") => Some("ORDER BY updated_at ASC, title ASC"),
        ("created_at", "DESC") => Some("ORDER BY created_at DESC, title ASC"),
        ("created_at", "ASC") => Some("ORDER BY created_at ASC, title ASC"),
        ("title", "ASC") => Some("ORDER BY title ASC, updated_at DESC"),
        ("title", "DESC") => Some("ORDER BY title DESC, updated_at DESC"),
        _ => None,
    }
}

fn map_constraint_error(err: rusqlite::Error) -> ErrorCodeString {
    if let rusqlite::Error::SqliteFailure(info, _) = &err {
        if info.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
            return ErrorCodeString::new("FOLDER_NAME_EXISTS");
        }
    }
    ErrorCodeString::new("DB_QUERY_FAILED")
}

fn map_vault_constraint_error(err: rusqlite::Error) -> ErrorCodeString {
    if let rusqlite::Error::SqliteFailure(info, _) = &err {
        if info.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
            return ErrorCodeString::new("VAULT_NAME_EXISTS");
        }
    }
    ErrorCodeString::new("DB_QUERY_FAILED")
}

fn map_vault_default_constraint_error(err: rusqlite::Error) -> ErrorCodeString {
    if let rusqlite::Error::SqliteFailure(info, _) = &err {
        if info.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
            return ErrorCodeString::new("VAULT_DEFAULT_CONFLICT");
        }
    }
    ErrorCodeString::new("DB_QUERY_FAILED")
}


fn get_folder_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<Folder> {
    let mut stmt = conn
        .prepare("SELECT * FROM folders WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    stmt.query_row(params![id, vault_id], map_folder)
        .map_err(|_| ErrorCodeString::new("FOLDER_NOT_FOUND"))
}

fn get_datacard_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<DataCard> {
    let mut stmt = conn
        .prepare("SELECT * FROM datacards WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    stmt.query_row(params![id, vault_id], map_datacard)
        .map_err(|_| ErrorCodeString::new("DATACARD_NOT_FOUND"))
}

fn get_bank_card_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<BankCardItem> {
    let mut stmt = conn
        .prepare("SELECT * FROM bank_cards WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    match stmt.query_row(params![id, vault_id], map_bank_card) {
        Ok(card) => Ok(card),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"))
        }
        Err(err) => {
            log_sqlite_err(
                "get_bank_card.query_row",
                "SELECT * FROM bank_cards WHERE id = ?1",
                &err,
            );
            Err(ErrorCodeString::new("DB_QUERY_FAILED"))
        }
    }
}

fn insert_password_history(
    conn: &Connection,
    datacard_id: &str,
    password_value: &str,
    created_at: &str,
) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO datacard_password_history (id, datacard_id, password_value, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, datacard_id, password_value, created_at],
    )
    .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    Ok(())
}
