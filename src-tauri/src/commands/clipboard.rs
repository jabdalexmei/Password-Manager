use crate::services::clipboard_service;

#[tauri::command]
pub fn clipboard_clear_all() -> Result<(), String> {
    clipboard_service::clear_clipboard_all()
}
