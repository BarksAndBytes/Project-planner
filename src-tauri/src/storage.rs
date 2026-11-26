//! Local storage for the app's data document, encrypted at rest (spec 6.1).
//!
//! Standard library only, so the file layout, migration and failure rules
//! can be unit-tested without the Tauri toolchain:
//! `rustc --edition 2021 --test src/storage.rs`.
//! The real cipher and the operating-system key protection live in
//! `crypto.rs` and plug in through the [`Sealer`] and [`KeyWrapper`] traits.
//!
//! Files in the app's private data folder:
//! - `data.enc`: the data document, sealed with a random 256-bit data key.
//! - `data.enc.bak`: the previous version.
//! - `key.wrapped`: the data key, wrapped by Windows Data Protection or the
//!   Android Keystore, so it is useless on any other device or user account.
//! - `device-id`: this device's id (not secret).
//!
//! Rules:
//! - Writes are atomic (temp file, flush, rename), so a crash mid-save never
//!   leaves a half-written file.
//! - If the encrypted data exists but its key can't be unwrapped, nothing is
//!   ever overwritten: the vault refuses to open.
//! - A plain `data.json` from a pre-encryption build is encrypted on first
//!   open and the plain copies are deleted.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

pub const DATA_FILE: &str = "data.enc";
pub const KEY_FILE: &str = "key.wrapped";
pub const DEVICE_FILE: &str = "device-id";
pub const IDENTITY_KEY_FILE: &str = "identity.key.wrapped";
pub const IDENTITY_PUB_FILE: &str = "identity.pub";
const LEGACY_DATA_FILE: &str = "data.json";
const MAGIC: &[u8; 4] = b"WDE1";

/// Upper bound on the data document. Spec limits (2,000-character entries,
/// 120-character names) keep real data far below this.
pub const MAX_DATA_BYTES: usize = 64 * 1024 * 1024;

/// Authenticated encryption with a 32-byte key.
pub trait Sealer: Send + Sync {
    fn random_key(&self) -> io::Result<[u8; 32]>;
    fn seal(&self, key: &[u8; 32], aad: &[u8], plain: &[u8]) -> io::Result<Vec<u8>>;
    fn open(&self, key: &[u8; 32], aad: &[u8], sealed: &[u8]) -> io::Result<Vec<u8>>;
}

/// Protects the data key with a key the operating system holds.
pub trait KeyWrapper {
    fn wrap(&self, key: &[u8]) -> io::Result<Vec<u8>>;
    fn unwrap(&self, wrapped: &[u8]) -> io::Result<Vec<u8>>;
}

/// The data key, wiped from memory when dropped.
struct SecretKey([u8; 32]);

impl Drop for SecretKey {
    fn drop(&mut self) {
        for b in self.0.iter_mut() {
            // Volatile so the compiler can't skip the wipe.
            unsafe { std::ptr::write_volatile(b, 0) };
        }
    }
}

pub struct Vault {
    dir: PathBuf,
    key: SecretKey,
    sealer: Box<dyn Sealer>,
}

impl Vault {
    /// Opens (or on first run, creates) the vault in `dir`.
    pub fn open(dir: &Path, wrapper: &dyn KeyWrapper, sealer: Box<dyn Sealer>) -> io::Result<Vault> {
        fs::create_dir_all(dir)?;
        let key = match read_limited(&dir.join(KEY_FILE), 4096)? {
            Some(wrapped) => {
                let raw = wrapper.unwrap(&wrapped).map_err(|e| {
                    other(format!("couldn't unlock the data key on this device ({e}); your data has not been changed"))
                })?;
                let arr: [u8; 32] = raw
                    .as_slice()
                    .try_into()
                    .map_err(|_| other("the stored data key is damaged; your data has not been changed"))?;
                SecretKey(arr)
            }
            None => {
                if dir.join(DATA_FILE).exists() {
                    return Err(other(
                        "encrypted data was found but its key is missing; your data has not been changed",
                    ));
                }
                let key = SecretKey(sealer.random_key()?);
                write_atomic(dir, KEY_FILE, &wrapper.wrap(&key.0)?, false)?;
                key
            }
        };
        let vault = Vault { dir: dir.to_path_buf(), key, sealer };
        vault.migrate_legacy()?;
        Ok(vault)
    }

