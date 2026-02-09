use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;
use crate::data::fs::atomic_write::write_atomic;
use crate::error::{ErrorCodeString, Result};

pub const PM_ENC_MAGIC: [u8; 6] = *b"PMENC1";
pub const PM_ENC_VERSION: u8 = 1;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;

fn new_cipher(key: &[u8; KEY_LEN]) -> Result<XChaCha20Poly1305> {
    XChaCha20Poly1305::new_from_slice(key).map_err(|_| ErrorCodeString::new("INVALID_KEY_LEN"))
}

pub fn encrypt_bytes(key: &[u8; KEY_LEN], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = new_cipher(key)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            &nonce,
            chacha20poly1305::aead::Payload {
                aad,
                msg: plaintext,
            },
        )
        .map_err(|_| ErrorCodeString::new("CRYPTO_ENCRYPT_FAILED"))?;

    let mut blob = Vec::with_capacity(PM_ENC_MAGIC.len() + 1 + NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&PM_ENC_MAGIC);
    blob.push(PM_ENC_VERSION);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

fn parse_blob(blob: &[u8]) -> Result<(XNonce, &[u8])> {
    if blob.len() < PM_ENC_MAGIC.len() + 1 + NONCE_LEN {
        return Err(ErrorCodeString::new("CRYPTO_BLOB_INVALID"));
    }

    let (magic, rest) = blob.split_at(PM_ENC_MAGIC.len());
    if magic != PM_ENC_MAGIC {
        return Err(ErrorCodeString::new("CRYPTO_BLOB_INVALID"));
    }

    let (version_slice, rest) = rest
        .split_first()
        .ok_or_else(|| ErrorCodeString::new("CRYPTO_BLOB_INVALID"))?;
    if *version_slice != PM_ENC_VERSION {
        return Err(ErrorCodeString::new("CRYPTO_VERSION_UNSUPPORTED"));
    }

    let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);
    let nonce = XNonce::from_slice(nonce_bytes).clone();
    Ok((nonce, ciphertext))
}

pub fn decrypt_bytes(key: &[u8; KEY_LEN], aad: &[u8], blob: &[u8]) -> Result<Vec<u8>> {
    let cipher = new_cipher(key)?;
    let (nonce, ciphertext) = parse_blob(blob)?;

    cipher
        .decrypt(
            &nonce,
            chacha20poly1305::aead::Payload {
                aad,
                msg: ciphertext,
            },
        )
        .map_err(|_| ErrorCodeString::new("CRYPTO_DECRYPT_FAILED"))
}

pub fn write_encrypted_file(path: &std::path::Path, blob: &[u8]) -> Result<()> {
    write_atomic(path, blob).map_err(|ioe| {
        log::error!(
            "[CRYPTO][write_encrypted_file] path={:?} io_error={:?}",
            path,
            ioe
        );
        ErrorCodeString::new("ENCRYPTED_FILE_WRITE")
    })
}

pub fn read_encrypted_file(path: &std::path::Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|_| ErrorCodeString::new("ENCRYPTED_FILE_READ"))
}

pub fn encrypt_attachment_blob(
    profile_id: &str,
    attachment_id: &str,
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let aad = format!("attachment:{}:{}", profile_id, attachment_id);
    encrypt_bytes(key, aad.as_bytes(), plaintext)
}

pub fn decrypt_attachment_blob(
    profile_id: &str,
    attachment_id: &str,
    key: &[u8; KEY_LEN],
    blob: &[u8],
) -> Result<Vec<u8>> {
    let aad = format!("attachment:{}:{}", profile_id, attachment_id);
    decrypt_bytes(key, aad.as_bytes(), blob)
}

pub fn encrypt_vault_blob(
    profile_id: &str,
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let aad = format!("vault_db:{}", profile_id);
    encrypt_bytes(key, aad.as_bytes(), plaintext)
}

pub fn decrypt_vault_blob(profile_id: &str, key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>> {
    let aad = format!("vault_db:{}", profile_id);
    decrypt_bytes(key, aad.as_bytes(), blob)
}

pub fn encrypt_key_check(
    profile_id: &str,
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let aad = format!("key_check:{}", profile_id);
    encrypt_bytes(key, aad.as_bytes(), plaintext)
}

pub fn decrypt_key_check(profile_id: &str, key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>> {
    let aad = format!("key_check:{}", profile_id);
    decrypt_bytes(key, aad.as_bytes(), blob)
}
