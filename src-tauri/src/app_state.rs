use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::data::storage_paths::StoragePaths;
use crate::error::{ErrorCodeString, Result};

use fs2::FileExt;

use zeroize::Zeroizing;

pub struct VaultSession {
    pub profile_id: String,
    pub conn: rusqlite::Connection,
    pub key: Zeroizing<[u8; 32]>,
}

#[derive(Clone)]
pub struct PendingPickedFile {
    pub id: String,
    pub path: PathBuf,
    pub file_name: String,
    pub byte_size: u64,
}

pub struct PendingAttachmentPick {
    pub created_at_ms: u128,
    pub files: Vec<PendingPickedFile>,
}

#[derive(Clone)]
pub struct PendingBackupPick {
    pub created_at_ms: u128,
    pub path: PathBuf,
}

pub struct AppState {
    pub active_profile: Mutex<Option<String>>,
    pub active_vault_id: Mutex<Option<String>>,
    pub storage_paths: Mutex<StoragePaths>,

    pub workspace_lock: Mutex<Option<std::fs::File>>,

    pub vault_session: Mutex<Option<VaultSession>>,
    pub vault_persist_guard: Mutex<()>,
    pub vault_persist_requested: AtomicBool,
    pub vault_persist_in_flight: AtomicBool,
    pub backup_guard: Mutex<()>,

    // One-time picks created by backend-native dialogs.
    // Frontend only receives opaque ids (token + file ids), never filesystem paths.
    pub pending_attachment_picks: Mutex<HashMap<String, PendingAttachmentPick>>,

    // Same idea for backups: frontend must not pass arbitrary paths.
    pub pending_backup_picks: Mutex<HashMap<String, PendingBackupPick>>,
}

impl AppState {
    pub fn new(storage_paths: StoragePaths) -> Self {
        Self {
            active_profile: Mutex::new(None),
            active_vault_id: Mutex::new(None),
            storage_paths: Mutex::new(storage_paths),

            workspace_lock: Mutex::new(None),

            vault_session: Mutex::new(None),
            vault_persist_guard: Mutex::new(()),
            vault_persist_requested: AtomicBool::new(false),
            vault_persist_in_flight: AtomicBool::new(false),
            backup_guard: Mutex::new(()),

            pending_attachment_picks: Mutex::new(HashMap::new()),
            pending_backup_picks: Mutex::new(HashMap::new()),
        }
    }

    fn acquire_workspace_lock(workspace_root: &PathBuf) -> Result<std::fs::File> {
        let lock_path = workspace_root.join(".pm-workspace.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&lock_path)
            .map_err(|_| ErrorCodeString::new("WORKSPACE_LOCK_FAILED"))?;

        file.try_lock_exclusive()
            .map_err(|_| ErrorCodeString::new("WORKSPACE_ALREADY_IN_USE"))?;

        Ok(file)
    }

    pub fn set_workspace_root(&self, workspace_root: std::path::PathBuf) -> Result<()> {
        // If the requested workspace is already active in this process, don't try to re-lock it.
        // On Windows, re-acquiring the same lock from the same process can fail (WORKSPACE_ALREADY_IN_USE).
        {
            let storage_paths = self
                .storage_paths
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;

            if let Ok(current) = storage_paths.workspace_root() {
                let current_can =
                    std::fs::canonicalize(current).unwrap_or_else(|_| current.clone());
                let requested_can = std::fs::canonicalize(&workspace_root)
                    .unwrap_or_else(|_| workspace_root.clone());

                if current_can == requested_can {
                    return Ok(());
                }
            }
        }

        // Preflight create to ensure workspace_root exists before we attempt to lock.
        // This is safe even if locking fails (no user data is modified here).
        let profiles_dir = workspace_root.join("Profiles");
        std::fs::create_dir_all(&profiles_dir)
            .map_err(|_| ErrorCodeString::new("WORKSPACE_PROFILES_CREATE_FAILED"))?;

        // Acquire a cross-process lock to prevent multi-instance corruption.
        let lock_file = Self::acquire_workspace_lock(&workspace_root)?;

        {
            let mut storage_paths = self
                .storage_paths
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            storage_paths.configure_workspace(workspace_root)?;
        }

        {
            let mut ws_lock = self
                .workspace_lock
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            *ws_lock = Some(lock_file);
        }

        self.clear_security_state()?;
        Ok(())
    }

    pub fn clear_workspace_root(&self) -> Result<()> {
        {
            let mut ws_lock = self
                .workspace_lock
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            *ws_lock = None;
        }
        {
            let mut storage_paths = self
                .storage_paths
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            storage_paths.clear_workspace();
        }
        self.clear_security_state()?;
        Ok(())
    }

    pub fn get_storage_paths(&self) -> Result<StoragePaths> {
        let storage_paths = self
            .storage_paths
            .lock()
            .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
        if storage_paths.workspace_root().is_err() {
            return Err(ErrorCodeString::new("WORKSPACE_NOT_SELECTED"));
        }
        Ok(storage_paths.clone())
    }

    pub fn logout_and_cleanup(self: &Arc<Self>) -> Result<()> {
        crate::services::security_service::lock_vault(self)?;

        self.clear_security_state()?;

        Ok(())
    }

    fn clear_security_state(&self) -> Result<()> {
        {
            let mut active = self
                .active_profile
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            *active = None;
        }
        {
            let mut active_vault_id = self
                .active_vault_id
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            *active_vault_id = None;
        }
        {
            let mut session = self
                .vault_session
                .lock()
                .map_err(|_| ErrorCodeString::new("STATE_UNAVAILABLE"))?;
            *session = None;
        }
        Ok(())
    }
}
