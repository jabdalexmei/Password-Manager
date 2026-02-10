use super::*;

pub fn persist_active_vault(state: &Arc<AppState>) -> Result<Option<String>> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let maybe_bytes_and_meta = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        if let Some(session) = session_guard.as_ref() {
            let serialized = session
                .conn
                .serialize(DatabaseName::Main)
                .map_err(|_| ErrorCodeString::new("DB_QUERY_FAILED"))?;

            let bytes = Zeroizing::new(serialized.to_vec());

            let profile_id = session.profile_id.clone();
            let key_material = Zeroizing::new(*session.key);

            Some((profile_id, key_material, bytes))
        } else {
            None
        }
    };

    if let Some((profile_id, key_material, bytes)) = maybe_bytes_and_meta {
        let storage_paths = state.get_storage_paths()?;
        let encrypted = cipher::encrypt_vault_blob(&profile_id, &*key_material, bytes.as_slice())?;
        cipher::write_encrypted_file(&vault_db_path(&storage_paths, &profile_id)?, &encrypted)?;
        return Ok(Some(profile_id));
    }

    Ok(None)
}

pub fn request_persist_active_vault(state: Arc<AppState>) {
    state.vault_persist_requested.store(true, Ordering::SeqCst);

    if state.vault_persist_in_flight.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        loop {
            state.vault_persist_requested.store(false, Ordering::SeqCst);

            if let Err(error) = persist_active_vault(&state) {
                log::error!("[SECURITY][persist_active_vault] failed: {error:?}");
            }

            if !state.vault_persist_requested.load(Ordering::SeqCst) {
                break;
            }
        }

        state.vault_persist_in_flight.store(false, Ordering::SeqCst);

        if state.vault_persist_requested.load(Ordering::SeqCst) {
            request_persist_active_vault(state);
        }
    });
}
