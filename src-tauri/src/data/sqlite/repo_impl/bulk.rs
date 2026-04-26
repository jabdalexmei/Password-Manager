use super::*;

pub struct BulkApplyRepoOutcome {
    pub processed_count: usize,
    pub purged_attachment_ids: Vec<String>,
}

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

    let attachment_ids = stmt.query_map(params![datacard_id, active_vault_id], |row| {
        row.get::<_, String>(0)
    })
    .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    Ok(attachment_ids)
}

fn get_deleted_at_conn(
    conn: &Connection,
    table: &str,
    id: &str,
    active_vault_id: &str,
    not_found_code: &str,
) -> Result<Option<String>> {
    let query = format!("SELECT deleted_at FROM {table} WHERE id = ?1 AND vault_id = ?2");
    conn.query_row(&query, params![id, active_vault_id], |row| {
        row.get::<_, Option<String>>(0)
    })
    .optional()
    .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?
    .ok_or_else(|| ErrorCodeString::new(not_found_code))
}

fn ensure_active_item(
    conn: &Connection,
    item: &BulkVaultItemRef,
    active_vault_id: &str,
) -> Result<()> {
    let (table, not_found) = match item.item_type {
        BulkVaultItemType::DataCard => ("datacards", "DATACARD_NOT_FOUND"),
        BulkVaultItemType::BankCard => ("bank_cards", "BANK_CARD_NOT_FOUND"),
    };
    if get_deleted_at_conn(conn, table, &item.id, active_vault_id, not_found)?.is_some() {
        return Err(ErrorCodeString::new("BULK_ITEM_DELETED"));
    }
    Ok(())
}

fn ensure_deleted_item(
    conn: &Connection,
    item: &BulkVaultItemRef,
    active_vault_id: &str,
) -> Result<()> {
    let (table, not_found) = match item.item_type {
        BulkVaultItemType::DataCard => ("datacards", "DATACARD_NOT_FOUND"),
        BulkVaultItemType::BankCard => ("bank_cards", "BANK_CARD_NOT_FOUND"),
    };
    if get_deleted_at_conn(conn, table, &item.id, active_vault_id, not_found)?.is_none() {
        return Err(ErrorCodeString::new("BULK_ITEM_NOT_DELETED"));
    }
    Ok(())
}

fn execute_one(conn: &Connection, sql: &str, params: impl rusqlite::Params, code: &str) -> Result<()> {
    let rows = conn
        .execute(sql, params)
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
    if rows == 0 {
        return Err(ErrorCodeString::new(code));
    }
    Ok(())
}

fn purge_datacard_conn(
    conn: &Connection,
    id: &str,
    active_vault_id: &str,
) -> Result<Vec<String>> {
    let _ = get_datacard_by_id_conn(conn, id, active_vault_id)?;
    let attachment_ids = list_attachment_ids_by_datacard_conn(conn, id, active_vault_id)?;
    execute_one(
        conn,
        "DELETE FROM datacards WHERE id = ?1 AND vault_id = ?2",
        params![id, active_vault_id],
        "DATACARD_NOT_FOUND",
    )?;
    Ok(attachment_ids)
}

fn purge_bank_card_conn(conn: &Connection, id: &str, active_vault_id: &str) -> Result<()> {
    execute_one(
        conn,
        "DELETE FROM bank_cards WHERE id = ?1 AND vault_id = ?2",
        params![id, active_vault_id],
        "BANK_CARD_NOT_FOUND",
    )
}

