use rand::rngs::OsRng;
use rand::RngCore;

use crate::data::crypto::cipher::{
    decrypt_key_check, encrypt_key_check, read_encrypted_file, write_encrypted_file, KEY_LEN,
};
use crate::data::profiles::paths::key_check_path;
use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};

const KEY_CHECK_MAGIC: &[u8] = b"pm_key_check_v1";

pub fn create_key_check_blob(profile_id: &str, key: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    let mut payload = Vec::from(KEY_CHECK_MAGIC);
    let mut random_bytes = [0u8; 16];
    OsRng.fill_bytes(&mut random_bytes);
    payload.extend_from_slice(&random_bytes);

    encrypt_key_check(profile_id, key, &payload)
}

pub fn create_key_check_file(
    sp: &StoragePaths,
    profile_id: &str,
    key: &[u8; KEY_LEN],
) -> Result<()> {
    let blob = create_key_check_blob(profile_id, key)?;
    write_encrypted_file(&key_check_path(sp, profile_id)?, &blob)
}

pub fn verify_key_check_file(
    sp: &StoragePaths,
    profile_id: &str,
    key: &[u8; KEY_LEN],
) -> Result<bool> {
    let path = key_check_path(sp, profile_id)?;
    if !path.exists() {
        return Err(ErrorCodeString::new("KEY_CHECK_MISSING"));
    }
    let blob = read_encrypted_file(&path)?;
    let decrypted = decrypt_key_check(profile_id, key, &blob)
        .map_err(|_| ErrorCodeString::new("INVALID_PASSWORD"))?;
    Ok(decrypted.starts_with(KEY_CHECK_MAGIC))
}
