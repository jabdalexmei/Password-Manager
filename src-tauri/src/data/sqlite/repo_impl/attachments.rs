use super::*;

fn get_attachment_by_id_conn(
    conn: &Connection,
    attachment_id: &str,
    active_vault_id: &str,
) -> Result<AttachmentMeta> {
    let mut stmt = conn
        .prepare(
            "SELECT a.* FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.id = ?1 AND d.vault_id = ?2",
        )
        .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

    match stmt.query_row(params![attachment_id, active_vault_id], map_attachment) {
        Ok(meta) => Ok(meta),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"))
        }
        Err(err) => {
            log_sqlite_err(
                "get_attachment_by_id_conn.query_row",
                "SELECT a.* FROM attachments a INNER JOIN datacards d ON d.id = a.datacard_id WHERE a.id = ?1 AND d.vault_id = ?2",
                &err,
            );
            Err(ErrorCodeString::new("DB_QUERY_FAILED"))
        }
    }
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
        list_active_attachments_by_datacard_conn(conn, datacard_id, active_vault_id)
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
        match get_attachment_by_id_conn(conn, attachment_id, active_vault_id) {
            Ok(meta) => Ok(Some(meta)),
            Err(err) if err.code == "ATTACHMENT_NOT_FOUND" => Ok(None),
            Err(err) => Err(err),
        }
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

pub fn rename_attachment(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
    file_name: &str,
    updated_at: &str,
) -> Result<()> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let rows = conn
            .execute(
                "UPDATE attachments SET file_name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = attachments.datacard_id AND d.vault_id = ?4)",
                params![file_name, updated_at, attachment_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if rows == 0 {
            return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
        }

        Ok(())
    })
}

pub fn purge_attachment_and_get_meta(
    state: &Arc<AppState>,
    profile_id: &str,
    attachment_id: &str,
) -> Result<AttachmentMeta> {
    with_connection_in_active_vault_tx(state, profile_id, |conn, active_vault_id| {
        let meta = get_attachment_by_id_conn(conn, attachment_id, active_vault_id)?;
        let updated = conn
            .execute(
                "DELETE FROM attachments WHERE id = ?1 AND EXISTS (SELECT 1 FROM datacards d WHERE d.id = attachments.datacard_id AND d.vault_id = ?2)",
                params![attachment_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        if updated == 0 {
            return Err(ErrorCodeString::new("ATTACHMENT_NOT_FOUND"));
        }

        Ok(meta)
    })
}
