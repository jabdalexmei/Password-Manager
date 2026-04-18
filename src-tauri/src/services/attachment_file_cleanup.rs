use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::PathBuf;

use crate::data::profiles::paths::attachment_file_path;
use crate::data::storage_paths::StoragePaths;

pub(crate) fn remove_attachment_files_best_effort(
    storage_paths: &StoragePaths,
    profile_id: &str,
    attachment_ids: &[String],
) {
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for attachment_id in attachment_ids {
        let file_path = match attachment_file_path(storage_paths, profile_id, attachment_id) {
            Ok(path) => path,
            Err(err) => {
                log::warn!(
                    "[ATTACHMENT][cleanup] skip_invalid_path profile_id={} attachment_id={} code={}",
                    profile_id,
                    attachment_id,
                    err.code
                );
                continue;
            }
        };

        if !seen.insert(file_path.clone()) {
            continue;
        }

        if let Err(err) = std::fs::remove_file(&file_path) {
            if err.kind() != ErrorKind::NotFound {
                log::warn!(
                    "[ATTACHMENT][cleanup] remove_failed profile_id={} attachment_id={} path={:?} err={}",
                    profile_id,
                    attachment_id,
                    file_path,
                    err
                );
            }
        }
    }
}
