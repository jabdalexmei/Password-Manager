use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

fn replace_platform(from: &Path, to: &Path) -> io::Result<()> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_w: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let to_w: Vec<u16> = to
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();

    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;
    let ok = unsafe { MoveFileExW(from_w.as_ptr(), to_w.as_ptr(), flags) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn best_effort_fsync_parent_dir(_path: &Path) {
    // Windows-only build: directory fsync semantics differ; file sync_all + MoveFileExW(WRITE_THROUGH) is best-effort.
    let _ = _path;
}

/// Atomic file write:
/// - write to temp in same directory
/// - fsync temp
/// - atomically replace target with temp
/// - best-effort fsync parent dir (no-op on Windows-only build)
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    fn replace_with_retry(from: &Path, to: &Path) -> io::Result<()> {
        let mut last: Option<io::Error> = None;
        // Windows often gives PermissionDenied if the file is still open (SQLite/AV/indexer).
        // Do short retries.
        for _ in 0..25 {
            match replace_platform(from, to) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last = Some(e);
                    let kind = last.as_ref().unwrap().kind();
                    if kind != io::ErrorKind::PermissionDenied && kind != io::ErrorKind::Other {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
            }
        }
        Err(last.unwrap_or_else(|| io::Error::new(io::ErrorKind::Other, "replace failed")))
    }

    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "write_atomic: path has no parent")
    })?;
    fs::create_dir_all(parent)?;

    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");

    let tmp_path = parent.join(format!(".{}.tmp.{}", file_name, Uuid::new_v4()));

    let result: io::Result<()> = (|| {
        // 1) write temp
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        let mut f = opts.open(&tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);

        // 2) atomically replace target
        replace_with_retry(&tmp_path, path)?;
        best_effort_fsync_parent_dir(path);

        Ok(())
    })();

    // Best-effort cleanup
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }

    result
}