pub fn bulk_apply_vault_items(
    state: &Arc<AppState>,
    profile_id: &str,
    input: &BulkVaultItemsInput,
    soft_delete_enabled: bool,
) -> Result<BulkApplyRepoOutcome> {
    with_connection_in_active_vault_tx(state, profile_id, |conn, active_vault_id| {
        if input.items.is_empty() {
            return Ok(BulkApplyRepoOutcome {
                processed_count: 0,
                purged_attachment_ids: Vec::new(),
            });
        }

        if let BulkVaultAction::MoveToFolder { folder_id } = &input.action {
            if let Some(folder_id) = folder_id.as_ref() {
                let _ = get_folder_by_id_conn(conn, folder_id, active_vault_id)?;
            }
        }

        let now = Utc::now().to_rfc3339();
        let mut purged_attachment_ids = Vec::new();

        for item in &input.items {
            if item.id.trim().is_empty() {
                return Err(ErrorCodeString::new("VALIDATION_ERROR"));
            }

            match &input.action {
                BulkVaultAction::MoveToFolder { folder_id } => {
                    ensure_active_item(conn, item, active_vault_id)?;
                    match item.item_type {
                        BulkVaultItemType::DataCard => execute_one(
                            conn,
                            "UPDATE datacards SET folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![folder_id, now, item.id, active_vault_id],
                            "DATACARD_NOT_FOUND",
                        )?,
                        BulkVaultItemType::BankCard => execute_one(
                            conn,
                            "UPDATE bank_cards SET folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![folder_id, now, item.id, active_vault_id],
                            "BANK_CARD_NOT_FOUND",
                        )?,
                    }
                }
                BulkVaultAction::Delete => {
                    ensure_active_item(conn, item, active_vault_id)?;
                    if soft_delete_enabled {
                        match item.item_type {
                            BulkVaultItemType::DataCard => {
                                execute_one(
                                    conn,
                                    "UPDATE datacards SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                                    params![now, now, item.id, active_vault_id],
                                    "DATACARD_NOT_FOUND",
                                )?;
                                conn.execute(
                                    "UPDATE attachments SET deleted_at = ?1, updated_at = ?2 WHERE datacard_id = ?3 AND deleted_at IS NULL",
                                    params![now, now, item.id],
                                )
                                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
                            }
                            BulkVaultItemType::BankCard => execute_one(
                                conn,
                                "UPDATE bank_cards SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                                params![now, now, item.id, active_vault_id],
                                "BANK_CARD_NOT_FOUND",
                            )?,
                        }
                    } else {
                        match item.item_type {
                            BulkVaultItemType::DataCard => {
                                purged_attachment_ids.extend(purge_datacard_conn(
                                    conn,
                                    &item.id,
                                    active_vault_id,
                                )?);
                            }
                            BulkVaultItemType::BankCard => {
                                purge_bank_card_conn(conn, &item.id, active_vault_id)?;
                            }
                        }
                    }
                }
                BulkVaultAction::SetArchived { is_archived } => {
                    ensure_active_item(conn, item, active_vault_id)?;
                    let archived_at: Option<String> = if *is_archived {
                        Some(now.clone())
                    } else {
                        None
                    };
                    match item.item_type {
                        BulkVaultItemType::DataCard => execute_one(
                            conn,
                            "UPDATE datacards SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![archived_at, now, item.id, active_vault_id],
                            "DATACARD_NOT_FOUND",
                        )?,
                        BulkVaultItemType::BankCard => execute_one(
                            conn,
                            "UPDATE bank_cards SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![archived_at, now, item.id, active_vault_id],
                            "BANK_CARD_NOT_FOUND",
                        )?,
                    }
                }
                BulkVaultAction::SetFavorite { is_favorite } => {
                    ensure_active_item(conn, item, active_vault_id)?;
                    let favorite_value = if *is_favorite { 1 } else { 0 };
                    match item.item_type {
                        BulkVaultItemType::DataCard => execute_one(
                            conn,
                            "UPDATE datacards SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![favorite_value, now, item.id, active_vault_id],
                            "DATACARD_NOT_FOUND",
                        )?,
                        BulkVaultItemType::BankCard => execute_one(
                            conn,
                            "UPDATE bank_cards SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3 AND vault_id = ?4 AND deleted_at IS NULL",
                            params![favorite_value, now, item.id, active_vault_id],
                            "BANK_CARD_NOT_FOUND",
                        )?,
                    }
                }
                BulkVaultAction::Restore => {
                    ensure_deleted_item(conn, item, active_vault_id)?;
                    match item.item_type {
                        BulkVaultItemType::DataCard => {
                            execute_one(
                                conn,
                                "UPDATE datacards SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3 AND deleted_at IS NOT NULL",
                                params![now, item.id, active_vault_id],
                                "DATACARD_NOT_FOUND",
                            )?;
                            conn.execute(
                                "UPDATE attachments SET deleted_at = NULL, updated_at = ?1 WHERE datacard_id = ?2",
                                params![now, item.id],
                            )
                            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
                        }
                        BulkVaultItemType::BankCard => execute_one(
                            conn,
                            "UPDATE bank_cards SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND vault_id = ?3 AND deleted_at IS NOT NULL",
                            params![now, item.id, active_vault_id],
                            "BANK_CARD_NOT_FOUND",
                        )?,
                    }
                }
                BulkVaultAction::Purge => {
                    ensure_deleted_item(conn, item, active_vault_id)?;
                    match item.item_type {
                        BulkVaultItemType::DataCard => {
                            purged_attachment_ids.extend(purge_datacard_conn(
                                conn,
                                &item.id,
                                active_vault_id,
                            )?);
                        }
                        BulkVaultItemType::BankCard => {
                            purge_bank_card_conn(conn, &item.id, active_vault_id)?;
                        }
                    }
                }
            }
        }

        Ok(BulkApplyRepoOutcome {
            processed_count: input.items.len(),
            purged_attachment_ids,
        })
    })
}

pub fn list_selected_vault_items_for_export(
    state: &Arc<AppState>,
    profile_id: &str,
    items: &[BulkVaultItemRef],
) -> Result<(Vec<DataCard>, Vec<BankCardItem>, HashMap<String, String>)> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let mut data_cards = Vec::new();
        let mut bank_cards = Vec::new();
        let mut folder_names_by_id = HashMap::new();

        let mut folder_stmt = conn
            .prepare("SELECT id, name FROM folders WHERE vault_id = ?1 AND deleted_at IS NULL")
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        let folders = folder_stmt
            .query_map(params![active_vault_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
        for folder in folders {
            let (id, name) = folder.map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;
            folder_names_by_id.insert(id, name);
        }

        for item in items {
            match item.item_type {
                BulkVaultItemType::DataCard => {
                    let card = get_datacard_by_id_conn(conn, &item.id, active_vault_id)?;
                    if card.deleted_at.is_some() {
                        return Err(ErrorCodeString::new("BULK_ITEM_DELETED"));
                    }
                    data_cards.push(card);
                }
                BulkVaultItemType::BankCard => {
                    let card = get_bank_card_by_id_conn(conn, &item.id, active_vault_id)?;
                    if card.deleted_at.is_some() {
                        return Err(ErrorCodeString::new("BULK_ITEM_DELETED"));
                    }
                    bank_cards.push(card);
                }
            }
        }

        Ok((data_cards, bank_cards, folder_names_by_id))
    })
}
