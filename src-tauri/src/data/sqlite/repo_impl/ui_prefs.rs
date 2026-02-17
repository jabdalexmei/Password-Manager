use super::*;

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
