use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
use crate::services::attachment_file_cleanup::remove_attachment_files_best_effort;
use crate::services::security_service;
use crate::services::settings_service::get_settings;
use crate::types::{CreateFolderInput, Folder, MoveFolderInput, RenameFolderInput};

fn collect_folder_subtree_ids(root_id: &str, folders: &[Folder]) -> Vec<String> {
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    for folder in folders {
        if let Some(parent_id) = &folder.parent_id {
            children_by_parent
                .entry(parent_id.clone())
                .or_default()
                .push(folder.id.clone());
        }
    }

    let mut ids = Vec::new();
    let mut stack = vec![root_id.to_string()];
    let mut seen = HashSet::new();

    while let Some(folder_id) = stack.pop() {
        if !seen.insert(folder_id.clone()) {
            continue;
        }
        ids.push(folder_id.clone());
        if let Some(children) = children_by_parent.get(&folder_id) {
            for child_id in children {
                stack.push(child_id.clone());
            }
        }
    }

    ids
}

pub fn list_folders(state: &Arc<AppState>) -> Result<Vec<Folder>> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    repo_impl::list_folders(state, &profile_id)
}

pub fn create_folder(input: CreateFolderInput, state: &Arc<AppState>) -> Result<Folder> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ErrorCodeString::new("FOLDER_NAME_REQUIRED"));
    }
    let folder = repo_impl::create_folder(state, &profile_id, name, &input.parent_id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(folder)
}

pub fn rename_folder(input: RenameFolderInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ErrorCodeString::new("FOLDER_NAME_REQUIRED"));
    }
    let renamed = repo_impl::rename_folder(state, &profile_id, &input.id, name)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(renamed)
}

pub fn move_folder(input: MoveFolderInput, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let moved = repo_impl::move_folder(state, &profile_id, &input.id, &input.parent_id)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(moved)
}

