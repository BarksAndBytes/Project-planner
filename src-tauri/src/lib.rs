//! Native core for Work Dashboard: encrypted local storage (phase 1) and the
//! network check that starts phase 2.
//! Every command validates its input; the screens are treated as untrusted.
//! Commands are async so they run off the main thread (the Android Keystore
//! call needs the main thread free).

mod crypto;
mod net;
mod qr;
mod storage;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
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

// ---- Network check -------------------------------------------------------

#[derive(Default)]
struct NetCheckState(Mutex<Option<net::Check>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetCheckInfo {
    ip: Option<String>,
    port: u16,
    seconds: u64,
    qr: Option<String>,
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetCheckStatus {
    listening: bool,
    seconds_left: u64,
    successes: u32,
    last_peer: Option<String>,
    rejected: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResult {
    device_name: String,
    ms: u64,
}

fn device_name() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows computer".into())
    }
    #[cfg(target_os = "android")]
    {
        "Android device".to_string()
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        "Computer".to_string()
    }
}

#[tauri::command]
async fn local_ip() -> Option<String> {
    net::local_ipv4().map(|ip| ip.to_string())
}

#[tauri::command]
async fn net_check_start(state: State<'_, NetCheckState>, token: String) -> Result<NetCheckInfo, String> {
    let name = device_name();
    let check = net::Check::start(&token, &name, net::LISTEN_SECS).map_err(|e| e.to_string())?;
    let port = check.status().port;
    let ip = net::local_ipv4().map(|ip| ip.to_string());
    let qr = match &ip {
        Some(ip) => Some(qr::svg_data_url(&format!("wdcheck:1:{ip}:{port}:{token}"))?),
        None => None,
    };
    *state.0.lock().map_err(|_| "busy".to_string())? = Some(check);
    Ok(NetCheckInfo { ip, port, seconds: net::LISTEN_SECS, qr, device_name: name })
}

#[tauri::command]
async fn net_check_status(state: State<'_, NetCheckState>) -> Result<NetCheckStatus, String> {
    let slot = state.0.lock().map_err(|_| "busy".to_string())?;
    let s = slot.as_ref().map(|c| c.status()).unwrap_or_default();
    Ok(NetCheckStatus {
        listening: s.listening,
        seconds_left: s.seconds_left,
        successes: s.successes,
        last_peer: s.last_peer,
        rejected: s.rejected,
    })
}

#[tauri::command]
async fn net_check_stop(state: State<'_, NetCheckState>) -> Result<(), String> {
    if let Some(c) = state.0.lock().map_err(|_| "busy".to_string())?.take() {
        c.stop();
    }
    Ok(())
}

#[tauri::command]
async fn net_check_probe(host: String, port: u16, token: String) -> Result<ProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || net::probe(&host, port, &token))
        .await
        .map_err(|e| e.to_string())?
        .map(|(device_name, ms)| ProbeResult { device_name, ms })
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(VaultState::default())
        .manage(NetCheckState::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(crypto::platform::init());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            load_device_id,
            save_device_id,
            local_ip,
            net_check_start,
            net_check_status,
            net_check_stop,
            net_check_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running Work Dashboard");
}
