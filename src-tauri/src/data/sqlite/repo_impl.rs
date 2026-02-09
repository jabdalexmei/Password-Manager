use chrono::Utc;
use rusqlite::params;
use rusqlite::types::Type;
use rusqlite::OptionalExtension;
use rusqlite::Connection;
use uuid::Uuid;

use super::diagnostics::log_sqlite_err;
use crate::app_state::AppState;
use crate::error::{ErrorCodeString, Result};
use crate::types::{
    AttachmentMeta, BankCardItem, BankCardSummary, CreateBankCardInput, CreateDataCardInput,
    CustomField, DataCard, DataCardSummary, Folder, PasswordHistoryRow, SetBankCardArchivedInput,
    SetBankCardFavoriteInput, SetDataCardArchivedInput, SetDataCardFavoriteInput,
    UpdateBankCardInput, UpdateDataCardInput,
    Vault,
};

use std::sync::Arc;

const DEFAULT_VAULT_ID: &str = "default";

fn with_connection<T>(
    state: &Arc<AppState>,
    profile_id: &str,
    f: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    {
        let session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_LOCK_POISONED"))?;

        if let Some(s) = session.as_ref() {
            if s.profile_id == profile_id {
                return f(&s.conn);
            }
        }
    }

    Err(ErrorCodeString::new("VAULT_LOCKED"))
}

fn current_active_vault_id(state: &Arc<AppState>) -> String {
    state
        .active_vault_id
        .lock()
        .ok()
        .and_then(|v| v.clone())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_VAULT_ID.to_string())
}

fn with_connection_in_active_vault<T>(
    state: &Arc<AppState>,
    profile_id: &str,
    f: impl FnOnce(&Connection, &str) -> Result<T>,
) -> Result<T> {
    let active_vault_id = current_active_vault_id(state);
    with_connection(state, profile_id, |conn| f(conn, &active_vault_id))
}

fn deserialize_json<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value)
        .map_err(|err| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(err)))
}

fn serialize_json<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))
}

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

