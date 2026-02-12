use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::data::fs::atomic_write::write_atomic;

use crate::error::{ErrorCodeString, Result};

const REGISTRY_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum WorkspacePathKind {
    RelativeToAppDir,
    Absolute,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspacePath {
    pub kind: WorkspacePathKind,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceRecord {
    pub id: String,
    pub display_name: String,
    pub path: WorkspacePath,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceRegistry {
    pub schema_version: u8,
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<WorkspaceRecord>,
}

impl Default for WorkspaceRegistry {
    fn default() -> Self {
        Self {
            schema_version: REGISTRY_SCHEMA_VERSION,
            active_workspace_id: None,
            workspaces: Vec::new(),
        }
    }
}

fn primary_registry_path(app_dir: &Path) -> PathBuf {
    app_dir.join("workspaces.json")
}

fn fallback_registry_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|dir| dir.join("Password Manager").join("workspaces.json"))
}

fn is_dir_writable(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    let test_path = dir.join(format!(".pm-registry-write-{}.tmp", Uuid::new_v4()));
    if std::fs::write(&test_path, b"test").is_err() {
        return false;
    }
    let _ = std::fs::remove_file(&test_path);
    true
}

fn registry_path_for_load(app_dir: &Path) -> PathBuf {
    let primary = primary_registry_path(app_dir);
    if primary.exists() {
        return primary;
    }
    if !is_dir_writable(app_dir) {
        if let Some(fallback) = fallback_registry_path() {
            if fallback.exists() {
                return fallback;
            }
        }
    }
    primary
}

fn registry_path_for_write(app_dir: &Path) -> Result<PathBuf> {
    if is_dir_writable(app_dir) {
        return Ok(primary_registry_path(app_dir));
    }
    let fallback = fallback_registry_path()
        .ok_or_else(|| ErrorCodeString::new("WORKSPACE_REGISTRY_WRITE_FAILED"))?;
    if let Some(parent) = fallback.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| ErrorCodeString::new("WORKSPACE_REGISTRY_WRITE_FAILED"))?;
    }
    Ok(fallback)
}

pub fn load_registry(app_dir: &Path) -> Result<WorkspaceRegistry> {
    let path = registry_path_for_load(app_dir);
    if !path.exists() {
        return Ok(WorkspaceRegistry::default());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_REGISTRY_READ_FAILED"))?;
    serde_json::from_str(&content)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_REGISTRY_READ_FAILED"))
}

pub fn save_registry(app_dir: &Path, registry: &WorkspaceRegistry) -> Result<()> {
    let path = registry_path_for_write(app_dir)?;
    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|_| ErrorCodeString::new("WORKSPACE_REGISTRY_WRITE_FAILED"))?;
    write_atomic(&path, serialized.as_bytes())
        .map_err(|_| ErrorCodeString::new("WORKSPACE_REGISTRY_WRITE_FAILED"))
}

pub fn resolve_workspace_path(app_dir: &Path, record: &WorkspaceRecord) -> PathBuf {
    match record.path.kind {
        WorkspacePathKind::RelativeToAppDir => app_dir.join(&record.path.value),
        WorkspacePathKind::Absolute => PathBuf::from(&record.path.value),
    }
}

pub fn encode_workspace_path(app_dir: &Path, workspace_root: &Path) -> WorkspacePath {
    if let Ok(relative) = workspace_root.strip_prefix(app_dir) {
        WorkspacePath {
            kind: WorkspacePathKind::RelativeToAppDir,
            value: relative.to_string_lossy().to_string(),
        }
    } else {
        WorkspacePath {
            kind: WorkspacePathKind::Absolute,
            value: workspace_root.to_string_lossy().to_string(),
        }
    }
}

pub fn display_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Workspace")
        .to_string()
}
