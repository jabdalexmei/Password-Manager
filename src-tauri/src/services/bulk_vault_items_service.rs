use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use serde::Serialize;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachment_file_cleanup::remove_attachment_files_best_effort;
use crate::services::security_service;
use crate::services::settings_service::get_settings;
use crate::types::{
    AttachmentMeta, BankCardItem, BulkVaultItemRef, BulkVaultItemsInput, BulkVaultItemsResult,
    CustomField, DataCard,
};

fn dedupe_items(items: Vec<BulkVaultItemRef>) -> Vec<BulkVaultItemRef> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if item.id.trim().is_empty() {
            continue;
        }
        if seen.insert((item.item_type.clone(), item.id.clone())) {
            out.push(item);
        }
    }
    out
}

pub fn bulk_apply_vault_items(
    mut input: BulkVaultItemsInput,
    state: &Arc<AppState>,
) -> Result<BulkVaultItemsResult> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    input.items = dedupe_items(input.items);

    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;
    let outcome =
        repo_impl::bulk_apply_vault_items(state, &profile_id, &input, settings.soft_delete_enabled)?;

    if !outcome.purged_attachment_ids.is_empty() {
        remove_attachment_files_best_effort(
            &storage_paths,
            &profile_id,
            &outcome.purged_attachment_ids,
        );
    }

    if outcome.processed_count > 0 {
        security_service::request_persist_active_vault(state.clone());
    }

    Ok(BulkVaultItemsResult {
        processed_count: outcome.processed_count,
    })
}

#[derive(Debug, Serialize)]
struct ExportFolder {
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct ExportPayload {
    schema_version: u32,
    exported_at: String,
    items: Vec<ExportItem>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ExportItem {
    DataCard {
        id: String,
        title: String,
        folder: Option<ExportFolder>,
        created_at: String,
        updated_at: String,
        archived_at: Option<String>,
        deleted_at: Option<String>,
        url: Option<String>,
        email: Option<String>,
        recovery_email: Option<String>,
        username: Option<String>,
        mobile_phone: Option<String>,
        password: Option<String>,
        totp_uri: Option<String>,
        seed_phrase: Option<String>,
        seed_phrase_word_count: Option<i32>,
        note: Option<String>,
        tags: Vec<String>,
        custom_fields: Vec<CustomField>,
        attachments: Vec<AttachmentMeta>,
    },
    BankCard {
        id: String,
        title: String,
        folder: Option<ExportFolder>,
        created_at: String,
        updated_at: String,
        archived_at: Option<String>,
        deleted_at: Option<String>,
        bank_name: Option<String>,
        holder: Option<String>,
        number: Option<String>,
        expiry_mm_yy: Option<String>,
        cvc: Option<String>,
        note: Option<String>,
        tags: Vec<String>,
    },
}

fn export_folder(
    folder_id: Option<String>,
    folder_names_by_id: &std::collections::HashMap<String, String>,
) -> Option<ExportFolder> {
    let id = folder_id?;
    Some(ExportFolder {
        name: folder_names_by_id.get(&id).cloned().unwrap_or_default(),
        id,
    })
}

fn data_card_export_item(
    card: DataCard,
    folder_names_by_id: &std::collections::HashMap<String, String>,
) -> ExportItem {
    ExportItem::DataCard {
        id: card.id,
        title: card.title,
        folder: export_folder(card.folder_id, folder_names_by_id),
        created_at: card.created_at,
        updated_at: card.updated_at,
        archived_at: card.archived_at,
        deleted_at: card.deleted_at,
        url: card.url,
        email: card.email,
        recovery_email: card.recovery_email,
        username: card.username,
        mobile_phone: card.mobile_phone,
        password: card.password,
        totp_uri: card.totp_uri,
        seed_phrase: card.seed_phrase,
        seed_phrase_word_count: card.seed_phrase_word_count,
        note: card.note,
        tags: card.tags,
        custom_fields: card.custom_fields,
        attachments: card.attachments,
    }
}

fn bank_card_export_item(
    card: BankCardItem,
    folder_names_by_id: &std::collections::HashMap<String, String>,
) -> ExportItem {
    ExportItem::BankCard {
        id: card.id,
        title: card.title,
        folder: export_folder(card.folder_id, folder_names_by_id),
        created_at: card.created_at,
        updated_at: card.updated_at,
        archived_at: card.archived_at,
        deleted_at: card.deleted_at,
        bank_name: card.bank_name,
        holder: card.holder,
        number: card.number,
        expiry_mm_yy: card.expiry_mm_yy,
        cvc: card.cvc,
        note: card.note,
        tags: card.tags,
    }
}

pub fn export_selected_vault_items_json(
    path: &Path,
    mut input: BulkVaultItemsInput,
    state: &Arc<AppState>,
) -> Result<String> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    input.items = dedupe_items(input.items);
    if input.items.is_empty() {
        return Err(ErrorCodeString::new("VALIDATION_ERROR"));
    }

    let (data_cards, bank_cards, folder_names_by_id) =
        repo_impl::list_selected_vault_items_for_export(state, &profile_id, &input.items)?;

    let mut items = Vec::with_capacity(data_cards.len() + bank_cards.len());
    for card in data_cards {
        items.push(data_card_export_item(card, &folder_names_by_id));
    }
    for card in bank_cards {
        items.push(bank_card_export_item(card, &folder_names_by_id));
    }

    let payload = ExportPayload {
        schema_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        items,
    };

    let content = serde_json::to_string_pretty(&payload)
        .map_err(|_| ErrorCodeString::new("EXPORT_SELECTED_JSON_FAILED"))?;
    std::fs::write(path, content)
        .map_err(|_| ErrorCodeString::new("EXPORT_SELECTED_JSON_FAILED"))?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BulkVaultAction, BulkVaultItemType};
    use tempfile::tempdir;

