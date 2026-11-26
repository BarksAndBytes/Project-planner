//! Local storage for the app's data document.
//!
//! Standard library only, so it can be unit-tested without the Tauri
//! toolchain (`rustc --test src/storage.rs`).
//!
//! Writes are atomic: the new content goes to a temporary file, is flushed
//! to disk, and then renamed over the old file, so a crash or power loss
//! mid-save never leaves a half-written file. The previous version is kept
//! as `data.json.bak`.
//!
//! Phase 1 gap: the file is protected by the operating system's per-app
//! storage sandbox but is not yet encrypted at rest. Encryption with a key
//! held by Android Keystore / Windows Data Protection is the next step
//! (spec 6.1) and lands before the first release.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

pub const DATA_FILE: &str = "data.json";
pub const DEVICE_FILE: &str = "device-id";

/// Upper bound on the data document. Spec limits (2,000-character entries,
/// 120-character names) keep real data far below this.
pub const MAX_DATA_BYTES: usize = 64 * 1024 * 1024;

pub fn load(dir: &Path) -> io::Result<Option<String>> {
    read_limited(&dir.join(DATA_FILE), MAX_DATA_BYTES)
}

pub fn save(dir: &Path, json: &str) -> io::Result<()> {
    if json.len() > MAX_DATA_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "data is larger than the storage limit"));
    }
    if !json.starts_with('{') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "data must be a JSON object"));
    }
    write_atomic(dir, DATA_FILE, json.as_bytes(), true)
}

pub fn load_device_id(dir: &Path) -> io::Result<Option<String>> {
    Ok(read_limited(&dir.join(DEVICE_FILE), 64)?
        .map(|s| s.trim().to_string())
        .filter(|s| is_uuid(s)))
}

pub fn save_device_id(dir: &Path, id: &str) -> io::Result<()> {
    if !is_uuid(id) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "device id must be a UUID"));
    }
    if load_device_id(dir)?.is_some() {
        // A device keeps its identity for life; never overwrite it.
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "device id already set"));
    }
    write_atomic(dir, DEVICE_FILE, id.as_bytes(), false)
}

/// Lowercase or uppercase 8-4-4-4-12 hex.
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn read_limited(path: &Path, max: usize) -> io::Result<Option<String>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut buf = String::new();
    file.take(max as u64 + 1).read_to_string(&mut buf)?;
    if buf.len() > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "stored file is larger than the limit"));
    }
    Ok(Some(buf))
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8], keep_backup: bool) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let target = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    {
        let mut f = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if keep_backup && target.exists() {
        fs::copy(&target, dir.join(format!("{name}.bak")))?;
    }
    fs::rename(&tmp, &target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("wd-test-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_loads_as_none() {
        assert_eq!(load(&temp_dir("missing")).unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips_and_keeps_backup() {
        let dir = temp_dir("roundtrip");
        save(&dir, r#"{"a":1}"#).unwrap();
        save(&dir, r#"{"a":2}"#).unwrap();
        assert_eq!(load(&dir).unwrap().as_deref(), Some(r#"{"a":2}"#));
        assert_eq!(fs::read_to_string(dir.join("data.json.bak")).unwrap(), r#"{"a":1}"#);
        assert!(!dir.join("data.json.tmp").exists());
    }

    #[test]
    fn rejects_non_object_data() {
        assert!(save(&temp_dir("nonobj"), "[1,2]").is_err());
    }

    #[test]
    fn device_id_is_validated_and_never_overwritten() {
        let dir = temp_dir("device");
        assert!(save_device_id(&dir, "not-a-uuid").is_err());
        let id = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
        save_device_id(&dir, id).unwrap();
        assert_eq!(load_device_id(&dir).unwrap().as_deref(), Some(id));
        assert!(save_device_id(&dir, "11111111-2222-3333-4444-555555555555").is_err());
    }

    #[test]
    fn oversized_file_is_refused_on_load() {
        let dir = temp_dir("big");
        fs::write(dir.join(DEVICE_FILE), "x".repeat(100)).unwrap();
        assert!(load_device_id(&dir).is_err());
    }
}
