//! Real cryptography for the vault in `storage.rs`.
//!
//! - Data: XChaCha20-Poly1305 (RustCrypto, audited) with a random 192-bit
//!   nonce per save.
//! - Data key protection:
//!   - Windows: Data Protection API (DPAPI), tied to the signed-in user.
//!   - Android: an AES-256-GCM key inside the Android Keystore that never
//!     leaves it (see android/KeystorePlugin.kt).
//!   - Anything else (developer machines only): the key is stored with
//!     owner-only file permissions. Not a supported platform for real data.

use std::io;

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::storage::Sealer;

const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;

pub struct XChaCha;

impl Sealer for XChaCha {
    fn random_key(&self) -> io::Result<[u8; 32]> {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        Ok(key)
    }

    fn seal(&self, key: &[u8; 32], aad: &[u8], plain: &[u8]) -> io::Result<Vec<u8>> {
        let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| io::Error::other("bad key length"))?;
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ct = cipher
            .encrypt(&nonce, Payload { msg: plain, aad })
            .map_err(|_| io::Error::other("encryption failed"))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(nonce.as_slice());
        out.extend_from_slice(&ct);
        Ok(out)
    }

    fn open(&self, key: &[u8; 32], aad: &[u8], sealed: &[u8]) -> io::Result<Vec<u8>> {
        if sealed.len() < NONCE_LEN + TAG_LEN {
            return Err(io::Error::other("sealed data too short"));
        }
        let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| io::Error::other("bad key length"))?;
        let (nonce, ct) = sealed.split_at(NONCE_LEN);
        cipher
            .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
            .map_err(|_| io::Error::other("decryption failed"))
    }
}

// ---- Windows: DPAPI ----------------------------------------------------

#[cfg(windows)]
pub mod platform {
    use std::{io, ptr, slice};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    use crate::storage::KeyWrapper;

    pub struct Dpapi;

    fn run(input: &[u8], protect: bool) -> io::Result<Vec<u8>> {
        let len = u32::try_from(input.len()).map_err(|_| io::Error::other("input too large"))?;
        let blob_in = CRYPT_INTEGER_BLOB { cbData: len, pbData: input.as_ptr() as *mut u8 };
        let mut blob_out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        // SAFETY: blob_in points at `input` for the duration of the call;
        // blob_out is allocated by Windows and freed with LocalFree below.
        let ok = unsafe {
            if protect {
                CryptProtectData(&blob_in, ptr::null(), ptr::null(), ptr::null(), ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut blob_out)
            } else {
                CryptUnprotectData(&blob_in, ptr::null_mut(), ptr::null(), ptr::null(), ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut blob_out)
            }
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: on success Windows returns cbData valid bytes at pbData.
        let out = unsafe { slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec() };
        unsafe { LocalFree(blob_out.pbData as _) };
        Ok(out)
    }

    impl KeyWrapper for Dpapi {
        fn wrap(&self, key: &[u8]) -> io::Result<Vec<u8>> {
            run(key, true)
        }
        fn unwrap(&self, wrapped: &[u8]) -> io::Result<Vec<u8>> {
            run(wrapped, false)
        }
    }
}

// ---- Android: Keystore, through the Kotlin plugin -------------------------

#[cfg(target_os = "android")]
pub mod platform {
    use std::io;

    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{Manager, Runtime};

    use crate::storage::{b64_decode, b64_encode, KeyWrapper};

    pub struct Keystore<R: Runtime>(PluginHandle<R>);
    pub struct Share<R: Runtime>(PluginHandle<R>);
    pub struct Speech<R: Runtime>(PluginHandle<R>);

    #[derive(Deserialize)]
    struct SpeechResponse {
        text: String,
    }

    /// Opens the phone's speech recognizer and waits for the text.
    pub fn listen<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
        let speech = app.state::<Speech<R>>();
        speech.0.run_mobile_plugin::<SpeechResponse>("listen", ()).map(|r| r.text).map_err(|e| e.to_string())
    }

    #[derive(Serialize)]
    struct ShareRequest {
        path: String,
        mime: String,
        title: String,
    }

    /// Opens Android's share sheet for a file in cache/exports.
    pub fn share_file<R: Runtime>(app: &tauri::AppHandle<R>, path: &str, mime: &str, title: &str) -> Result<(), String> {
        let share = app.state::<Share<R>>();
        share
            .0
            .run_mobile_plugin::<serde_json::Value>("share", ShareRequest { path: path.into(), mime: mime.into(), title: title.into() })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[derive(Serialize)]
    struct Request {
        data: String,
    }

    #[derive(Deserialize)]
    struct Response {
        data: String,
    }

    /// Registers the Kotlin `KeystorePlugin` and `SharePlugin` classes from
    /// the app's Android project.
    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("keystore")
            .setup(|app, api| {
                let handle = api.register_android_plugin("io.github.barksandbytes.workdashboard", "KeystorePlugin")?;
                app.manage(Keystore(handle));
                let share = api.register_android_plugin("io.github.barksandbytes.workdashboard", "SharePlugin")?;
                app.manage(Share(share));
                let speech = api.register_android_plugin("io.github.barksandbytes.workdashboard", "SpeechPlugin")?;
                app.manage(Speech(speech));
                Ok(())
            })
            .build()
    }

    pub struct AndroidKeystore<R: Runtime>(pub tauri::AppHandle<R>);

    impl<R: Runtime> AndroidKeystore<R> {
        fn call(&self, command: &str, bytes: &[u8]) -> io::Result<Vec<u8>> {
            let ks = self.0.state::<Keystore<R>>();
            let res: Response = ks
                .0
                .run_mobile_plugin(command, Request { data: b64_encode(bytes) })
                .map_err(|e| io::Error::other(e.to_string()))?;
            b64_decode(&res.data)
        }
    }

    impl<R: Runtime> KeyWrapper for AndroidKeystore<R> {
        fn wrap(&self, key: &[u8]) -> io::Result<Vec<u8>> {
            self.call("wrap", key)
        }
        fn unwrap(&self, wrapped: &[u8]) -> io::Result<Vec<u8>> {
            self.call("unwrap", wrapped)
        }
    }
}

// ---- Developer machines (Linux, macOS) ------------------------------------

#[cfg(not(any(windows, target_os = "android")))]
pub mod platform {
    use std::io;

    use crate::storage::KeyWrapper;

    /// Stores the key as-is. Only for running `tauri dev` on a developer
    /// machine; Windows and Android are the supported platforms.
    pub struct DevOnly;

    impl KeyWrapper for DevOnly {
        fn wrap(&self, key: &[u8]) -> io::Result<Vec<u8>> {
            Ok(key.to_vec())
        }
        fn unwrap(&self, wrapped: &[u8]) -> io::Result<Vec<u8>> {
            Ok(wrapped.to_vec())
        }
    }
}