pub fn delete_folder_only(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder = repo_impl::get_folder(state, &profile_id, &id)?;
    if folder.is_system {
        return Err(ErrorCodeString::new("FOLDER_IS_SYSTEM"));
    }

    let all_folders = repo_impl::list_folders(state, &profile_id)?;
    let subtree_ids = collect_folder_subtree_ids(&id, &all_folders);
    let subtree_set: HashSet<String> = subtree_ids.iter().cloned().collect();
    if all_folders
        .iter()
        .any(|item| subtree_set.contains(&item.id) && item.is_system)
    {
        return Err(ErrorCodeString::new("FOLDER_IS_SYSTEM"));
    }
    repo_impl::delete_folder_subtree_only_atomic(state, &profile_id, &subtree_ids)?;
    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

pub fn delete_folder_and_cards(id: String, state: &Arc<AppState>) -> Result<bool> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let folder = repo_impl::get_folder(state, &profile_id, &id)?;
    if folder.is_system {
        return Err(ErrorCodeString::new("FOLDER_IS_SYSTEM"));
    }
    let all_folders = repo_impl::list_folders(state, &profile_id)?;
    let subtree_ids = collect_folder_subtree_ids(&id, &all_folders);
    let subtree_set: HashSet<String> = subtree_ids.iter().cloned().collect();
    if all_folders
        .iter()
        .any(|item| subtree_set.contains(&item.id) && item.is_system)
    {
        return Err(ErrorCodeString::new("FOLDER_IS_SYSTEM"));
    }

    let storage_paths = state.get_storage_paths()?;
    let settings = get_settings(&storage_paths, &profile_id)?;

    if settings.soft_delete_enabled {
        repo_impl::soft_delete_folder_subtree_and_detach_cards(state, &profile_id, &subtree_ids)?;
    } else {
        let attachment_ids =
            repo_impl::purge_folder_subtree_and_collect_attachment_ids(state, &profile_id, &subtree_ids)?;
        remove_attachment_files_best_effort(&storage_paths, &profile_id, &attachment_ids);
        security_service::request_persist_active_vault(state.clone());
        return Ok(true);
    }
    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::data::sqlite::repo_impl;
    use crate::services::{bank_cards_service, datacards_service, test_support::ServiceTestHarness};

    #[test]
    fn delete_folder_only_moves_cards_to_root_and_removes_subtree() {
        let harness = ServiceTestHarness::new();
        let root = harness.create_folder("Root", None);
        let child = harness.create_folder("Child", Some(root.id.clone()));
        let card = harness.create_datacard("Card", Some(child.id.clone()), None);
        let bank_card = harness.create_bank_card("Bank", Some(child.id.clone()));

        let deleted = delete_folder_only(root.id.clone(), &harness.state).unwrap();

        assert!(deleted);
        let moved_card = repo_impl::get_datacard(&harness.state, &harness.profile_id, &card.id).unwrap();
        let moved_bank_card =
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &bank_card.id).unwrap();
        assert_eq!(moved_card.folder_id, None);
        assert_eq!(moved_bank_card.folder_id, None);
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &root.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &child.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );
    }

    #[test]
    fn delete_folder_and_cards_purges_subtree_and_keeps_outside_data() {
        let harness = ServiceTestHarness::new();
        harness.set_soft_delete_enabled(false);

        let subtree_root = harness.create_folder("Projects", None);
        let subtree_child = harness.create_folder("Secrets", Some(subtree_root.id.clone()));
        let outside_folder = harness.create_folder("Outside", None);

        let subtree_card = harness.create_datacard("Subtree", Some(subtree_child.id.clone()), None);
        let outside_card = harness.create_datacard("Outside", Some(outside_folder.id.clone()), None);
        let subtree_bank = harness.create_bank_card("Subtree bank", Some(subtree_root.id.clone()));
        let outside_bank = harness.create_bank_card("Outside bank", Some(outside_folder.id.clone()));

        let subtree_attachment = harness.create_attachment(&subtree_card.id, "subtree-attachment");
        let outside_attachment = harness.create_attachment(&outside_card.id, "outside-attachment");
        let subtree_attachment_path = harness.attachment_path(&subtree_attachment.id);
        let outside_attachment_path = harness.attachment_path(&outside_attachment.id);

        let deleted = delete_folder_and_cards(subtree_root.id.clone(), &harness.state).unwrap();

        assert!(deleted);
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &subtree_root.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &subtree_child.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );
        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &subtree_card.id)
                .unwrap_err()
                .code,
            "DATACARD_NOT_FOUND"
        );
        assert_eq!(
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &subtree_bank.id)
                .unwrap_err()
                .code,
            "BANK_CARD_NOT_FOUND"
        );
        assert!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &subtree_attachment.id)
                .unwrap()
                .is_none()
        );
        assert!(!subtree_attachment_path.exists());

        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &outside_card.id)
                .unwrap()
                .folder_id,
            Some(outside_folder.id.clone())
        );
        assert_eq!(
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &outside_bank.id)
                .unwrap()
                .folder_id,
            Some(outside_folder.id.clone())
        );
        assert!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &outside_attachment.id)
                .unwrap()
                .is_some()
        );
        assert!(outside_attachment_path.exists());
    }

    #[test]
    fn delete_folder_and_cards_soft_deletes_subtree_detaches_cards_and_keeps_blobs() {
        let harness = ServiceTestHarness::new();
        harness.set_soft_delete_enabled(true);

        let subtree_root = harness.create_folder("Projects", None);
        let subtree_child = harness.create_folder("Secrets", Some(subtree_root.id.clone()));
        let outside_folder = harness.create_folder("Outside", None);

        let subtree_card = harness.create_datacard("Subtree", Some(subtree_child.id.clone()), None);
        let outside_card = harness.create_datacard("Outside", Some(outside_folder.id.clone()), None);
        let subtree_bank = harness.create_bank_card("Subtree bank", Some(subtree_root.id.clone()));
        let outside_bank = harness.create_bank_card("Outside bank", Some(outside_folder.id.clone()));

        let subtree_attachment = harness.create_attachment(&subtree_card.id, "subtree-attachment");
        let outside_attachment = harness.create_attachment(&outside_card.id, "outside-attachment");
        let subtree_attachment_path = harness.attachment_path(&subtree_attachment.id);
        let outside_attachment_path = harness.attachment_path(&outside_attachment.id);

        let deleted = delete_folder_and_cards(subtree_root.id.clone(), &harness.state).unwrap();

        assert!(deleted);
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &subtree_root.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );
        assert_eq!(
            repo_impl::get_folder(&harness.state, &harness.profile_id, &subtree_child.id)
                .unwrap_err()
                .code,
            "FOLDER_NOT_FOUND"
        );

        let deleted_card =
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &subtree_card.id).unwrap();
        let deleted_bank =
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &subtree_bank.id).unwrap();
        let deleted_attachment = repo_impl::get_attachment(
            &harness.state,
            &harness.profile_id,
            &subtree_attachment.id,
        )
        .unwrap()
        .unwrap();

        assert!(deleted_card.deleted_at.is_some());
        assert_eq!(deleted_card.folder_id, None);
        assert!(deleted_bank.deleted_at.is_some());
        assert_eq!(deleted_bank.folder_id, None);
        assert!(deleted_attachment.deleted_at.is_some());
        assert!(subtree_attachment_path.exists());

        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &outside_card.id)
                .unwrap()
                .folder_id,
            Some(outside_folder.id.clone())
        );
        assert_eq!(
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &outside_card.id)
                .unwrap()
                .deleted_at,
            None
        );
        assert_eq!(
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &outside_bank.id)
                .unwrap()
                .folder_id,
            Some(outside_folder.id.clone())
        );
        assert_eq!(
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &outside_bank.id)
                .unwrap()
                .deleted_at,
            None
        );
        assert_eq!(
            repo_impl::get_attachment(&harness.state, &harness.profile_id, &outside_attachment.id)
                .unwrap()
                .unwrap()
                .deleted_at,
            None
        );
        assert!(outside_attachment_path.exists());
    }

    #[test]
    fn delete_folder_and_cards_soft_delete_allows_restore_to_root() {
        let harness = ServiceTestHarness::new();
        harness.set_soft_delete_enabled(true);

        let subtree_root = harness.create_folder("Projects", None);
        let subtree_child = harness.create_folder("Secrets", Some(subtree_root.id.clone()));

        let subtree_card = harness.create_datacard("Subtree", Some(subtree_child.id.clone()), None);
        let subtree_bank = harness.create_bank_card("Subtree bank", Some(subtree_root.id.clone()));
        let subtree_attachment = harness.create_attachment(&subtree_card.id, "subtree-attachment");
        let subtree_attachment_path = harness.attachment_path(&subtree_attachment.id);

        let deleted = delete_folder_and_cards(subtree_root.id.clone(), &harness.state).unwrap();
        assert!(deleted);

        datacards_service::restore_datacard(subtree_card.id.clone(), &harness.state).unwrap();
        bank_cards_service::restore_bank_card(subtree_bank.id.clone(), &harness.state).unwrap();

        let restored_card =
            repo_impl::get_datacard(&harness.state, &harness.profile_id, &subtree_card.id).unwrap();
        let restored_bank =
            repo_impl::get_bank_card(&harness.state, &harness.profile_id, &subtree_bank.id).unwrap();
        let restored_attachment = repo_impl::get_attachment(
            &harness.state,
            &harness.profile_id,
            &subtree_attachment.id,
        )
        .unwrap()
        .unwrap();

        assert_eq!(restored_card.deleted_at, None);
        assert_eq!(restored_card.folder_id, None);
        assert_eq!(restored_bank.deleted_at, None);
        assert_eq!(restored_bank.folder_id, None);
        assert_eq!(restored_attachment.deleted_at, None);
        assert!(subtree_attachment_path.exists());
    }
}
