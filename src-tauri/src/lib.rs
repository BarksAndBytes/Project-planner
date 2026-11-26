//! Native core for Work Dashboard: encrypted local storage (phase 1).
//! Every command validates its input; the screens are treated as untrusted.
//! Commands are async so they run off the main thread (the Android Keystore
//! call needs the main thread free).

mod crypto;
mod storage;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};

use storage::Vault;

/// Opened on first use. An error is kept, so a vault that can't be unlocked
/// stays closed and nothing is ever written over the existing data.
#[derive(Default)]
struct VaultState(Mutex<Option<Result<Vault, String>>>);

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn open_vault<R: Runtime>(app: &AppHandle<R>) -> Result<Vault, String> {
    let dir = data_dir(app)?;
    #[cfg(windows)]
    let wrapper = crypto::platform::Dpapi;
    #[cfg(target_os = "android")]
    let wrapper = crypto::platform::AndroidKeystore(app.clone());
    #[cfg(not(any(windows, target_os = "android")))]
    let wrapper = crypto::platform::DevOnly;
    Vault::open(&dir, &wrapper, Box::new(crypto::XChaCha)).map_err(|e| e.to_string())
}

fn with_vault<R: Runtime, T>(
    app: &AppHandle<R>,
    state: &VaultState,
    f: impl FnOnce(&Vault) -> std::io::Result<T>,
) -> Result<T, String> {
    let mut slot = state.0.lock().map_err(|_| "storage is busy".to_string())?;
    let vault = slot.get_or_insert_with(|| open_vault(app));
    match vault {
        Ok(v) => f(v).map_err(|e| e.to_string()),
        Err(e) => Err(e.clone()),
    }
}

#[tauri::command]
async fn load_data<R: Runtime>(app: AppHandle<R>, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    with_vault(&app, &state, |v| v.load())
}

#[tauri::command]
async fn save_data<R: Runtime>(app: AppHandle<R>, state: State<'_, VaultState>, json: String) -> Result<(), String> {
    with_vault(&app, &state, |v| v.save(&json))
}

#[tauri::command]
async fn load_device_id<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    storage::load_device_id(&data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_device_id<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    storage::save_device_id(&data_dir(&app)?, &id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(VaultState::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(crypto::platform::init());
    builder
        .invoke_handler(tauri::generate_handler![load_data, save_data, load_device_id, save_device_id])
        .run(tauri::generate_context!())
        .expect("error while running Work Dashboard");
}