    pub fn load(&self) -> io::Result<Option<String>> {
        let Some(sealed) = read_limited(&self.dir.join(DATA_FILE), MAX_DATA_BYTES + 1024)? else {
            return Ok(None);
        };
        if sealed.len() < MAGIC.len() || &sealed[..MAGIC.len()] != MAGIC {
            return Err(other("the data file is not in a format this version understands"));
        }
        let plain = self
            .sealer
            .open(&self.key.0, MAGIC, &sealed[MAGIC.len()..])
            .map_err(|_| other("the data file is damaged or was changed outside the app"))?;
        String::from_utf8(plain).map(Some).map_err(|_| other("the data file is damaged"))
    }

    pub fn save(&self, json: &str) -> io::Result<()> {
        if json.len() > MAX_DATA_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "data is larger than the storage limit"));
        }
        if !json.starts_with('{') {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "data must be a JSON object"));
        }
        let mut out = MAGIC.to_vec();
        out.extend(self.sealer.seal(&self.key.0, MAGIC, json.as_bytes())?);
        write_atomic(&self.dir, DATA_FILE, &out, true)
    }

    fn migrate_legacy(&self) -> io::Result<()> {
        let legacy = self.dir.join(LEGACY_DATA_FILE);
        let Some(bytes) = read_limited(&legacy, MAX_DATA_BYTES)? else { return Ok(()) };
        let json = String::from_utf8(bytes).map_err(|_| other("the old data file is damaged"))?;
        if !self.dir.join(DATA_FILE).exists() && json.starts_with('{') {
            self.save(&json)?;
        }
        // Only delete plain copies once the encrypted copy is readable.
        if self.load()?.is_some() {
            for name in [LEGACY_DATA_FILE, "data.json.bak", "data.json.tmp"] {
                let p = self.dir.join(name);
                if p.exists() {
                    fs::remove_file(p)?;
                }
            }
        }
        Ok(())
    }
}

/// This device's long-term sync identity (Noise static key pair). The
/// private key is wrapped by the OS key protection, like the data key.
pub struct Identity {
    private: Vec<u8>,
    pub public: Vec<u8>,
}

impl Identity {
    pub fn private(&self) -> &[u8] {
        &self.private
    }
}

impl Drop for Identity {
    fn drop(&mut self) {
        for b in self.private.iter_mut() {
            unsafe { std::ptr::write_volatile(b, 0) };
        }
    }
}

/// Loads the identity, or creates one with `generate` on first use. Never
/// replaces an identity that exists but can't be unlocked: other devices
/// know this device by its key.
pub fn load_or_create_identity(
    dir: &Path,
    wrapper: &dyn KeyWrapper,
    generate: impl FnOnce() -> io::Result<(Vec<u8>, Vec<u8>)>,
) -> io::Result<Identity> {
    fs::create_dir_all(dir)?;
    let wrapped = read_limited(&dir.join(IDENTITY_KEY_FILE), 4096)?;
    let public = read_limited(&dir.join(IDENTITY_PUB_FILE), 64)?;
    match (wrapped, public) {
        (Some(w), Some(p)) => {
            let private = wrapper.unwrap(&w).map_err(|e| other(format!("couldn't unlock this device's sync key ({e})")))?;
            if private.len() != 32 || p.len() != 32 {
                return Err(other("this device's sync key is damaged"));
            }
            Ok(Identity { private, public: p })
        }
        (None, None) => {
            let (private, public) = generate()?;
            if private.len() != 32 || public.len() != 32 {
                return Err(other("key generation failed"));
            }
            write_atomic(dir, IDENTITY_KEY_FILE, &wrapper.wrap(&private)?, false)?;
            write_atomic(dir, IDENTITY_PUB_FILE, &public, false)?;
            Ok(Identity { private, public })
        }
        _ => Err(other("this device's sync key is incomplete; it has not been replaced")),
    }
}

