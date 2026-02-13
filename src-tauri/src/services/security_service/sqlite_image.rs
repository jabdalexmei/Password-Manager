use super::*;

pub(super) fn owned_data_from_bytes(mut bytes: Vec<u8>) -> Result<OwnedData> {
    if bytes.is_empty() {
        return Err(ErrorCodeString::new("EMPTY_SERIALIZED_DB"));
    }

    let mem = unsafe { ffi::sqlite3_malloc64(bytes.len() as u64) };
    if mem.is_null() {
        return Err(ErrorCodeString::new("SQLITE_OOM"));
    }

    let owned = unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), mem as *mut u8, bytes.len());
        OwnedData::from_raw_nonnull(NonNull::new_unchecked(mem as *mut u8), bytes.len())
    };

    bytes.zeroize();
    Ok(owned)
}

pub(super) fn apply_in_memory_pragmas(conn: &rusqlite::Connection, profile_id: &str, ctx: &str) -> Result<()> {
    // Keep this minimal and non-invasive. Setting journal_mode can itself trigger SQLITE_CANTOPEN
    // if the deserialized image is marked as WAL and SQLite attempts to open sidecars.
    conn.execute_batch(
        "PRAGMA temp_store=MEMORY;
PRAGMA synchronous=OFF;
",
    )
    .map_err(|e| {
        log::error!(
            "[SECURITY][pragmas] profile_id={} ctx={} err={}",
            profile_id,
            ctx,
            format_rusqlite_error(&e)
        );
        classify_db_error(&e)
    })
}

pub(super) fn best_effort_force_journal_mode_memory(conn: &rusqlite::Connection, profile_id: &str, ctx: &str) {
    // Best-effort: we do not fail the whole flow if this pragma fails.
    // The goal is to ensure serialized in-memory images are not WAL-marked.
    let res: rusqlite::Result<String> =
        conn.query_row("PRAGMA journal_mode=MEMORY;", [], |row| row.get(0));
    if let Err(e) = res {
        log::warn!(
            "[SECURITY][pragmas] profile_id={} ctx={} action=journal_mode_memory_failed err={}",
            profile_id,
            ctx,
            format_rusqlite_error(&e)
        );
    }
}

pub(super) fn normalize_sqlite_header_disable_wal(bytes: &mut [u8], profile_id: &str, ctx: &str) {
    // SQLite header magic: "SQLite format 3\0"
    const MAGIC: &[u8; 16] = b"SQLite format 3\0";
    if bytes.len() < 20 {
        return;
    }
    if &bytes[..16] != MAGIC {
        return;
    }

    // As per SQLite documentation/notes: WAL mode persistence is reflected in the DB header bytes.
    // Values 2 at offsets 18/19 indicate WAL read/write versions. Setting them to 1 disables WAL
    // expectations and prevents attempts to open -wal/-shm for deserialized in-memory images.
    // (This is safe for our use-case because we always serialize a consistent image.)
    let mut changed = false;
    if bytes[18] == 2 {
        bytes[18] = 1;
        changed = true;
    }
    if bytes[19] == 2 {
        bytes[19] = 1;
        changed = true;
    }
    if changed {
        log::info!(
            "[SECURITY][sqlite_header] profile_id={} ctx={} action=disable_wal_header_bytes",
            profile_id,
            ctx
        );
    }
}

pub(super) fn ensure_ciphertext_vault_on_disk(vault_path: &Path, profile_id: &str) -> Result<()> {
    const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
    if !vault_path.exists() {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    // Detect legacy/plaintext vaults early. A plaintext SQLite DB starting with the SQLite magic
    // must never exist on disk under the "always encrypted" invariant.
    let magic = read_file_prefix(vault_path, SQLITE_MAGIC.len())
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if magic.as_slice() == SQLITE_MAGIC {
        log::error!(
            "[SECURITY][vault_at_rest] profile_id={} action=plaintext_detected path={:?}",
            profile_id,
            vault_path
        );
        return Err(ErrorCodeString::new("VAULT_PLAINTEXT_DETECTED"));
    }

    // Enforce our encrypted blob header ("PMENC1" + version).
    let header_len = cipher::PM_ENC_MAGIC.len() + 1;
    let header = read_file_prefix(vault_path, header_len)
        .map_err(|_| ErrorCodeString::new("PROFILE_STORAGE_READ"))?;
    if header.len() != header_len {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }
    if &header[..cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_MAGIC {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }
    if header[cipher::PM_ENC_MAGIC.len()] != cipher::PM_ENC_VERSION {
        return Err(ErrorCodeString::new("VAULT_CORRUPTED"));
    }

    Ok(())
}

