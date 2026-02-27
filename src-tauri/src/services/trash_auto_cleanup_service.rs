use std::sync::Arc;

use chrono::{Duration, Utc};

use crate::app_state::AppState;
use crate::data::sqlite::repo_impl;
use crate::error::Result;
use crate::services::bank_cards_service;
use crate::services::datacards_service;
use crate::services::security_service;
use crate::services::settings_service;
use crate::types::TrashCleanupResult;

const MIN_TRASH_RETENTION_DAYS: i64 = 1;
const MAX_TRASH_RETENTION_DAYS: i64 = 3_650;

fn empty_result(enabled: bool) -> TrashCleanupResult {
    TrashCleanupResult {
        enabled,
        purged_datacards: 0,
        purged_bank_cards: 0,
    }
}

pub fn run_trash_auto_cleanup_if_enabled(state: &Arc<AppState>) -> Result<TrashCleanupResult> {
    let profile_id = security_service::require_unlocked_active_profile(state)?.profile_id;
    let storage_paths = state.get_storage_paths()?;
    let settings = settings_service::get_settings(&storage_paths, &profile_id)?;

    if !settings.trash_auto_cleanup_enabled {
        return Ok(empty_result(false));
    }

    if !settings.soft_delete_enabled {
        return Ok(empty_result(true));
    }

    if !(MIN_TRASH_RETENTION_DAYS..=MAX_TRASH_RETENTION_DAYS)
        .contains(&settings.trash_retention_days)
    {
        log::warn!(
            "[TRASH_AUTO_CLEANUP] skip due to invalid trash_retention_days={}",
            settings.trash_retention_days
        );
        return Ok(empty_result(true));
    }

    let cutoff = Utc::now() - Duration::days(settings.trash_retention_days);
    let cutoff_rfc3339 = cutoff.to_rfc3339();

    let datacard_ids =
        repo_impl::list_deleted_datacard_ids_older_than(state, &profile_id, &cutoff_rfc3339)?;
    let bank_card_ids =
        repo_impl::list_deleted_bank_card_ids_older_than(state, &profile_id, &cutoff_rfc3339)?;

    let mut purged_datacards = 0usize;
    for id in datacard_ids {
        match datacards_service::purge_datacard_by_profile_with_attachments(state, &profile_id, &id)
        {
            Ok(purged) => {
                if purged {
                    purged_datacards += 1;
                }
            }
            Err(err) => {
                log::warn!(
                    "[TRASH_AUTO_CLEANUP] datacard_purge_failed id={} code={}",
                    id,
                    err.code
                );
            }
        }
    }

    let mut purged_bank_cards = 0usize;
    for id in bank_card_ids {
        match bank_cards_service::purge_bank_card_by_profile(state, &profile_id, &id) {
            Ok(purged) => {
                if purged {
                    purged_bank_cards += 1;
                }
            }
            Err(err) => {
                log::warn!(
                    "[TRASH_AUTO_CLEANUP] bank_card_purge_failed id={} code={}",
                    id,
                    err.code
                );
            }
        }
    }

    if purged_datacards > 0 || purged_bank_cards > 0 {
        security_service::request_persist_active_vault(state.clone());
    }

    Ok(TrashCleanupResult {
        enabled: true,
        purged_datacards,
        purged_bank_cards,
    })
}