pub fn load_device_id(dir: &Path) -> io::Result<Option<String>> {
    Ok(read_limited(&dir.join(DEVICE_FILE), 64)?
        .and_then(|b| String::from_utf8(b).ok())
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

/// 8-4-4-4-12 hex.
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn other(msg: impl Into<String>) -> io::Error {
    io::Error::other(msg.into())
}

fn read_limited(path: &Path, max: usize) -> io::Result<Option<Vec<u8>>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut buf = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut buf)?;
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

// ---- Base64 (for passing bytes to the Android Keystore plugin) ------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |acc, (i, b)| acc | ((*b as u32) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

pub fn b64_decode(s: &str) -> io::Result<Vec<u8>> {
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = B64.iter().position(|&x| x == c).ok_or_else(|| other("invalid base64"))? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    // Test doubles. NOT real cryptography: they only let the file-handling
    // rules be tested without external crates.
    struct FakeSealer;
    impl Sealer for FakeSealer {
        fn random_key(&self) -> io::Result<[u8; 32]> {
            Ok([7; 32])
        }
        fn seal(&self, key: &[u8; 32], aad: &[u8], plain: &[u8]) -> io::Result<Vec<u8>> {
            let mut out: Vec<u8> = aad.to_vec();
            out.extend(plain.iter().enumerate().map(|(i, b)| b ^ key[i % 32]));
            Ok(out)
        }
        fn open(&self, key: &[u8; 32], aad: &[u8], sealed: &[u8]) -> io::Result<Vec<u8>> {
            if !sealed.starts_with(aad) {
                return Err(other("tag mismatch"));
            }
            Ok(sealed[aad.len()..].iter().enumerate().map(|(i, b)| b ^ key[i % 32]).collect())
        }
    }

    struct FakeWrapper {
        fail_unwrap: Cell<bool>,
    }
    impl FakeWrapper {
        fn ok() -> Self {
            FakeWrapper { fail_unwrap: Cell::new(false) }
        }
    }
    impl KeyWrapper for FakeWrapper {
        fn wrap(&self, key: &[u8]) -> io::Result<Vec<u8>> {
            Ok(key.iter().map(|b| b ^ 0x5a).collect())
        }
        fn unwrap(&self, w: &[u8]) -> io::Result<Vec<u8>> {
            if self.fail_unwrap.get() {
                return Err(other("other user"));
            }
            Ok(w.iter().map(|b| b ^ 0x5a).collect())
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("wd-test-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn vault(dir: &Path) -> io::Result<Vault> {
        Vault::open(dir, &FakeWrapper::ok(), Box::new(FakeSealer))
    }

    #[test]
    fn first_open_creates_wrapped_key_and_loads_nothing() {
        let dir = temp_dir("first");
        let v = vault(&dir).unwrap();
        assert_eq!(v.load().unwrap(), None);
        assert!(dir.join(KEY_FILE).exists());
        assert_ne!(fs::read(dir.join(KEY_FILE)).unwrap(), vec![7u8; 32], "key must not be stored raw");
    }

    #[test]
    fn save_then_load_round_trips_keeps_backup_and_is_not_plaintext() {
        let dir = temp_dir("roundtrip");
        let v = vault(&dir).unwrap();
        v.save(r#"{"a":1}"#).unwrap();
        v.save(r#"{"a":2}"#).unwrap();
        assert_eq!(vault(&dir).unwrap().load().unwrap().as_deref(), Some(r#"{"a":2}"#));
        let raw = fs::read(dir.join(DATA_FILE)).unwrap();
        assert!(raw.starts_with(MAGIC));
        assert!(!String::from_utf8_lossy(&raw).contains(r#""a":2"#));
        assert!(dir.join("data.enc.bak").exists());
        assert!(!dir.join("data.enc.tmp").exists());
    }

    #[test]
    fn rejects_non_object_data() {
        assert!(vault(&temp_dir("nonobj")).unwrap().save("[1,2]").is_err());
    }

    #[test]
    fn tampered_file_is_refused() {
        let dir = temp_dir("tamper");
        vault(&dir).unwrap().save(r#"{"a":1}"#).unwrap();
        let mut raw = fs::read(dir.join(DATA_FILE)).unwrap();
        raw[5] ^= 0xff; // inside the authenticated part
        fs::write(dir.join(DATA_FILE), &raw).unwrap();
        assert!(vault(&dir).unwrap().load().is_err());
        fs::write(dir.join(DATA_FILE), b"XXXXjunk").unwrap();
        assert!(vault(&dir).unwrap().load().is_err());
    }

    #[test]
    fn missing_key_with_existing_data_refuses_and_changes_nothing() {
        let dir = temp_dir("nokey");
        vault(&dir).unwrap().save(r#"{"a":1}"#).unwrap();
        let before = fs::read(dir.join(DATA_FILE)).unwrap();
        fs::remove_file(dir.join(KEY_FILE)).unwrap();
        assert!(vault(&dir).is_err());
        assert!(!dir.join(KEY_FILE).exists(), "must not mint a new key over existing data");
        assert_eq!(fs::read(dir.join(DATA_FILE)).unwrap(), before);
    }

    #[test]
    fn key_that_cannot_be_unwrapped_refuses() {
        let dir = temp_dir("badwrap");
        vault(&dir).unwrap().save(r#"{"a":1}"#).unwrap();
        let w = FakeWrapper::ok();
        w.fail_unwrap.set(true);
        assert!(Vault::open(&dir, &w, Box::new(FakeSealer)).is_err());
    }

    #[test]
    fn legacy_plain_file_is_encrypted_and_removed() {
        let dir = temp_dir("legacy");
        fs::write(dir.join("data.json"), r#"{"old":true}"#).unwrap();
        fs::write(dir.join("data.json.bak"), r#"{"older":true}"#).unwrap();
        let v = vault(&dir).unwrap();
        assert_eq!(v.load().unwrap().as_deref(), Some(r#"{"old":true}"#));
        assert!(!dir.join("data.json").exists());
        assert!(!dir.join("data.json.bak").exists());
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

    #[test]
    fn identity_is_created_once_wrapped_and_never_replaced() {
        let dir = temp_dir("identity");
        let w = FakeWrapper::ok();
        let id1 = load_or_create_identity(&dir, &w, || Ok((vec![1; 32], vec![2; 32]))).unwrap();
        assert_eq!(id1.public, vec![2; 32]);
        assert_ne!(fs::read(dir.join(IDENTITY_KEY_FILE)).unwrap(), vec![1u8; 32], "private key must be wrapped");
        let id2 = load_or_create_identity(&dir, &w, || panic!("must not regenerate")).unwrap();
        assert_eq!(id2.private(), &[1u8; 32][..]);
        fs::remove_file(dir.join(IDENTITY_PUB_FILE)).unwrap();
        assert!(load_or_create_identity(&dir, &w, || Ok((vec![3; 32], vec![4; 32]))).is_err());
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        let cases: [(&[u8], &str); 7] =
            [(b"", ""), (b"f", "Zg=="), (b"fo", "Zm8="), (b"foo", "Zm9v"), (b"foob", "Zm9vYg=="), (b"fooba", "Zm9vYmE="), (b"foobar", "Zm9vYmFy")];
        for (raw, enc) in cases {
            assert_eq!(b64_encode(raw), enc);
            assert_eq!(b64_decode(enc).unwrap(), raw);
        }
        let all: Vec<u8> = (0..=255).collect();
        assert_eq!(b64_decode(&b64_encode(&all)).unwrap(), all);
        assert!(b64_decode("a*b").is_err());
    }
}
