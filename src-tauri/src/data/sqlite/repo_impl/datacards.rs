use super::*;

pub fn search_datacard_ids(
    state: &Arc<AppState>,
    profile_id: &str,
    query: &str,
) -> Result<Vec<String>> {
    let terms = parse_datacard_search_terms(query);

    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        #[derive(Debug)]
        struct DataCardSearchRow {
            id: String,
            blob: String,
            title: String,
            url: String,
            email: String,
            recovery_email: String,
            username: String,
            mobile_phone: String,
            note: String,
            password: String,
            tags_blob: String,
        }

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

                let url_s = url.clone().unwrap_or_default();
                let email_s = email.clone().unwrap_or_default();
                let recovery_email_s = recovery_email.clone().unwrap_or_default();
                let username_s = username.clone().unwrap_or_default();
                let mobile_phone_s = mobile_phone.clone().unwrap_or_default();
                let note_s = note.clone().unwrap_or_default();
                let password_s = password.clone().unwrap_or_default();
                let tags_blob = tags.join("\n");

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

                for t in &tags {
                    blob.push_str(t);
                    blob.push('\n');
                }

                for cf in custom_fields {
                    blob.push_str(&cf.key);
                    blob.push(':');
                    blob.push_str(&cf.value);
                    blob.push('\n');
                }

                // IMPORTANT: intentionally excluded from search:
                // - seed_phrase_value
                // - totp_uri
                Ok(DataCardSearchRow {
                    id,
                    blob,
                    title,
                    url: url_s,
                    email: email_s,
                    recovery_email: recovery_email_s,
                    username: username_s,
                    mobile_phone: mobile_phone_s,
                    note: note_s,
                    password: password_s,
                    tags_blob,
                })
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let mut out: Vec<String> = Vec::new();
        for row in rows {
            let row = row.map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

            if terms.is_empty() {
                out.push(row.id);
                continue;
            }

            let mut matched = true;
            for term in &terms {
                match term {
                    DataCardSearchTerm::FreeText(q) => {
                        if !matches_all_tokens(&row.blob, q) {
                            matched = false;
                            break;
                        }
                    }
                    DataCardSearchTerm::Field { field, value } => {
                        let haystack: &str = match field {
                            DataCardSearchField::Title => &row.title,
                            DataCardSearchField::Url => &row.url,
                            DataCardSearchField::Email => &row.email,
                            DataCardSearchField::RecoveryEmail => &row.recovery_email,
                            DataCardSearchField::Username => &row.username,
                            DataCardSearchField::MobilePhone => &row.mobile_phone,
                            DataCardSearchField::Password => &row.password,
                            DataCardSearchField::Note => &row.note,
                            DataCardSearchField::Tag => &row.tags_blob,
                        };
                        if !matches_all_tokens(haystack, value) {
                            matched = false;
                            break;
                        }
                    }
                }
            }

            if matched {
                out.push(row.id);
            }
        }

        Ok(out)
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
        let (clause, fallback) = safe_order_clause(sort_field, sort_dir);
        if fallback {
            log::warn!(
                "[SORT] profile_id={} entity=datacards action=list_datacards include_deleted={} fallback=true sort_field={} sort_dir={}",
                profile_id,
                include_deleted,
                sort_field,
                sort_dir
            );
        }
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
        let mut cards = cards;
        hydrate_datacards_attachments_conn(conn, &mut cards, active_vault_id)?;
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
        let (clause, fallback) = safe_order_clause(sort_field, sort_dir);
        if fallback {
            log::warn!(
                "[SORT] profile_id={} entity=datacards action=list_datacards_summary fallback=true sort_field={} sort_dir={}",
                profile_id,
                sort_field,
                sort_dir
            );
        }
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

pub fn repair_datacard_custom_fields_and_preview_fields(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
    custom_fields: &[CustomField],
    preview_fields: &[String],
) -> Result<bool> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let custom_fields_json = serialize_json(custom_fields)?;
        let preview_fields_json = serialize_json(preview_fields)?;

        let rows = conn
            .execute(
                "UPDATE datacards SET custom_fields_json = ?1, preview_fields_json = ?2 WHERE id = ?3 AND vault_id = ?4",
                params![custom_fields_json, preview_fields_json, id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }

        Ok(true)
    })
}
