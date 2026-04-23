use super::*;

pub fn set_profile_password(
    id: &str,
    password: &str,
    state: &Arc<AppState>,
) -> Result<ProfileMeta> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let storage_paths = state.get_storage_paths()?;
    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_ALREADY_PROTECTED"));
    }

    if password.chars().all(|c| c.is_whitespace()) {
        return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
    }

    // Must be unlocked to set a password: we need the current master key.
    let master: Zeroizing<[u8; cipher::KEY_LEN]> = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        let session = session_guard
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

        if session.profile_id != id {
            return Err(ErrorCodeString::new("WRONG_PROFILE_ACTIVE"));
        }
        Zeroizing::new(*session.key)
    };

    ensure_profile_dirs(&storage_paths, id, true)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    // If there is a leftover transaction from a previous crash, recover it first.
    recover_set_password_tx(&storage_paths, id, &profile.name)?;
    recover_remove_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(SET_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    // Build new key material (salt + wrapping key + key_check + wrapped vault_key).
    let mut salt = [0u8; 16];
    let mut rng = OsRng;
    rng.fill_bytes(&mut salt);

    let wrapping_key = Zeroizing::new(
        kdf::derive_master_key(password, &salt).map_err(|_| ErrorCodeString::new("KDF_FAILED"))?,
    );

    let key_check_blob = key_check::create_key_check_blob(id, &*wrapping_key)?;
    let vault_key_blob =
        master_key::wrap_master_key_with_password_blob(id, &*wrapping_key, &*master)?;

    // Stage new files into tx dir first.
    let vault_key_new = tx_root.join("vault_key.bin.new");
    let salt_new = tx_root.join("kdf_salt.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");

    write_atomic(&vault_key_new, &vault_key_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&salt_new, &salt).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&key_check_new, &key_check_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let salt_final = kdf_salt_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");
    let commit = tx_root.join(SET_PASSWORD_TX_COMMIT_MARKER);

    let tx_result = (|| -> io::Result<()> {
        // Backup existing key file (it contains the unwrapped master key, so keep it only in tx dir).
        if !vault_key_final.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "vault_key.bin missing",
            ));
        }
        if vault_key_bak.exists() {
            remove_file_retry(&vault_key_bak, 20, Duration::from_millis(50))?;
        }
        rename_retry(
            &vault_key_final,
            &vault_key_bak,
            20,
            Duration::from_millis(50),
        )?;

        // Backup existing protected-only files if they exist (stale leftovers).
        if salt_final.exists() {
            if salt_bak.exists() {
                remove_file_retry(&salt_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&salt_final, &salt_bak, 20, Duration::from_millis(50))?;
        }
        if key_check_final.exists() {
            if key_check_bak.exists() {
                remove_file_retry(&key_check_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(
                &key_check_final,
                &key_check_bak,
                20,
                Duration::from_millis(50),
            )?;
        }

        // Move staged files into place.
        rename_retry(
            &vault_key_new,
            &vault_key_final,
            20,
            Duration::from_millis(50),
        )?;
        rename_retry(&salt_new, &salt_final, 20, Duration::from_millis(50))?;
        rename_retry(
            &key_check_new,
            &key_check_final,
            20,
            Duration::from_millis(50),
        )?;

        // Commit marker is written last to make crash recovery deterministic.
        write_atomic(&commit, b"1")?;
        Ok(())
    })();

    if let Err(e) = tx_result {
        log::warn!(
            "[SECURITY][set_profile_password] profile_id={} action=tx_failed err={}",
            id,
            e
        );
        let _ = rollback_set_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final);
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let updated = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, true)?;

    // Best-effort cleanup: if deletion fails, at least remove the plaintext backup by overwriting it
    // with the encrypted vault_key.bin.
    if let Err(e) = remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50)) {
        log::warn!(
            "[SECURITY][set_profile_password] profile_id={} action=cleanup_failed tx_root={:?} err={}",
            id,
            tx_root,
            e
        );
        let vault_key_bak = tx_root.join("vault_key.bin.bak");
        if vault_key_bak.exists() && file_has_prefix(&vault_key_bak, MASTER_KEY_PREFIX) {
            if let Ok(blob) = std::fs::read(&vault_key_final) {
                let _ = write_atomic(&vault_key_bak, &blob);
            }
        }
        let _ = remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    }

    Ok(updated.into())
}

