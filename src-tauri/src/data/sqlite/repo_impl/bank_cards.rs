use super::*;

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

                // Ð’ÐÐ–ÐÐž: Ð½Ð°Ð¼ÐµÑ€ÐµÐ½Ð½Ð¾ ÐÐ• Ð²ÐºÐ»ÑŽÑ‡Ð°ÐµÐ¼ Ð² Ð¿Ð¾Ð¸ÑÐº:
                // - cvc (CVV)
                // - expiry_mm_yy (Expiry)
                // - pin (ÐµÑÐ»Ð¸ Ð´Ð¾Ð±Ð°Ð²Ð¸ÑˆÑŒ Ð² Ð±ÑƒÐ´ÑƒÑ‰ÐµÐ¼)
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

pub fn list_bank_cards_summary(
    state: &Arc<AppState>,
    profile_id: &str,
    sort_field: &str,
    sort_dir: &str,
) -> Result<Vec<BankCardSummary>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let (clause, fallback) = safe_order_clause(sort_field, sort_dir);
        if fallback {
            log::warn!(
                "[SORT] profile_id={} entity=bank_cards action=list_bank_cards_summary fallback=true sort_field={} sort_dir={}",
                profile_id,
                sort_field,
                sort_dir
            );
        }
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

pub fn get_bank_card(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<BankCardItem> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        get_bank_card_by_id_conn(conn, id, active_vault_id)
    })
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