    fn item(item_type: BulkVaultItemType, id: String) -> BulkVaultItemRef {
        BulkVaultItemRef { item_type, id }
    }

    #[test]
    fn bulk_move_mixed_items_to_folder_and_root() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        let folder = harness.create_folder("Work", None);
        let card = harness.create_datacard("Login", None, None);
        let bank = harness.create_bank_card("Visa", None);

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: vec![
                    item(BulkVaultItemType::DataCard, card.id.clone()),
                    item(BulkVaultItemType::BankCard, bank.id.clone()),
                ],
                action: BulkVaultAction::MoveToFolder {
                    folder_id: Some(folder.id.clone()),
                },
            },
            &harness.state,
        )
        .unwrap();

        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
                .unwrap()
                .folder_id,
            Some(folder.id.clone())
        );
        assert_eq!(
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &bank.id)
                .unwrap()
                .folder_id,
            Some(folder.id)
        );

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: vec![item(BulkVaultItemType::DataCard, card.id.clone())],
                action: BulkVaultAction::MoveToFolder { folder_id: None },
            },
            &harness.state,
        )
        .unwrap();
        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
                .unwrap()
                .folder_id,
            None
        );
    }

    #[test]
    fn bulk_rolls_back_on_invalid_id() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        let card = harness.create_datacard("Login", None, None);

        let result = bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: vec![
                    item(BulkVaultItemType::DataCard, card.id.clone()),
                    item(BulkVaultItemType::DataCard, "missing".to_string()),
                ],
                action: BulkVaultAction::SetFavorite { is_favorite: true },
            },
            &harness.state,
        );

        assert!(result.is_err());
        assert!(!repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
            .unwrap()
            .is_favorite);
    }

    #[test]
    fn bulk_archive_and_favorite_mixed_items() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        let card = harness.create_datacard("Login", None, None);
        let bank = harness.create_bank_card("Visa", None);
        let items = vec![
            item(BulkVaultItemType::DataCard, card.id.clone()),
            item(BulkVaultItemType::BankCard, bank.id.clone()),
        ];

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: items.clone(),
                action: BulkVaultAction::SetArchived { is_archived: true },
            },
            &harness.state,
        )
        .unwrap();
        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: items.clone(),
                action: BulkVaultAction::SetFavorite { is_favorite: true },
            },
            &harness.state,
        )
        .unwrap();

        let card = repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id).unwrap();
        let bank = repo_impl::get_bank_card(&harness.state, &harness.profile_id, &bank.id).unwrap();
        assert!(card.archived_at.is_some());
        assert!(bank.archived_at.is_some());
        assert!(card.is_favorite);
        assert!(bank.is_favorite);
    }

    #[test]
    fn bulk_delete_restore_and_purge_require_deleted_items() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        harness.set_soft_delete_enabled(true);
        let card = harness.create_datacard("Login", None, None);
        let bank = harness.create_bank_card("Visa", None);
        let items = vec![
            item(BulkVaultItemType::DataCard, card.id.clone()),
            item(BulkVaultItemType::BankCard, bank.id.clone()),
        ];

        let invalid_restore = bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: items.clone(),
                action: BulkVaultAction::Restore,
            },
            &harness.state,
        );
        assert!(invalid_restore.is_err());

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: items.clone(),
                action: BulkVaultAction::Delete,
            },
            &harness.state,
        )
        .unwrap();
        assert!(repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
            .unwrap()
            .deleted_at
            .is_some());
        assert!(repo_impl::get_bank_card(&harness.state, &harness.profile_id, &bank.id)
            .unwrap()
            .deleted_at
            .is_some());

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: items.clone(),
                action: BulkVaultAction::Restore,
            },
            &harness.state,
        )
        .unwrap();
        assert!(repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id)
            .unwrap()
            .deleted_at
            .is_none());

        let invalid_purge = bulk_apply_vault_items(
            BulkVaultItemsInput {
                items,
                action: BulkVaultAction::Purge,
            },
            &harness.state,
        );
        assert!(invalid_purge.is_err());
    }

    #[test]
    fn bulk_hard_delete_purges_datacard_attachments() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        harness.set_soft_delete_enabled(false);
        let card = harness.create_datacard("Login", None, None);
        let attachment = harness.create_attachment(&card.id, "attachment-1");
        let attachment_path = harness.attachment_path(&attachment.id);

        bulk_apply_vault_items(
            BulkVaultItemsInput {
                items: vec![item(BulkVaultItemType::DataCard, card.id.clone())],
                action: BulkVaultAction::Delete,
            },
            &harness.state,
        )
        .unwrap();

        assert!(repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id).is_err());
        assert!(!attachment_path.exists());
    }

    #[test]
    fn export_json_includes_only_selected_mixed_items() {
        let harness = crate::services::test_support::ServiceTestHarness::new();
        let card = harness.create_datacard("Login", None, Some("secret".to_string()));
        let bank = harness.create_bank_card("Visa", None);
        let _other = harness.create_datacard("Other", None, None);
        let temp = tempdir().unwrap();
        let path = temp.path().join("selected.json");

        export_selected_vault_items_json(
            &path,
            BulkVaultItemsInput {
                items: vec![
                    item(BulkVaultItemType::DataCard, card.id),
                    item(BulkVaultItemType::BankCard, bank.id),
                ],
                action: BulkVaultAction::Delete,
            },
            &harness.state,
        )
        .unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(value["items"].as_array().unwrap().len(), 2);
    }
}
