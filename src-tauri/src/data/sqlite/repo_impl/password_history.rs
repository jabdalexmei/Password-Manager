use super::*;

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
            .query_map(
                params![datacard_id, active_vault_id],
                map_password_history_row,
            )
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


pub fn delete_password_history_entry(
    state: &Arc<AppState>,
    profile_id: &str,
    entry_id: &str,
) -> Result<usize> {
    with_connection_in_active_vault(state, profile_id, |conn, active_vault_id| {
        let deleted = conn
            .execute(
                "DELETE FROM datacard_password_history WHERE id = ?1 AND datacard_id IN (SELECT id FROM datacards WHERE vault_id = ?2)",
                params![entry_id, active_vault_id],
            )
            .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

        Ok(deleted as usize)
    })
}
