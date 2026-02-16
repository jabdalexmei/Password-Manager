use super::*;

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

