use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::Arc;

use chrono::Utc;

use crate::app_state::AppState;
use crate::data::profiles::paths::attachment_file_path;
use crate::data::sqlite::repo_impl;
use crate::error::{ErrorCodeString, Result};
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

    for folder_id in &subtree_ids {
        repo_impl::move_datacards_to_root(state, &profile_id, folder_id)?;
        repo_impl::move_bank_cards_to_root(state, &profile_id, folder_id)?;
    }

    for folder_id in subtree_ids.iter().rev() {
        repo_impl::purge_folder(state, &profile_id, folder_id)?;
    }
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
        for folder_id in &subtree_ids {
            let now = Utc::now().to_rfc3339();
            let datacard_ids =
                repo_impl::list_datacard_ids_in_folder(state, &profile_id, folder_id, false)?;

            for datacard_id in datacard_ids {
                repo_impl::soft_delete_attachments_by_datacard(
                    state,
                    &profile_id,
                    &datacard_id,
                    &now,
                )?;
            }
            repo_impl::soft_delete_datacards_in_folder(state, &profile_id, folder_id)?;
            repo_impl::soft_delete_bank_cards_in_folder(state, &profile_id, folder_id)?;
        }
    } else {
        for folder_id in &subtree_ids {
            let datacard_ids =
                repo_impl::list_datacard_ids_in_folder(state, &profile_id, folder_id, true)?;

            for datacard_id in datacard_ids {
                let attachments =
                    repo_impl::list_all_attachments_by_datacard(state, &profile_id, &datacard_id)?;

                for attachment in attachments {
                    let file_path =
                        attachment_file_path(&storage_paths, &profile_id, &attachment.id)?;
                    let _ = fs::remove_file(file_path);
                    if let Err(err) =
                        repo_impl::purge_attachment(state, &profile_id, &attachment.id)
                    {
                        if err.code != "ATTACHMENT_NOT_FOUND" {
                            return Err(err);
                        }
                    }
                }
            }
            repo_impl::purge_datacards_in_folder(state, &profile_id, folder_id)?;
            repo_impl::purge_bank_cards_in_folder(state, &profile_id, folder_id)?;
        }
    }

    for folder_id in subtree_ids.iter().rev() {
        repo_impl::purge_folder(state, &profile_id, folder_id)?;
    }
    security_service::request_persist_active_vault(state.clone());
    Ok(true)
}
