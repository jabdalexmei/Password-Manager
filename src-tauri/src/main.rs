#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(windows))]
compile_error!("This application is Windows-only.");


mod app_state;
mod commands;
mod data {
    pub mod fs {
        pub mod atomic_write;
    }
    pub mod storage_paths;
    pub mod workspaces {
        pub mod registry;
    }
    pub mod crypto {
        pub mod cipher;
        pub mod kdf;
        pub mod key_check;
        pub mod master_key;
    }
    pub mod profiles {
        pub mod paths;
        pub mod registry;
    }
    pub mod settings {
        pub mod config;
    }
    pub mod sqlite {
        pub mod diagnostics;
        pub mod init;
        pub mod migrations;
        pub mod repo_impl;
    }
}
mod error;
mod services {
    pub mod attachments_service;
    pub mod backup_service;
    pub mod bank_cards_service;
    pub mod clipboard_service;
    pub mod datacards_service;
    pub mod folders_service;
    pub mod password_history_service;
    pub mod profiles_service;
    pub mod security_service;
    pub mod settings_service;
    pub mod ui_prefs_service;
    pub mod vaults_service;
}
mod types;

use std::sync::Arc;

use app_state::AppState;
use commands::{
    attachments::*, backup::*, bank_cards::*, clipboard::*, datacards::*, folders::*,
    password_history::*, profiles::*, security::*, settings::*, ui_prefs::*, vaults::*,
    workspace::*,
};
use data::storage_paths::StoragePaths;
use services::security_service;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use windows::core::Interface;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                let app_state = window.state::<Arc<AppState>>().inner().clone();
                let _ = security_service::auto_lock_cleanup(&app_state);
            }
            _ => {}
        })
        .setup(|app| {
            let storage_paths = match StoragePaths::new_unconfigured() {
                Ok(paths) => paths,
                Err(err) => {
                    let message = match err.code.as_str() {
                        "APP_DIR_UNAVAILABLE" => {
                            "Unable to determine application directory for Password Manager."
                        }
                        _ => "Unable to initialize Password Manager workspace storage.",
                    };
                    app.dialog()
                        .message(message)
                        .title("Password Manager")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    std::process::exit(1);
                }
            };

            app.manage(Arc::new(AppState::new(storage_paths)));

            // Windows/WebView2: disable Chromium "Saved info" (form autofill suggestions)
            // because it breaks dark theme and can expose sensitive suggestions.
            // NOTE: HTML autocomplete="off" is not reliably respected by Chromium/WebView2.
            {
                if let Some(main_webview) = app.get_webview_window("main") {
                    let _ = main_webview.with_webview(|webview| unsafe {
                        let controller = webview.controller();
                        if let Ok(core) = controller.CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
                                    // Disable general autofill (emails/phones/names/etc) -> removes "Saved info"
                                    let _ = settings4.SetIsGeneralAutofillEnabled(false);
                                    // Disable password autosave prompts (optional but usually desired in a password manager UI)
                                    let _ = settings4.SetIsPasswordAutosaveEnabled(false);
                                }
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profiles_list,
            profile_create,
            profile_delete,
            profile_rename,
            profile_set_password,
            profile_change_password,
            profile_remove_password,
            get_active_profile,
            set_active_profile,
            login_vault,
            lock_vault,
            is_logged_in,
            health_check,
            list_attachments,
            attachments_pick_files,
            attachments_discard_pick,
            add_attachments_from_pick,
            add_attachments_via_dialog,
            remove_attachment,
            purge_attachment,
            get_attachment_bytes_base64,
            get_attachment_preview,
            save_attachment_via_dialog,
            backup_create,
            backup_create_via_dialog,
            backup_pick_file,
            backup_discard_pick,
            backup_restore_workflow_from_pick,
            backup_list,
            backup_create_if_due_auto,
            list_folders,
            list_vaults,
            create_vault,
            rename_vault,
            delete_vault,
            set_active_vault,
            create_folder,
            rename_folder,
            move_folder,
            delete_folder_only,
            delete_folder_and_cards,
            list_bank_cards_summary_command,
            list_deleted_bank_cards_summary_command,
            get_bank_card,
            create_bank_card,
            update_bank_card,
            set_bank_card_favorite,
            set_bankcard_archived,
            search_bank_cards,
            delete_bank_card,
            restore_bank_card,
            purge_bank_card,
            restore_all_deleted_bank_cards,
            purge_all_deleted_bank_cards,
            list_datacards,
            list_datacards_summary_command,
            get_datacard,
            create_datacard,
            update_datacard,
            set_datacard_favorite,
            set_datacard_archived,
            search_datacards,
            move_datacard_to_folder,
            delete_datacard,
            list_deleted_datacards,
            list_deleted_datacards_summary_command,
            restore_datacard,
            purge_datacard,
            restore_all_deleted_datacards,
            purge_all_deleted_datacards,
            get_datacard_password_history,
            clear_datacard_password_history,
            get_settings,
            update_settings,
            get_datacard_preview_fields,
            set_datacard_preview_fields,
            set_datacard_preview_fields_for_card,
            get_bankcard_preview_fields,
            set_bankcard_preview_fields,
            set_bankcard_preview_fields_for_card,
            get_datacard_core_hidden_fields,
            set_datacard_core_hidden_fields,
            get_bankcard_core_hidden_fields,
            set_bankcard_core_hidden_fields,
            workspace_list,
            workspace_select,
            workspace_create,
            workspace_create_via_dialog,
            workspace_create_default,
            workspace_remove,
            workspace_open_in_explorer,
            clipboard_clear_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
