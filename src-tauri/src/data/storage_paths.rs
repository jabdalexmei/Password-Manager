use std::path::{Path, PathBuf};

use crate::error::{ErrorCodeString, Result};

#[derive(Debug, Clone)]
pub struct StoragePaths {
    app_dir: PathBuf,
    workspace_root: Option<PathBuf>,
    profiles_root: Option<PathBuf>,
}

impl StoragePaths {
    pub fn new_unconfigured() -> Result<Self> {
        let exe_path =
            std::env::current_exe().map_err(|_| ErrorCodeString::new("APP_DIR_UNAVAILABLE"))?;
        let app_dir = exe_path
            .parent()
            .ok_or_else(|| ErrorCodeString::new("APP_DIR_UNAVAILABLE"))?
            .to_path_buf();

        Ok(StoragePaths {
            app_dir,
            workspace_root: None,
            profiles_root: None,
        })
    }

    pub fn app_dir(&self) -> &Path {
        &self.app_dir
    }

    pub fn configure_workspace(&mut self, workspace_root: PathBuf) -> Result<()> {
        let profiles_root = workspace_root.join("Profiles");
        std::fs::create_dir_all(&profiles_root)
            .map_err(|_| ErrorCodeString::new("WORKSPACE_PROFILES_CREATE_FAILED"))?;

        let write_test = workspace_root.join(".pm-write-test.tmp");
        std::fs::write(&write_test, b"test")
            .map_err(|_| ErrorCodeString::new("WORKSPACE_NOT_WRITABLE"))?;
        let _ = std::fs::remove_file(&write_test);

        self.workspace_root = Some(workspace_root);
        self.profiles_root = Some(profiles_root);
        Ok(())
    }

    pub fn clear_workspace(&mut self) {
        self.workspace_root = None;
        self.profiles_root = None;
    }

    pub fn workspace_root(&self) -> Result<&PathBuf> {
        self.workspace_root
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("WORKSPACE_NOT_SELECTED"))
    }

    pub fn profiles_root(&self) -> Result<&PathBuf> {
        self.profiles_root
            .as_ref()
            .ok_or_else(|| ErrorCodeString::new("WORKSPACE_NOT_SELECTED"))
    }
}
