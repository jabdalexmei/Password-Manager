use super::*;

fn list_attachment_ids_by_datacard_conn(
    conn: &Connection,
    datacard_id: &str,
    active_vault_id: &str,
) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT a.id FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.datacard_id = ?1 AND d.vault_id = ?2",
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    let rows = stmt
        .query_map(params![datacard_id, active_vault_id], |row| row.get::<_, String>(0))
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    Ok(rows)
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

pub fn list_deleted_datacard_ids(state: &Arc<AppState>, profile_id: &str) -> Result<Vec<String>> {
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

pub fn list_deleted_datacard_ids_older_than(
    state: &Arc<AppState>,
    profile_id: &str,
    cutoff_rfc3339: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM datacards WHERE vault_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2 ORDER BY deleted_at ASC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let ids = stmt
            .query_map(params![active_vault_id, cutoff_rfc3339], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(ids)
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

pub fn purge_datacard_and_collect_attachment_ids(
    state: &Arc<AppState>,
    profile_id: &str,
    id: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault_tx(state, profile_id, |conn, active_vault_id| {
        let _ = get_datacard_by_id_conn(conn, id, active_vault_id)?;
        let attachment_ids = list_attachment_ids_by_datacard_conn(conn, id, active_vault_id)?;

        let rows = conn
            .execute(
                "DELETE FROM datacards WHERE id = ?1 AND vault_id = ?2",
                params![id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        if rows == 0 {
            return Err(ErrorCodeString::new("DATACARD_NOT_FOUND"));
        }

        Ok(attachment_ids)
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

pub fn list_deleted_bank_card_ids(state: &Arc<AppState>, profile_id: &str) -> Result<Vec<String>> {
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

pub fn list_deleted_bank_card_ids_older_than(
    state: &Arc<AppState>,
    profile_id: &str,
    cutoff_rfc3339: &str,
) -> Result<Vec<String>> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM bank_cards WHERE vault_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2 ORDER BY deleted_at ASC",
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let ids = stmt
            .query_map(params![active_vault_id, cutoff_rfc3339], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(ids)
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