pub fn change_profile_password(id: &str, password: &str, state: &Arc<AppState>) -> Result<bool> {
    let storage_paths = state.get_storage_paths()?;

    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if !profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_NOT_PROTECTED"));
    }

    if password.chars().all(|c| c.is_whitespace()) {
        return Err(ErrorCodeString::new("PASSWORD_REQUIRED"));
    }

    // Prevent concurrent persists while we rotate key material.
    // persist_active_vault takes this guard before reading vault_session.
    let _persist_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    // Must be unlocked (session exists and matches profile) because we do NOT re-encrypt vault.db;
    // we only re-wrap the existing master key.
    let master = {
        let session = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        let s = session
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;
        if s.profile_id != id {
            return Err(ErrorCodeString::new("VAULT_LOCKED"));
        }
        Zeroizing::new(*s.key)
    };

    // Keep the existing salt to avoid multi-file atomicity problems.
    let salt_path = kdf_salt_path(&storage_paths, id)?;
    let salt =
        std::fs::read(&salt_path).map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if salt.is_empty() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    let wrapping_key = Zeroizing::new(kdf::derive_master_key(password, &salt)?);
    // Crash-safety: update vault_key.bin and key_check.bin as a single transaction.
    // If the app crashes mid-flight, we rollback to the old password on next launch.
    recover_change_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(CHANGE_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    if !vault_key_final.exists() || !key_check_final.exists() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    let vault_key_new = tx_root.join("vault_key.bin.new");
    let key_check_new = tx_root.join("key_check.bin.new");
    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");

    let vault_key_blob =
        master_key::wrap_master_key_with_password_blob(id, &*wrapping_key, &*master)?;
    let key_check_blob = key_check::create_key_check_blob(id, &*wrapping_key)?;

    write_atomic(&vault_key_new, &vault_key_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
    write_atomic(&key_check_new, &key_check_blob)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let tx_result: Result<()> = (|| {
        // 1) Move the old files into tx_root as backups
        rename_retry(
            &vault_key_final,
            &vault_key_bak,
            20,
            Duration::from_millis(50),
        )
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        rename_retry(
            &key_check_final,
            &key_check_bak,
            20,
            Duration::from_millis(50),
        )
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

        // 2) Move the new files into place
        rename_retry(
            &vault_key_new,
            &vault_key_final,
            20,
            Duration::from_millis(50),
        )
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        rename_retry(
            &key_check_new,
            &key_check_final,
            20,
            Duration::from_millis(50),
        )
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

        // 3) Mark commit (best-effort cleanup will remove tx_root later)
        write_atomic(&tx_root.join(CHANGE_PASSWORD_TX_COMMIT_MARKER), b"1")
            .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;
        Ok(())
    })();

    if tx_result.is_err() {
        // Best-effort rollback: keep the profile unlockable with the old password.
        let _ = rollback_change_password_tx(&tx_root, &vault_key_final, &key_check_final);
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    // Best-effort cleanup.
    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));

    let _ = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, true)?;
    Ok(true)
}

pub fn remove_profile_password(id: &str, state: &Arc<AppState>) -> Result<ProfileMeta> {
    let _flight_guard = state
        .vault_persist_guard
        .lock()
        .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

    let storage_paths = state.get_storage_paths()?;
    let profile = registry::get_profile(&storage_paths, id)?
        .ok_or_else(|| ErrorCodeString::new("PROFILE_NOT_FOUND"))?;

    if !profile.has_password {
        return Err(ErrorCodeString::new("PROFILE_ALREADY_PASSWORDLESS"));
    }

    // Must be unlocked to remove a password: we need the current master key.
    let master: Zeroizing<[u8; cipher::KEY_LEN]> = {
        let session_guard = state
            .vault_session
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

        let session = session_guard
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("VAULT_LOCKED"))?;

        if session.profile_id != id {
            return Err(ErrorCodeString::new("WRONG_PROFILE_ACTIVE"));
        }
        Zeroizing::new(*session.key)
    };

    ensure_profile_dirs(&storage_paths, id, true)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    // If there is a leftover transaction from a previous crash, recover it first.
    recover_change_password_tx(&storage_paths, id, &profile.name)?;
    recover_set_password_tx(&storage_paths, id, &profile.name)?;
    recover_remove_password_tx(&storage_paths, id, &profile.name)?;

    let profile_root = profile_dir(&storage_paths, id)?;
    let tx_root = profile_root.join("tmp").join(REMOVE_PASSWORD_TX_DIR);
    prepare_empty_dir(&tx_root)?;

    let vault_key_final = vault_key_path(&storage_paths, id)?;
    let salt_final = kdf_salt_path(&storage_paths, id)?;
    let key_check_final = key_check_path(&storage_paths, id)?;

    // Stage the new unwrapped vault_key.bin into tx dir first.
    let vault_key_new = tx_root.join("vault_key.bin.new");
    let master_arr: [u8; master_key::MASTER_KEY_LEN] = *master;
    let plain_blob = master_key::unwrapped_master_key_blob(id, &master_arr);
    write_atomic(&vault_key_new, plain_blob.as_slice())
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_WRITE"))?;

    let vault_key_bak = tx_root.join("vault_key.bin.bak");
    let salt_bak = tx_root.join("kdf_salt.bin.bak");
    let key_check_bak = tx_root.join("key_check.bin.bak");
    let commit = tx_root.join(REMOVE_PASSWORD_TX_COMMIT_MARKER);

    let tx_result = (|| -> io::Result<()> {
        // Backup old protected materials into tx dir.
        if vault_key_final.exists() {
            if vault_key_bak.exists() {
                remove_file_retry(&vault_key_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(
                &vault_key_final,
                &vault_key_bak,
                20,
                Duration::from_millis(50),
            )?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "vault_key.bin missing",
            ));
        }

        if salt_final.exists() {
            if salt_bak.exists() {
                remove_file_retry(&salt_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(&salt_final, &salt_bak, 20, Duration::from_millis(50))?;
        }

        if key_check_final.exists() {
            if key_check_bak.exists() {
                remove_file_retry(&key_check_bak, 20, Duration::from_millis(50))?;
            }
            rename_retry(
                &key_check_final,
                &key_check_bak,
                20,
                Duration::from_millis(50),
            )?;
        }

        // Move staged new vault_key.bin into place.
        rename_retry(
            &vault_key_new,
            &vault_key_final,
            20,
            Duration::from_millis(50),
        )?;

        // Commit marker is written last to make crash recovery deterministic.
        write_atomic(&commit, b"1")?;
        Ok(())
    })();

    if let Err(e) = tx_result {
        log::warn!(
            "[SECURITY][remove_profile_password] profile_id={} action=tx_failed err={}",
            id,
            e
        );
        let _ =
            rollback_remove_password_tx(&tx_root, &vault_key_final, &salt_final, &key_check_final);
        best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
        return Err(ErrorCodeString::new("PROFILE_STORAGE_WRITE"));
    }

    let updated = registry::upsert_profile_with_id(&storage_paths, id, &profile.name, false)?;

    best_effort_remove_dir_all_retry(&tx_root, 40, Duration::from_millis(50));
    Ok(updated.into())
}