pub fn search_datacard_ids(
    state: &Arc<AppState>,
    profile_id: &str,
    query: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                r#"
SELECT
  d.id,
  d.title,
  d.url,
  d.email,
  d.recovery_email,
  d.username,
  d.mobile_phone,
  d.note,
  d.password_value,
  d.tags_json,
  d.custom_fields_json,
  f.name AS folder_name,
  (
    SELECT GROUP_CONCAT(a.file_name, '\n')
    FROM attachments a
    WHERE a.datacard_id = d.id
      AND a.deleted_at IS NULL
  ) AS attachment_names
FROM datacards d
LEFT JOIN folders f ON f.id = d.folder_id AND f.vault_id = d.vault_id
WHERE d.vault_id = ?1
"#,
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![active_vault_id], |row| {
                let id: String = row.get("id")?;
                let title: String = row.get("title")?;
                let url: Option<String> = row.get("url")?;
                let email: Option<String> = row.get("email")?;
                let recovery_email: Option<String> = row.get("recovery_email")?;
                let username: Option<String> = row.get("username")?;
                let mobile_phone: Option<String> = row.get("mobile_phone")?;
                let note: Option<String> = row.get("note")?;
                let password: Option<String> = row.get("password_value")?;
                let tags_json: String = row.get("tags_json")?;
                let custom_fields_json: String = row.get("custom_fields_json")?;
                let folder_name: Option<String> = row.get("folder_name")?;
                let attachment_names: Option<String> = row.get("attachment_names")?;

                let tags: Vec<String> = deserialize_json(tags_json).unwrap_or_default();
                let custom_fields: Vec<CustomField> =
                    deserialize_json(custom_fields_json).unwrap_or_default();

                let mut blob = String::new();
                blob.push_str(&title);
                blob.push('\n');
                if let Some(v) = url {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = email {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = recovery_email {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = username {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = mobile_phone {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = note {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = password {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = folder_name {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = attachment_names {
                    blob.push_str(&v);
                    blob.push('\n');
                }

                for t in tags {
                    blob.push_str(&t);
                    blob.push('\n');
                }

                for cf in custom_fields {
                    blob.push_str(&cf.key);
                    blob.push(':');
                    blob.push_str(&cf.value);
                    blob.push('\n');
                }

                // ВАЖНО: намеренно НЕ включаем в поиск:
                // - seed_phrase_value
                // - totp_uri
                Ok((id, blob))
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let mut out: Vec<String> = Vec::new();
        for row in rows {
            let (id, blob) = row.map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            if matches_all_tokens(&blob, query) {
                out.push(id);
            }
        }
        Ok(out)
    })
}

pub fn search_bank_card_ids(
    state: &Arc<AppState>,
    profile_id: &str,
    query: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                r#"
SELECT
  b.id,
  b.title,
  b.bank_name,
  b.holder,
  b.number,
  b.note,
  b.tags_json,
  f.name AS folder_name
FROM bank_cards b
LEFT JOIN folders f ON f.id = b.folder_id AND f.vault_id = b.vault_id
WHERE b.vault_id = ?1
"#,
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![active_vault_id], |row| {
                let id: String = row.get("id")?;
                let title: String = row.get("title")?;
                let bank_name: Option<String> = row.get("bank_name")?;
                let holder: Option<String> = row.get("holder")?;
                let number: Option<String> = row.get("number")?;
                let note: Option<String> = row.get("note")?;
                let tags_json: String = row.get("tags_json")?;
                let folder_name: Option<String> = row.get("folder_name")?;

                let tags: Vec<String> = deserialize_json(tags_json).unwrap_or_default();

                let mut blob = String::new();
                blob.push_str(&title);
                blob.push('\n');
                if let Some(v) = bank_name {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = holder {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = number {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = note {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                if let Some(v) = folder_name {
                    blob.push_str(&v);
                    blob.push('\n');
                }
                for t in tags {
                    blob.push_str(&t);
                    blob.push('\n');
                }

                // ВАЖНО: намеренно НЕ включаем в поиск:
                // - cvc (CVV)
                // - expiry_mm_yy (Expiry)
                // - pin (если добавишь в будущем)
                Ok((id, blob))
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let mut out: Vec<String> = Vec::new();
        for row in rows {
            let (id, blob) = row.map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            if matches_all_tokens(&blob, query) {
                out.push(id);
            }
        }
        Ok(out)
    })
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
        tags: deserialize_json(row.get::<_, Option<String>>("tags_json")?.unwrap_or_else(|| "[]".to_string()))?,
        preview_fields: deserialize_json(row.get::<_, Option<String>>("preview_fields_json")?.unwrap_or_else(|| "{}".to_string()))?,
        is_favorite: row.get::<_, i64>("is_favorite")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn map_bank_card_summary(row: &rusqlite::Row) -> rusqlite::Result<BankCardSummary> {
    let tags: Vec<String> =
        deserialize_json(row.get::<_, Option<String>>("tags_json")?.unwrap_or_else(|| "[]".to_string()))?;
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

fn get_vault_by_id_conn(conn: &Connection, id: &str) -> Result<Vault> {
    let sql = "SELECT id, name, is_default, created_at, updated_at FROM vaults WHERE id = ?1";
    conn.query_row(sql, params![id], map_vault)
        .map_err(|_| ErrorCodeString::new("VAULT_NOT_FOUND"))
}

pub fn list_vaults(state: &Arc<AppState>, profile_id: &str) -> Result<Vec<Vault>> {
    with_connection(state, profile_id, |conn| {
        let sql = "SELECT id, name, is_default, created_at, updated_at FROM vaults ORDER BY is_default DESC, name COLLATE NOCASE ASC, id ASC";
        let mut stmt = conn.prepare(sql).map_err(|e| {
            log_sqlite_err("list_vaults.prepare", sql, &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

        let rows = stmt
            .query_map([], map_vault)
            .map_err(|e| {
                log_sqlite_err("list_vaults.query_map", sql, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| {
                log_sqlite_err("list_vaults.collect", sql, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;

        Ok(rows)
    })
}

pub fn get_vault(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<Vault> {
    with_connection(state, profile_id, |conn| get_vault_by_id_conn(conn, id))
}

pub fn create_vault(state: &Arc<AppState>, profile_id: &str, name: &str) -> Result<Vault> {
    with_connection(state, profile_id, |conn| {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO vaults (id, name, is_default, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?4)",
            params![id, name, now, now],
        )
        .map_err(map_vault_constraint_error)?;

        get_vault_by_id_conn(conn, &id)
    })
}

pub fn rename_vault(state: &Arc<AppState>, profile_id: &str, id: &str, name: &str) -> Result<bool> {
    with_connection(state, profile_id, |conn| {
        let vault = get_vault_by_id_conn(conn, id)?;
        if vault.is_default {
            return Err(ErrorCodeString::new("VAULT_DEFAULT_IMMUTABLE"));
        }

        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(ErrorCodeString::new("VAULT_NAME_REQUIRED"));
        }

        let rows = conn
            .execute(
                "UPDATE vaults SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, Utc::now().to_rfc3339(), id],
            )
            .map_err(map_vault_constraint_error)?;
        if rows == 0 {
            return Err(ErrorCodeString::new("VAULT_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn delete_vault(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection(state, profile_id, |conn| {
        let vault = get_vault_by_id_conn(conn, id)?;
        if vault.is_default {
            return Err(ErrorCodeString::new("VAULT_DEFAULT_IMMUTABLE"));
        }

        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let result: Result<()> = (|| {
            conn.execute(
                "DELETE FROM attachments WHERE datacard_id IN (SELECT id FROM datacards WHERE vault_id = ?1)",
                params![id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            conn.execute(
                "DELETE FROM datacard_password_history WHERE datacard_id IN (SELECT id FROM datacards WHERE vault_id = ?1)",
                params![id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            conn.execute("DELETE FROM datacards WHERE vault_id = ?1", params![id])
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            conn.execute("DELETE FROM bank_cards WHERE vault_id = ?1", params![id])
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            conn.execute("DELETE FROM folders WHERE vault_id = ?1", params![id])
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            let rows = conn
                .execute("DELETE FROM vaults WHERE id = ?1", params![id])
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            if rows == 0 {
                return Err(ErrorCodeString::new("VAULT_NOT_FOUND"));
            }
            Ok(())
        })();

        if let Err(err) = result {
            let _ = conn.execute("ROLLBACK", []);
            return Err(err);
        }

        conn.execute("COMMIT", [])
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(true)
    })
}

pub fn list_folders(state: &Arc<AppState>, profile_id: &str) -> Result<Vec<Folder>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let sql =
            "SELECT * FROM folders WHERE vault_id = ?1 AND deleted_at IS NULL ORDER BY name ASC";
        let mut stmt = conn.prepare(sql).map_err(|e| {
            log_sqlite_err("list_folders.prepare", sql, &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

        let folders = stmt
            .query_map(params![active_vault_id], map_folder)
            .map_err(|e| {
                log_sqlite_err("list_folders.query_map", sql, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| {
                log_sqlite_err("list_folders.collect", sql, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;

        Ok(folders)
    })
}

fn get_folder_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<Folder> {
    let mut stmt = conn
        .prepare("SELECT * FROM folders WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    stmt.query_row(params![id, vault_id], map_folder)
        .map_err(|_| ErrorCodeString::new("FOLDER_NOT_FOUND"))
}

pub fn get_folder(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<Folder> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        get_folder_by_id_conn(conn, id, active_vault_id)
    })
}

pub fn create_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    name: &str,
    parent_id: &Option<String>,
) -> Result<Folder> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        if let Some(parent) = parent_id {
            let _ = get_folder_by_id_conn(conn, parent, active_vault_id)?;
        }
        conn.execute(
            "INSERT INTO folders (id, vault_id, name, parent_id, is_system, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, NULL)",
            params![id, active_vault_id, name, parent_id, now, now],
        )
        .map_err(map_constraint_error)?;

        get_folder_by_id_conn(conn, &id, active_vault_id)
    })
}

pub fn rename_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    name: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![name, Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(map_constraint_error)?;
        if rows == 0 {
            return Err(ErrorCodeString::new("FOLDER_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn move_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    parent_id: &Option<String>,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        if let Some(parent) = parent_id {
            if parent == id {
                return Err(ErrorCodeString::new("FOLDER_NOT_FOUND"));
            }
            let _ = get_folder_by_id_conn(conn, parent, active_vault_id)?;
        }
        let rows = conn
            .execute(
                "UPDATE folders SET parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![parent_id, Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(map_constraint_error)?;
        if rows == 0 {
            return Err(ErrorCodeString::new("FOLDER_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn purge_folder(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "DELETE FROM folders WHERE id = ?1 AND vault_id = ?2",
                params![id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("FOLDER_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn move_datacards_to_root(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE datacards SET folder_id = NULL, updated_at = ?1 WHERE folder_id = ?2 AND vault_id = ?3",
            params![now, folder_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}

pub fn move_bank_cards_to_root(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE bank_cards SET folder_id = NULL, updated_at = ?1 WHERE folder_id = ?2 AND vault_id = ?3",
            params![now, folder_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}

pub fn list_datacard_ids_in_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
    include_deleted: bool,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let clause = if include_deleted {
            String::new()
        } else {
            " AND deleted_at IS NULL".to_string()
        };
        let mut stmt = conn
            .prepare(&format!(
                "SELECT id FROM datacards WHERE folder_id = ?1 AND vault_id = ?2{clause}",
            ))
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![folder_id, active_vault_id], |row| row.get("id"))
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(rows)
    })
}

pub fn list_datacards(
    state: &Arc<AppState>,
    profile_id: &str,
    include_deleted: bool,
    sort_field: &str,
    sort_dir: &str,
) -> Result<Vec<DataCard>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let clause = order_clause(sort_field, sort_dir)
            .ok_or_else(|| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        let base_query = if include_deleted {
            format!("SELECT * FROM datacards WHERE vault_id = ?1 {clause}")
        } else {
            format!("SELECT * FROM datacards WHERE vault_id = ?1 AND deleted_at IS NULL {clause}")
        };
        let mut stmt = conn
            .prepare(&base_query)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        let cards = stmt
            .query_map(params![active_vault_id], map_datacard)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(cards)
    })
}

pub fn list_datacards_summary(
    state: &Arc<AppState>,
    profile_id: &str,
    sort_field: &str,
    sort_dir: &str,
) -> Result<Vec<DataCardSummary>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let clause = order_clause(sort_field, sort_dir)
            .ok_or_else(|| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        let query = format!(
            r#"
            SELECT
                d.id,
                d.folder_id,
                d.title,
                d.url,
                d.email,
                d.recovery_email,
                d.username,
                d.mobile_phone,
                d.note,
                d.totp_uri,
                CASE WHEN d.seed_phrase_value IS NOT NULL AND TRIM(d.seed_phrase_value) <> '' THEN 1 ELSE 0 END AS has_seed_phrase,
                CASE WHEN d.mobile_phone IS NOT NULL AND TRIM(d.mobile_phone) <> '' THEN 1 ELSE 0 END AS has_phone,
                CASE WHEN d.note IS NOT NULL AND TRIM(d.note) <> '' THEN 1 ELSE 0 END AS has_note,
                EXISTS(SELECT 1 FROM attachments a WHERE a.datacard_id = d.id AND a.deleted_at IS NULL) AS has_attachments,
                d.tags_json,
                d.custom_fields_json,
                d.preview_fields_json,
                d.is_favorite,
                d.created_at,
                d.updated_at,
                d.archived_at,
                d.deleted_at
            FROM datacards d
            WHERE d.vault_id = ?1 AND d.deleted_at IS NULL {clause}
            "#
        );
        let mut stmt = conn.prepare(&query).map_err(|e| {
            log_sqlite_err("list_datacards_summary.prepare", &query, &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

        let cards = stmt
            .query_map(params![active_vault_id], map_datacard_summary)
            .map_err(|e| {
                log_sqlite_err("list_datacards_summary.query_map", &query, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| {
                log_sqlite_err("list_datacards_summary.collect", &query, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;

        Ok(cards)
    })
}

pub fn list_deleted_datacards(state: &Arc<AppState>, profile_id: &str) -> Result<Vec<DataCard>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare("SELECT * FROM datacards WHERE vault_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC")
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let cards = stmt
            .query_map(params![active_vault_id], map_datacard)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(cards)
    })
}

pub fn set_datacard_archived(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &SetDataCardArchivedInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let archived_at: Option<String> = if input.is_archived {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };

        let rows = conn
            .execute(
                "UPDATE datacards SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                params![archived_at, Utc::now().to_rfc3339(), input.id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }

        Ok(true)
    })
}

pub fn list_deleted_datacards_summary(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<Vec<DataCardSummary>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                    d.id,
                    d.folder_id,
                    d.title,
                    d.url,
                    d.email,
                    d.recovery_email,
                    d.username,
                    d.mobile_phone,
                    d.note,
                    d.totp_uri,
                    CASE WHEN d.seed_phrase_value IS NOT NULL AND TRIM(d.seed_phrase_value) <> '' THEN 1 ELSE 0 END AS has_seed_phrase,
                    CASE WHEN d.mobile_phone IS NOT NULL AND TRIM(d.mobile_phone) <> '' THEN 1 ELSE 0 END AS has_phone,
                    CASE WHEN d.note IS NOT NULL AND TRIM(d.note) <> '' THEN 1 ELSE 0 END AS has_note,
                    EXISTS(SELECT 1 FROM attachments a WHERE a.datacard_id = d.id AND a.deleted_at IS NULL) AS has_attachments,
                    d.tags_json,
                    d.custom_fields_json,
                    d.preview_fields_json,
                    d.is_favorite,
                    d.created_at,
                    d.updated_at,
                    d.archived_at,
                    d.deleted_at
                FROM datacards d
                WHERE d.vault_id = ?1 AND d.deleted_at IS NOT NULL
                ORDER BY d.deleted_at DESC
                "#,
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let cards = stmt
            .query_map(params![active_vault_id], map_datacard_summary)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(cards)
    })
}

pub fn list_deleted_datacard_ids(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM datacards WHERE vault_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let ids = stmt
            .query_map(params![active_vault_id], |row| row.get::<_, String>(0))
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(ids)
    })
}

pub fn get_ui_preference_value_json(
    state: &Arc<AppState>,
    profile_id: &str,
    key: &str,
) -> Result<Option<String>> {
    with_connection(state, profile_id, |conn| {
        let sql = "SELECT value_json FROM ui_preferences WHERE key=?1";
        let value: Option<String> = conn
            .query_row(sql, [key], |row| row.get(0))
            .optional()
            .map_err(|err| {
                log_sqlite_err("ui_preferences.get", sql, &err);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;
        Ok(value)
    })
}

pub fn set_ui_preference_value_json(
    state: &Arc<AppState>,
    profile_id: &str,
    key: &str,
    value_json: &str,
    now_utc: &str,
) -> Result<bool> {
    with_connection(state, profile_id, |conn| {
        let sql = r#"
INSERT INTO ui_preferences(key, value_json, updated_at)
VALUES (?1, ?2, ?3)
ON CONFLICT(key) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at
"#;
        let changed = conn
            .execute(sql, params![key, value_json, now_utc])
            .map_err(|err| {
                log_sqlite_err("ui_preferences.set", sql, &err);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;
        Ok(changed > 0)
    })
}

fn get_datacard_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<DataCard> {
    let mut stmt = conn
        .prepare("SELECT * FROM datacards WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    stmt.query_row(params![id, vault_id], map_datacard)
        .map_err(|_| ErrorCodeString::new("DATACARD_NOT_FOUND"))
}

pub fn get_datacard(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<DataCard> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        get_datacard_by_id_conn(conn, id, active_vault_id)
    })
}

pub fn create_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &CreateDataCardInput,
) -> Result<DataCard> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let tags_json = serialize_json(&input.tags)?;
        let custom_fields_json = serialize_json(&input.custom_fields)?;
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        if let Some(folder_id) = input.folder_id.as_ref() {
            let _ = get_folder_by_id_conn(conn, folder_id, active_vault_id)?;
        }
        conn.execute(
            "INSERT INTO datacards (id, vault_id, folder_id, title, url, email, recovery_email, username, mobile_phone, note, is_favorite, tags_json, password_value, totp_uri, seed_phrase_value, seed_phrase_word_count, custom_fields_json, preview_fields_json, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, NULL)",
            params![
                id,
                active_vault_id,
                input.folder_id,
                input.title,
                input.url,
                input.email,
                input.recovery_email,
                input.username,
                input.mobile_phone,
                input.note,
                tags_json,
                input.password,
                input.totp_uri,
                input.seed_phrase,
                input.seed_phrase_word_count,
                custom_fields_json,
                "[]",
                now,
                now
            ],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        get_datacard_by_id_conn(conn, &id, active_vault_id)
    })
}

pub fn update_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &UpdateDataCardInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let tags_json = serialize_json(&input.tags)?;
        let custom_fields_json = serialize_json(&input.custom_fields)?;
        let existing_password_row: Option<Option<String>> = conn
            .query_row(
                "SELECT password_value FROM datacards WHERE id = ?1 AND vault_id = ?2",
                params![input.id, active_vault_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if let Some(folder_id) = input.folder_id.as_ref() {
            let _ = get_folder_by_id_conn(conn, folder_id, active_vault_id)?;
        }

        let existing_password: Option<String> = match existing_password_row {
            None => return Err(ErrorCodeString::new("DATACARD_NOT_FOUND")),
            Some(value) => value,
        };

        let now = Utc::now().to_rfc3339();
        let old_trimmed = existing_password
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();
        let new_trimmed = input.password.as_deref().unwrap_or("").trim().to_string();

        if !old_trimmed.is_empty() && old_trimmed != new_trimmed {
            insert_password_history(
                conn,
                &input.id,
                existing_password.as_deref().unwrap_or(""),
                &now,
            )?;
        }
        let rows = conn
            .execute(
                "UPDATE datacards SET title = ?1, url = ?2, email = ?3, recovery_email = ?4, username = ?5, mobile_phone = ?6, note = ?7, tags_json = ?8, password_value = ?9, totp_uri = ?10, seed_phrase_value = ?11, seed_phrase_word_count = ?12, custom_fields_json = ?13, folder_id = ?14, updated_at = ?15 WHERE id = ?16 AND vault_id = ?17",
                params![
                    input.title,
                    input.url,
                    input.email,
                    input.recovery_email,
                    input.username,
                    input.mobile_phone,
                    input.note,
                    tags_json,
                    input.password,
                    input.totp_uri,
                    input.seed_phrase,
                    input.seed_phrase_word_count,
                    custom_fields_json,
                    input.folder_id,
                    now,
                    input.id,
                    active_vault_id
                ],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn set_datacard_favorite(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &SetDataCardFavoriteInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE datacards SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![
                    if input.is_favorite { 1 } else { 0 },
                    Utc::now().to_rfc3339(),
                    input.id,
                    active_vault_id
                ],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }

        Ok(true)
    })
}

pub fn move_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    folder_id: &Option<String>,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        if let Some(folder) = folder_id.as_ref() {
            let _ = get_folder_by_id_conn(conn, folder, active_vault_id)?;
        }
        let rows = conn
            .execute(
                "UPDATE datacards SET folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![folder_id, Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn soft_delete_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    now: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE datacards SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![now, now, id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn restore_datacard(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE datacards SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3",
                params![Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn purge_datacard(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "DELETE FROM datacards WHERE id = ?1 AND vault_id = ?2",
                params![id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn soft_delete_datacards_in_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE datacards SET deleted_at = ?1, updated_at = ?2 WHERE folder_id = ?3 AND vault_id = ?4",
            params![now.clone(), now, folder_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}
pub fn purge_datacards_in_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        conn.execute(
            "DELETE FROM datacards WHERE folder_id = ?1 AND vault_id = ?2",
            params![folder_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}

pub fn list_bank_cards_summary(
    state: &Arc<AppState>,
    profile_id: &str,
    sort_field: &str,
    sort_dir: &str,
) -> Result<Vec<BankCardSummary>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let clause = order_clause(sort_field, sort_dir).unwrap_or("ORDER BY updated_at DESC");
        let query = format!(
            "SELECT id, folder_id, title, bank_name, holder, number, note, tags_json, preview_fields_json, is_favorite, created_at, updated_at, archived_at, deleted_at FROM bank_cards WHERE vault_id = ?1 AND deleted_at IS NULL {clause}"
        );
        let mut stmt = conn.prepare(&query).map_err(|e| {
            log_sqlite_err("list_bank_cards_summary.prepare", &query, &e);
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

        let cards = stmt
            .query_map(params![active_vault_id], map_bank_card_summary)
            .map_err(|e| {
                log_sqlite_err("list_bank_cards_summary.query_map", &query, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| {
                log_sqlite_err("list_bank_cards_summary.collect", &query, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;

        Ok(cards)
    })
}

pub fn list_deleted_bank_cards_summary(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<Vec<BankCardSummary>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT id, folder_id, title, bank_name, holder, number, note, tags_json, preview_fields_json, is_favorite, created_at, updated_at, archived_at, deleted_at FROM bank_cards WHERE vault_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let cards = stmt
            .query_map(params![active_vault_id], map_bank_card_summary)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(cards)
    })
}

pub fn list_deleted_bank_card_ids(
    state: &Arc<AppState>,
    profile_id: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM bank_cards WHERE vault_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let ids = stmt
            .query_map(params![active_vault_id], |row| row.get::<_, String>(0))
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(ids)
    })
}

pub fn get_bank_card(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<BankCardItem> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        get_bank_card_by_id_conn(conn, id, active_vault_id)
    })
}

fn get_bank_card_by_id_conn(conn: &Connection, id: &str, vault_id: &str) -> Result<BankCardItem> {
    let mut stmt = conn
        .prepare("SELECT * FROM bank_cards WHERE id = ?1 AND vault_id = ?2")
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    match stmt.query_row(params![id, vault_id], map_bank_card) {
        Ok(card) => Ok(card),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND")),
        Err(err) => {
            log_sqlite_err("get_bank_card.query_row", "SELECT * FROM bank_cards WHERE id = ?1", &err);
            Err(ErrorCodeString::new("DB_QUERY_FAILED"))
        }
    }
}

pub fn create_bank_card(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &CreateBankCardInput,
) -> Result<BankCardItem> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let tags_json = serialize_json(&input.tags)?;
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        if let Some(folder_id) = input.folder_id.as_ref() {
            let _ = get_folder_by_id_conn(conn, folder_id, active_vault_id)?;
        }
        conn.execute(
            "INSERT INTO bank_cards (id, vault_id, folder_id, title, bank_name, holder, number, expiry_mm_yy, cvc, note, tags_json, is_favorite, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13, NULL)",
            params![
                id,
                active_vault_id,
                input.folder_id,
                input.title,
                input.bank_name,
                input.holder,
                input.number,
                input.expiry_mm_yy,
                input.cvc,
                input.note,
                tags_json,
                now,
                now
            ],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        get_bank_card_by_id_conn(conn, &id, active_vault_id)
    })
}

pub fn update_bank_card(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &UpdateBankCardInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let tags_json = serialize_json(&input.tags)?;
        if let Some(folder_id) = input.folder_id.as_ref() {
            let _ = get_folder_by_id_conn(conn, folder_id, active_vault_id)?;
        }
        let rows = conn
            .execute(
                "UPDATE bank_cards SET folder_id = ?1, title = ?2, bank_name = ?3, holder = ?4, number = ?5, expiry_mm_yy = ?6, cvc = ?7, note = ?8, tags_json = ?9, updated_at = ?10 WHERE id = ?11 AND vault_id = ?12",
                params![
                    input.folder_id,
                    input.title,
                    input.bank_name,
                    input.holder,
                    input.number,
                    input.expiry_mm_yy,
                    input.cvc,
                    input.note,
                    tags_json,
                    Utc::now().to_rfc3339(),
                    input.id,
                    active_vault_id
                ],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn set_bank_card_favorite(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &SetBankCardFavoriteInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE bank_cards SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![
                    if input.is_favorite { 1 } else { 0 },
                    Utc::now().to_rfc3339(),
                    input.id,
                    active_vault_id
                ],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn set_bankcard_archived(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &SetBankCardArchivedInput,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let archived_at: Option<String> = if input.is_archived {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };

        let rows = conn
            .execute(
                "UPDATE bank_cards SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                params![archived_at, Utc::now().to_rfc3339(), input.id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn soft_delete_bank_card(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    now: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE bank_cards SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![now, now, id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn restore_bank_card(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE bank_cards SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3",
                params![Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn purge_bank_card(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "DELETE FROM bank_cards WHERE id = ?1 AND vault_id = ?2",
                params![id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }
        Ok(true)
    })
}

pub fn soft_delete_bank_cards_in_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE bank_cards SET deleted_at = ?1, updated_at = ?2 WHERE folder_id = ?3 AND vault_id = ?4",
            params![now.clone(), now, folder_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}

pub fn purge_bank_cards_in_folder(
    state: &Arc<AppState>,
    profile_id: &str,
    folder_id: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        conn.execute(
            "DELETE FROM bank_cards WHERE folder_id = ?1 AND vault_id = ?2",
            params![folder_id, active_vault_id],
        )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(true)
    })
}

pub fn insert_attachment(
    state: &Arc<AppState>,
    profile_id: &str,
    meta: &AttachmentMeta,
) -> Result<()> {
    with_connection(state, profile_id, |conn| {
        conn.execute(
            "INSERT INTO attachments (id, datacard_id, file_name, mime_type, byte_size, created_at, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                meta.id,
                meta.datacard_id,
                meta.file_name,
                meta.mime_type,
                meta.byte_size,
                meta.created_at,
                meta.updated_at,
                meta.deleted_at
            ],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(())
    })
}

pub fn list_attachments_by_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
) -> Result<Vec<AttachmentMeta>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT a.* FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.datacard_id = ?1 AND d.vault_id = ?2 AND a.deleted_at IS NULL ORDER BY a.created_at DESC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![datacard_id, active_vault_id], map_attachment)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(rows)
    })
}

pub fn list_all_attachments_by_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
) -> Result<Vec<AttachmentMeta>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT a.* FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.datacard_id = ?1 AND d.vault_id = ?2",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![datacard_id, active_vault_id], map_attachment)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(rows)
    })
}

pub fn soft_delete_attachments_by_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
    deleted_at: &str,
) -> Result<()> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        conn.execute(
            "UPDATE attachments SET deleted_at = ?1, updated_at = ?2 WHERE datacard_id = ?3 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = ?3 AND d.vault_id = ?4)",
            params![deleted_at, deleted_at, datacard_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(())
    })
}

pub fn restore_attachments_by_datacard(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
) -> Result<()> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        conn.execute(
            "UPDATE attachments SET deleted_at = NULL, updated_at = ?1 WHERE datacard_id = ?2 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = ?2 AND d.vault_id = ?3)",
            params![Utc::now().to_rfc3339(), datacard_id, active_vault_id],
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        Ok(())
    })
}

pub fn get_attachment(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
) -> Result<Option<AttachmentMeta>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT a.* FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.id = ?1 AND d.vault_id = ?2",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let meta = stmt
            .query_row(params![attachment_id, active_vault_id], map_attachment)
            .optional()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(meta)
    })
}

pub fn soft_delete_attachment(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
    deleted_at: &str,
) -> Result<()> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let updated = conn
            .execute(
                "UPDATE attachments SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = attachments.datacard_id AND d.vault_id = ?4)",
                params![deleted_at, deleted_at, attachment_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if updated == 0 {
            return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
        }

        Ok(())
    })
}

pub fn set_datacard_preview_fields_for_card(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    preview_fields_json: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE datacards SET preview_fields_json = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![preview_fields_json, Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }

        Ok(true)
    })
}

pub fn set_bankcard_preview_fields_for_card(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    preview_fields_json: &str,
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE bank_cards SET preview_fields_json = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![preview_fields_json, Utc::now().to_rfc3339(), id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("BANK_CARD_NOT_FOUND"));
        }

        Ok(true)
    })
}

pub fn purge_attachment(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
) -> Result<()> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let updated = conn
            .execute(
                "DELETE FROM attachments WHERE id = ?1 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = attachments.datacard_id AND d.vault_id = ?2)",
                params![attachment_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if updated == 0 {
            return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
        }

        Ok(())
    })
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

pub fn list_password_history(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
) -> Result<Vec<PasswordHistoryRow>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT p.* FROM datacard_password_history p INNER JOIN datacards d ON d.id = p.datacard_id WHERE p.datacard_id = ?1 AND d.vault_id = ?2 ORDER BY p.created_at DESC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let rows = stmt
            .query_map(params![datacard_id, active_vault_id], map_password_history_row)
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(rows)
    })
}

pub fn clear_password_history(
    state: &Arc<AppState>,
    profile_id: &str,
    datacard_id: &str,
) -> Result<usize> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let deleted = conn
            .execute(
                "DELETE FROM datacard_password_history WHERE datacard_id = ?1 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = ?1 AND d.vault_id = ?2)",
                params![datacard_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(deleted as usize)
    })
}
