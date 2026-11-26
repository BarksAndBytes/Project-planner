//! Writing exported files (Word summaries, CSV, backups).
//! Windows: saved to the user's Downloads folder. Android: written to the
//! app's private cache/exports folder and handed to the share sheet.
//! Standard library only; unit-tested with `rustc --test src/exports.rs`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

/// Keeps letters, digits, spaces and . _ - ( ); no folders, no leading dots.
pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    let limited: String = trimmed.chars().take(120).collect();
    if limited.is_empty() { "export".to_string() } else { limited }
}

/// `name`, or `name (2)`, `name (3)`… if a file already exists.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

pub fn write_export(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "export is too large"));
    }
    fs::create_dir_all(dir)?;
    let path = unique_path(dir, &sanitize_filename(name));
    fs::write(&path, bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_are_sanitized() {
        assert_eq!(sanitize_filename("Work Summary - Q4 2026.docx"), "Work Summary - Q4 2026.docx");
        assert_eq!(sanitize_filename("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_filename("..hidden"), "hidden");
        assert_eq!(sanitize_filename("a:b*c?.csv"), "a_b_c_.csv");
        assert_eq!(sanitize_filename(""), "export");
    }

    #[test]
    fn existing_files_are_never_overwritten() {
        let dir = std::env::temp_dir().join(format!("wd-exp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let a = write_export(&dir, "s.docx", b"one").unwrap();
        let b = write_export(&dir, "s.docx", b"two").unwrap();
        assert_eq!(a.file_name().unwrap(), "s.docx");
        assert_eq!(b.file_name().unwrap(), "s (2).docx");
        assert_eq!(fs::read(&a).unwrap(), b"one");
    }
}
