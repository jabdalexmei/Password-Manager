use serde::{Deserialize, Serialize};

use crate::services::backup_service::BackupInspectResult;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    pub has_password: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentMeta {
    pub id: String,
    pub datacard_id: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub byte_size: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentPickFile {
    pub id: String,
    pub file_name: String,
    pub byte_size: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentPickPayload {
    pub token: String,
    pub files: Vec<AttachmentPickFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupPickPayload {
    pub token: String,
    pub file_name: String,
    pub byte_size: i64,
    pub inspect: BackupInspectResult,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentPreviewPayload {
    pub attachment_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub base64_data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfilesList {
    pub profiles: Vec<ProfileMeta>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum CustomFieldType {
    Text,
    Secret,
    Url,
    Number,
    Date,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomField {
    pub key: String,
    pub value: String,
    #[serde(rename = "type")]
    pub field_type: CustomFieldType,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataCard {
    pub id: String,
    pub folder_id: Option<String>,

    pub title: String,
    pub url: Option<String>,
    pub email: Option<String>,
    pub recovery_email: Option<String>,
    pub username: Option<String>,
    pub mobile_phone: Option<String>,
    pub note: Option<String>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub preview_fields: Vec<String>,

    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,

    pub password: Option<String>,
    pub totp_uri: Option<String>,
    pub seed_phrase: Option<String>,
    pub seed_phrase_word_count: Option<i32>,
    pub custom_fields: Vec<CustomField>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PasswordHistoryRow {
    pub id: String,
    pub datacard_id: String,
    pub password_value: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataCardSummary {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    pub email: Option<String>,
    pub recovery_email: Option<String>,
    pub username: Option<String>,
    pub mobile_phone: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub preview_fields: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,
    pub is_favorite: bool,
    pub has_totp: bool,
    pub has_seed_phrase: bool,
    pub has_phone: bool,
    pub has_note: bool,
    pub has_attachments: bool,

    // Needed for rendering per-card-only custom preview fields in the list view.
    // Without this, custom preview lines appear only after opening the card (details fetch).
    pub custom_fields: Vec<CustomField>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateFolderInput {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameFolderInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MoveFolderInput {
    pub id: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateDataCardInput {
    pub title: String,
    pub url: Option<String>,
    pub email: Option<String>,
    pub recovery_email: Option<String>,
    pub username: Option<String>,
    pub mobile_phone: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub password: Option<String>,
    pub totp_uri: Option<String>,
    pub seed_phrase: Option<String>,
    pub seed_phrase_word_count: Option<i32>,
    pub custom_fields: Vec<CustomField>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateDataCardInput {
    pub id: String,
    pub title: String,
    pub url: Option<String>,
    pub email: Option<String>,
    pub recovery_email: Option<String>,
    pub username: Option<String>,
    pub mobile_phone: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub password: Option<String>,
    pub totp_uri: Option<String>,
    pub seed_phrase: Option<String>,
    pub seed_phrase_word_count: Option<i32>,
    pub custom_fields: Vec<CustomField>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MoveDataCardInput {
    pub id: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetDataCardFavoriteInput {
    pub id: String,
    pub is_favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetDataCardArchivedInput {
    pub id: String,
    pub is_archived: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetBankCardArchivedInput {
    pub id: String,
    pub is_archived: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct BankCardItem {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub bank_name: Option<String>,
    pub holder: Option<String>,
    pub number: Option<String>,
    pub expiry_mm_yy: Option<String>,
    pub cvc: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub preview_fields: BankCardPreviewFields,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct BankCardPreviewFields {
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub card_number_mode: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct BankCardSummary {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub bank_name: Option<String>,
    pub holder: Option<String>,
    pub number: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub preview_fields: BankCardPreviewFields,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct CreateBankCardInput {
    pub folder_id: Option<String>,
    pub title: String,
    pub bank_name: Option<String>,
    pub holder: Option<String>,
    pub number: Option<String>,
    pub expiry_mm_yy: Option<String>,
    pub cvc: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct UpdateBankCardInput {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub bank_name: Option<String>,
    pub holder: Option<String>,
    pub number: Option<String>,
    pub expiry_mm_yy: Option<String>,
    pub cvc: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetBankCardFavoriteInput {
    pub id: String,
    pub is_favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserSettings {
    pub auto_hide_secret_timeout_seconds: i64,
    #[serde(default = "default_auto_lock_enabled")]
    pub auto_lock_enabled: bool,
    #[serde(default = "default_auto_lock_timeout_seconds")]
    pub auto_lock_timeout: i64,
    pub reveal_requires_confirmation: bool,

    #[serde(default = "default_clipboard_auto_clear_enabled")]
    pub clipboard_auto_clear_enabled: bool,
    #[serde(default = "default_clipboard_clear_timeout_seconds")]
    pub clipboard_clear_timeout_seconds: i64,

    pub soft_delete_enabled: bool,
    pub trash_retention_days: i64,

    pub backups_enabled: bool,
    #[serde(default = "default_auto_backup_interval_minutes")]
    pub auto_backup_interval_minutes: i64,
    #[serde(default = "default_backup_max_copies")]
    pub backup_max_copies: i64,
    pub backup_frequency: String,

    pub default_sort_field: String,
    pub default_sort_direction: String,

    pub mask_password_by_default: bool,

    #[serde(default = "default_multiply_vaults_enabled")]
    pub multiply_vaults_enabled: bool,
    #[serde(default = "default_active_vault_id")]
    pub active_vault_id: String,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            auto_hide_secret_timeout_seconds: 15,
            auto_lock_enabled: default_auto_lock_enabled(),
            auto_lock_timeout: default_auto_lock_timeout_seconds(),
            reveal_requires_confirmation: false,
            clipboard_auto_clear_enabled: default_clipboard_auto_clear_enabled(),
            clipboard_clear_timeout_seconds: default_clipboard_clear_timeout_seconds(),
            soft_delete_enabled: true,
            trash_retention_days: 30,
            backups_enabled: true,
            auto_backup_interval_minutes: default_auto_backup_interval_minutes(),
            backup_max_copies: default_backup_max_copies(),
            backup_frequency: "weekly".to_string(),
            default_sort_field: "updated_at".to_string(),
            default_sort_direction: "DESC".to_string(),
            mask_password_by_default: true,
            multiply_vaults_enabled: default_multiply_vaults_enabled(),
            active_vault_id: default_active_vault_id(),
        }
    }
}

fn default_auto_backup_interval_minutes() -> i64 {
    5
}

fn default_backup_max_copies() -> i64 {
    10
}

fn default_clipboard_auto_clear_enabled() -> bool {
    true
}

fn default_clipboard_clear_timeout_seconds() -> i64 {
    20
}

fn default_auto_lock_enabled() -> bool {
    true
}

fn default_auto_lock_timeout_seconds() -> i64 {
    60
}

fn default_multiply_vaults_enabled() -> bool {
    false
}

fn default_active_vault_id() -> String {
    "default".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceItem {
    pub id: String,
    pub display_name: String,
    pub path: String,
    pub exists: bool,
    pub valid: bool,
    pub is_active: bool,
}
