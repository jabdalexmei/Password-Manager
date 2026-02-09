use std::ptr;
use std::time::Duration;

use windows_sys::Win32::Foundation::GetLastError;
use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};

struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

/// Clears the entire Windows clipboard (all formats).
/// Uses OpenClipboard -> EmptyClipboard -> CloseClipboard.
/// Retries because clipboard may be temporarily locked by other processes.
pub fn clear_clipboard_all() -> Result<(), String> {
    const ATTEMPTS: usize = 60;
    const SLEEP_MS: u64 = 25;

    for attempt in 0..ATTEMPTS {
        unsafe {
            let opened = OpenClipboard(ptr::null_mut());
            if opened == 0 {
                if attempt + 1 < ATTEMPTS {
                    std::thread::sleep(Duration::from_millis(SLEEP_MS));
                    continue;
                }
                let err = GetLastError();
                return Err(format!("OPENCLIPBOARD_FAILED ({})", err));
            }

            // Ensure CloseClipboard is called no matter what
            let _guard = ClipboardGuard;

            let emptied = EmptyClipboard();
            if emptied == 0 {
                let err = GetLastError();
                return Err(format!("EMPTYCLIPBOARD_FAILED ({})", err));
            }

            return Ok(());
        }
    }

    Err("CLIPBOARD_BUSY".to_string())
}
