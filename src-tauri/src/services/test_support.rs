#[cfg(test)]
use std::fs;
#[cfg(test)]
use std::sync::Arc;

#[cfg(test)]
use rusqlite::Connection;
#[cfg(test)]
use tempfile::TempDir;
#[cfg(test)]
use zeroize::Zeroizing;

#[cfg(test)]
use crate::app_state::{AppState, VaultSession};
#[cfg(test)]
use crate::data::profiles::paths::attachment_file_path;
#[cfg(test)]
use crate::data::sqlite::repo_impl;
#[cfg(test)]
use crate::data::sqlite::schema_initialization::schema_initialization;
#[cfg(test)]
use crate::data::storage_paths::StoragePaths;
#[cfg(test)]
use crate::services::settings_service;
#[cfg(test)]
use crate::types::{
    AttachmentMeta, BankCardItem, CreateBankCardInput, CreateDataCardInput, DataCard, Folder,
    UpdateDataCardInput, UserSettings,
};

#[cfg(test)]
pub(crate) struct ServiceTestHarness {
    _temp_dir: TempDir,
    pub state: Arc<AppState>,
    pub profile_id: String,
}

#[cfg(test)]
impl ServiceTestHarness {
    pub(crate) fn new() -> Self {
        let temp_dir = tempfile::tempdir().unwrap();
        let workspace_root = temp_dir.path().join("workspace");
        let app_config_dir = temp_dir.path().join("app-config");
        fs::create_dir_all(&workspace_root).unwrap();
        fs::create_dir_all(&app_config_dir).unwrap();

        let mut storage_paths = StoragePaths::new_unconfigured().unwrap();
        storage_paths.configure_workspace(workspace_root).unwrap();

        let state = Arc::new(AppState::new(storage_paths, app_config_dir));
        let profile_id = "profile-test".to_string();
        let conn = Connection::open_in_memory().unwrap();
        schema_initialization(&conn).unwrap();

        let profile_root = state
            .get_storage_paths()
            .unwrap()
            .profiles_root()
            .unwrap()
            .join(&profile_id);
        fs::create_dir_all(profile_root.join("attachments")).unwrap();

        {
            let mut active_profile = state.active_profile.lock().unwrap();
            *active_profile = Some(profile_id.clone());
        }
        {
            let mut active_vault_id = state.active_vault_id.lock().unwrap();
            *active_vault_id = Some("default".to_string());
        }
        {
            let mut session = state.vault_session.lock().unwrap();
            *session = Some(VaultSession {
                profile_id: profile_id.clone(),
                conn,
                key: Zeroizing::new([7u8; 32]),
            });
        }

        Self {
            _temp_dir: temp_dir,
            state,
            profile_id,
        }
    }

    pub(crate) fn storage_paths(&self) -> StoragePaths {
        self.state.get_storage_paths().unwrap()
    }

    pub(crate) fn attachment_path(&self, attachment_id: &str) -> std::path::PathBuf {
        attachment_file_path(&self.storage_paths(), &self.profile_id, attachment_id).unwrap()
    }

    pub(crate) fn create_folder(&self, name: &str, parent_id: Option<String>) -> Folder {
        repo_impl::create_folder(&self.state, &self.profile_id, name, &parent_id).unwrap()
    }

    pub(crate) fn create_datacard(
        &self,
        title: &str,
        folder_id: Option<String>,
        password: Option<String>,
    ) -> DataCard {
        repo_impl::create_datacard(
            &self.state,
            &self.profile_id,
            &CreateDataCardInput {
                title: title.to_string(),
                url: None,
                email: None,
                recovery_email: None,
                username: None,
                mobile_phone: None,
                note: None,
                tags: Vec::new(),
                password,
                totp_uri: None,
                seed_phrase: None,
                seed_phrase_word_count: None,
                custom_fields: Vec::new(),
                folder_id,
            },
        )
        .unwrap()
    }

    pub(crate) fn update_datacard_password(&self, card: &DataCard, password: Option<String>) {
        let updated = repo_impl::update_datacard(
            &self.state,
            &self.profile_id,
            &UpdateDataCardInput {
                id: card.id.clone(),
                title: card.title.clone(),
                url: card.url.clone(),
                email: card.email.clone(),
                recovery_email: card.recovery_email.clone(),
                username: card.username.clone(),
                mobile_phone: card.mobile_phone.clone(),
                note: card.note.clone(),
                tags: card.tags.clone(),
                password,
                totp_uri: card.totp_uri.clone(),
                seed_phrase: card.seed_phrase.clone(),
                seed_phrase_word_count: card.seed_phrase_word_count,
                custom_fields: card.custom_fields.clone(),
                folder_id: card.folder_id.clone(),
            },
        )
        .unwrap();
        assert!(updated);
    }

    pub(crate) fn create_bank_card(&self, title: &str, folder_id: Option<String>) -> BankCardItem {
        repo_impl::create_bank_card(
            &self.state,
            &self.profile_id,
            &CreateBankCardInput {
                folder_id,
                title: title.to_string(),
                bank_name: None,
                holder: None,
                number: None,
                expiry_mm_yy: None,
                cvc: None,
                note: None,
                tags: Vec::new(),
            },
        )
        .unwrap()
    }

    pub(crate) fn create_attachment(
        &self,
        datacard_id: &str,
        attachment_id: &str,
    ) -> AttachmentMeta {
        let meta = AttachmentMeta {
            id: attachment_id.to_string(),
            datacard_id: datacard_id.to_string(),
            file_name: format!("{attachment_id}.bin"),
            mime_type: Some("application/octet-stream".to_string()),
            byte_size: 4,
            created_at: "2026-03-28T00:00:00Z".to_string(),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
            deleted_at: None,
        };

        repo_impl::insert_attachment(&self.state, &self.profile_id, &meta).unwrap();
        fs::write(self.attachment_path(attachment_id), b"test").unwrap();
        meta
    }

    pub(crate) fn set_soft_delete_enabled(&self, enabled: bool) {
        let mut settings = UserSettings::default();
        settings.soft_delete_enabled = enabled;
        settings_service::update_settings(&self.storage_paths(), settings, &self.profile_id)
            .unwrap();
    }
}
