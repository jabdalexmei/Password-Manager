use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{ErrorCodeString, Result};

pub const DERIVED_KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const ARGON2_MEMORY_KIB: u32 = 19456;
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_LANES: u32 = 1;

fn argon2_instance() -> Result<Argon2<'static>> {
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_TIME_COST,
        ARGON2_LANES,
        Some(DERIVED_KEY_LEN),
    )
    .map_err(|_| ErrorCodeString::new("PASSWORD_HASH"))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

pub fn generate_kdf_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_master_key(password: &str, salt: &[u8]) -> Result<[u8; DERIVED_KEY_LEN]> {
    let argon2 = argon2_instance()?;
    let mut output = Zeroizing::new([0u8; DERIVED_KEY_LEN]);
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut output[..])
        .map_err(|_| ErrorCodeString::new("PASSWORD_HASH"))?;
    Ok(*output)
}
