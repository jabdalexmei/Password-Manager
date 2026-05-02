use super::*;

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

pub fn get_default_vault_id(state: &Arc<AppState>, profile_id: &str) -> Result<String> {
    with_connection(state, profile_id, get_default_vault_id_conn)
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

pub fn set_default_vault(state: &Arc<AppState>, profile_id: &str, id: &str) -> Result<bool> {
    with_connection(state, profile_id, |conn| {
        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        let result: Result<bool> = (|| {
            let _ = get_vault_by_id_conn(conn, id)?;
            let now = Utc::now().to_rfc3339();

            conn.execute(
                "UPDATE vaults SET is_default = 0, updated_at = ?1 WHERE is_default = 1 AND id <> ?2",
                params![&now, id],
            )
            .map_err(map_vault_default_constraint_error)?;

            let rows = conn
                .execute(
                    "UPDATE vaults SET is_default = 1, updated_at = ?1 WHERE id = ?2",
                    params![&now, id],
                )
                .map_err(map_vault_default_constraint_error)?;
            if rows == 0 {
                return Err(ErrorCodeString::new("VAULT_NOT_FOUND"));
            }

            Ok(true)
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
