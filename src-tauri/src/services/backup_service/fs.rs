use super::*;

pub(super) fn replace_file_windows(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let src_w: Vec<u16> = src.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let dst_w: Vec<u16> = dst.as_os_str().encode_wide().chain(iter::once(0)).collect();

    let ok = unsafe {
        MoveFileExW(
            src_w.as_ptr(),
            dst_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub(super) fn best_effort_fsync_rename_dirs(_src: &Path, _dst: &Path) {
    // Windows-only build: directory fsync is not portable; keep best-effort hook as no-op.
    let _ = (_src, _dst);
}

fn rename_platform(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let src_w: Vec<u16> = src.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let dst_w: Vec<u16> = dst.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let ok = unsafe { MoveFileExW(src_w.as_ptr(), dst_w.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn is_transient_windows_fs_error(e: &std::io::Error) -> bool {
    // Windows can report file-in-use scenarios either as PermissionDenied or as raw OS errors.
    // Retrying helps when antivirus/indexer/Explorer briefly holds the file.
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        return true;
    }
    match e.raw_os_error() {
        Some(5) | Some(32) | Some(33) => true, // ACCESS_DENIED / SHARING_VIOLATION / LOCK_VIOLATION
        _ => false,
    }
}

pub(super) fn map_restore_io_error(
    step: &'static str,
    a: Option<&Path>,
    b: Option<&Path>,
    e: std::io::Error,
) -> ErrorCodeString {
    let os = e.raw_os_error();
    log::error!(
        "[BACKUP][restore] io_error step={} a={:?} b={:?} kind={:?} os={:?} err={}",
        step,
        a,
        b,
        e.kind(),
        os,
        e
    );

    if is_transient_windows_fs_error(&e) {
        return ErrorCodeString::new("BACKUP_RESTORE_FILE_IN_USE");
    }

    if e.kind() == std::io::ErrorKind::PermissionDenied {
        return ErrorCodeString::new("BACKUP_RESTORE_ACCESS_DENIED");
    }

    match os {
        Some(206) => ErrorCodeString::new("BACKUP_RESTORE_PATH_TOO_LONG"), // ERROR_FILENAME_EXCED_RANGE
        Some(112) => ErrorCodeString::new("BACKUP_RESTORE_DISK_FULL"),     // ERROR_DISK_FULL
        _ => ErrorCodeString::new("BACKUP_RESTORE_FAILED"),
    }
}

pub(super) fn prepare_empty_dir_for_restore(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    fs::create_dir_all(path)
}

pub(super) fn rename_with_retry(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::time::Duration;

    const ATTEMPTS: usize = 200;
    const SLEEP_MS: u64 = 50;

    let mut last_err: Option<std::io::Error> = None;
    for _ in 0..ATTEMPTS {
        match rename_platform(src, dst) {
            Ok(()) => {
                best_effort_fsync_rename_dirs(src, dst);
                return Ok(());
            }
            Err(e) => {
                if is_transient_windows_fs_error(&e) {
                    last_err = Some(e);
                    std::thread::sleep(Duration::from_millis(SLEEP_MS));
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "rename failed")))
}
