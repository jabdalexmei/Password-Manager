use super::*;

pub(super) fn with_connection<T>(
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

pub(super) fn current_active_vault_id(state: &Arc<AppState>) -> Option<String> {
    state
        .active_vault_id
        .lock()
        .ok()
        .and_then(|v| v.clone())
        .filter(|v| !v.trim().is_empty())
}

pub(super) fn get_default_vault_id_conn(conn: &Connection) -> Result<String> {
    let sql = "SELECT id FROM vaults WHERE is_default = 1 ORDER BY id ASC LIMIT 1";
    conn.query_row(sql, [], |row| row.get::<_, String>(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => ErrorCodeString::new("VAULT_DEFAULT_NOT_FOUND"),
            other => {
                log_sqlite_err("get_default_vault_id_conn.query_row", sql, &other);
                ErrorCodeString::new("DB_QUERY_FAILED")
            }
        })
}

pub(super) fn resolve_active_vault_id_conn(conn: &Connection, state: &Arc<AppState>) -> Result<String> {
    if let Some(active_vault_id) = current_active_vault_id(state) {
        let sql = "SELECT 1 FROM vaults WHERE id = ?1 LIMIT 1";
        let exists: Option<i32> = conn
            .query_row(sql, params![&active_vault_id], |row| row.get(0))
            .optional()
            .map_err(|e| {
                log_sqlite_err("resolve_active_vault_id_conn.query_row", sql, &e);
                ErrorCodeString::new("DB_QUERY_FAILED")
            })?;
        if exists.is_some() {
            return Ok(active_vault_id);
        }
    }

    get_default_vault_id_conn(conn)
}

pub(super) fn with_connection_in_active_vault<T>(
    state: &Arc<AppState>,
    profile_id: &str,
    f: impl FnOnce(&Connection, &str) -> Result<T>,
) -> Result<T> {
    with_connection(state, profile_id, |conn| {
        let active_vault_id = resolve_active_vault_id_conn(conn, state)?;
        f(conn, &active_vault_id)
    })
}

pub(super) fn with_connection_in_active_vault_tx<T>(
    state: &Arc<AppState>,
    profile_id: &str,
    f: impl FnOnce(&Connection, &str) -> Result<T>,
) -> Result<T> {
    with_connection(state, profile_id, |conn| {
        let active_vault_id = resolve_active_vault_id_conn(conn, state)?;

        conn.execute("BEGIN IMMEDIATE", []).map_err(|e| {
            log_sqlite_err(
                "with_connection_in_active_vault_tx.begin",
                "BEGIN IMMEDIATE",
                &e,
            );
            ErrorCodeString::new("DB_QUERY_FAILED")
        })?;

        let result = f(conn, &active_vault_id);

        match result {
            Ok(value) => {
                if let Err(err) = conn.execute("COMMIT", []) {
                    log_sqlite_err("with_connection_in_active_vault_tx.commit", "COMMIT", &err);
                    if let Err(rollback_err) = conn.execute("ROLLBACK", []) {
                        log_sqlite_err(
                            "with_connection_in_active_vault_tx.rollback_after_commit_failure",
                            "ROLLBACK",
                            &rollback_err,
                        );
                    }
                    return Err(ErrorCodeString::new("DB_QUERY_FAILED"));
                }

                Ok(value)
            }
            Err(err) => {
                if let Err(rollback_err) = conn.execute("ROLLBACK", []) {
                    log_sqlite_err(
                        "with_connection_in_active_vault_tx.rollback",
                        "ROLLBACK",
                        &rollback_err,
                    );
                }
                Err(err)
            }
        }
    })
}

pub(super) fn deserialize_json<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value)
        .map_err(|err| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(err)))
}

pub(super) fn serialize_json<T: serde::Serialize + ?Sized>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))
}
