//! Native core for Work Dashboard: encrypted local storage (phase 1) and the
//! network check that starts phase 2.
//! Every command validates its input; the screens are treated as untrusted.
//! Commands are async so they run off the main thread (the Android Keystore
//! call needs the main thread free).

mod crypto;
mod exports;
mod net;
mod pipe;
mod qr;
mod storage;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

use storage::{b64_decode, b64_encode, Identity, KeyWrapper, Vault};

/// Opened on first use. An error is kept, so a vault that can't be unlocked
/// stays closed and nothing is ever written over the existing data.
#[derive(Default)]
struct VaultState(Mutex<Option<Result<Vault, String>>>);

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn key_wrapper<R: Runtime>(app: &AppHandle<R>) -> Box<dyn KeyWrapper> {
    #[cfg(windows)]
    {
        let _ = app;
        Box::new(crypto::platform::Dpapi)
    }
    #[cfg(target_os = "android")]
    {
        Box::new(crypto::platform::AndroidKeystore(app.clone()))
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = app;
        Box::new(crypto::platform::DevOnly)
    }
}

fn open_vault<R: Runtime>(app: &AppHandle<R>) -> Result<Vault, String> {
    let dir = data_dir(app)?;
    Vault::open(&dir, key_wrapper(app).as_ref(), Box::new(crypto::XChaCha)).map_err(|e| e.to_string())
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

// ---- Device sync pipe (phase 2) --------------------------------------------

#[derive(Default)]
struct IdentityState(Mutex<Option<Identity>>);

#[derive(Default)]
struct SyncNet {
    listener: Mutex<Option<std::net::TcpListener>>,
    pipe: Mutex<Option<pipe::Pipe>>,
    cancel: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityInfo {
    public_key: String,
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenInfo {
    ips: Vec<String>,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerInfo {
    peer_key: String,
    handshake_hash: String,
}

fn with_identity<R: Runtime, T>(app: &AppHandle<R>, state: &IdentityState, f: impl FnOnce(&Identity) -> T) -> Result<T, String> {
    let mut slot = state.0.lock().map_err(|_| "busy".to_string())?;
    if slot.is_none() {
        let dir = data_dir(app)?;
        let id = storage::load_or_create_identity(&dir, key_wrapper(app).as_ref(), pipe::generate_keypair).map_err(|e| e.to_string())?;
        *slot = Some(id);
    }
    Ok(f(slot.as_ref().expect("identity loaded")))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn peer_info(p: &pipe::Pipe) -> PeerInfo {
    PeerInfo { peer_key: b64_encode(&p.peer_key), handshake_hash: hex(&p.handshake_hash) }
}

#[tauri::command]
async fn identity_info<R: Runtime>(app: AppHandle<R>, state: State<'_, IdentityState>) -> Result<IdentityInfo, String> {
    let public_key = with_identity(&app, &state, |id| b64_encode(&id.public))?;
    Ok(IdentityInfo { public_key, device_name: device_name() })
}

#[tauri::command]
async fn qr_svg(text: String) -> Result<String, String> {
    if text.len() > 512 {
        return Err("too long".into());
    }
    qr::svg_data_url(&text)
}

#[tauri::command]
async fn pipe_listen(net: State<'_, Arc<SyncNet>>) -> Result<ListenInfo, String> {
    let listener = std::net::TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    net.cancel.store(false, Ordering::Relaxed);
    *net.pipe.lock().map_err(|_| "busy")? = None;
    *net.listener.lock().map_err(|_| "busy")? = Some(listener);
    let ips = net::local_ipv4s().into_iter().map(|ip| ip.to_string()).collect();
    Ok(ListenInfo { ips, port })
}

#[tauri::command]
async fn pipe_accept<R: Runtime>(
    app: AppHandle<R>,
    identity: State<'_, IdentityState>,
    net: State<'_, Arc<SyncNet>>,
    timeout_secs: u64,
) -> Result<PeerInfo, String> {
    let private = with_identity(&app, &identity, |id| id.private().to_vec())?;
    let listener = net.listener.lock().map_err(|_| "busy")?.take().ok_or("not listening")?;
    let shared = Arc::clone(net.inner());
    let timeout = Duration::from_secs(timeout_secs.clamp(5, 600));
    let pipe = tauri::async_runtime::spawn_blocking(move || pipe::accept_one(listener, &private, timeout, &shared.cancel))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut => "timed-out".to_string(),
            std::io::ErrorKind::Interrupted => "cancelled".to_string(),
            _ => e.to_string(),
        })?;
    let info = peer_info(&pipe);
    *net.pipe.lock().map_err(|_| "busy")? = Some(pipe);
    Ok(info)
}

#[tauri::command]
async fn pipe_connect<R: Runtime>(
    app: AppHandle<R>,
    identity: State<'_, IdentityState>,
    net: State<'_, Arc<SyncNet>>,
    ips: Vec<String>,
    port: u16,
) -> Result<PeerInfo, String> {
    let private = with_identity(&app, &identity, |id| id.private().to_vec())?;
    let pipe = tauri::async_runtime::spawn_blocking(move || pipe::Pipe::connect(&ips, port, &private))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => "timed-out".to_string(),
            std::io::ErrorKind::ConnectionRefused => "refused".to_string(),
            _ => e.to_string(),
        })?;
    let info = peer_info(&pipe);
    *net.pipe.lock().map_err(|_| "busy")? = Some(pipe);
    Ok(info)
}

#[tauri::command]
async fn pipe_send(net: State<'_, Arc<SyncNet>>, text: String) -> Result<(), String> {
    let shared = Arc::clone(net.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = shared.pipe.lock().map_err(|_| "busy".to_string())?;
        let p = slot.as_mut().ok_or("not connected")?;
        p.send(text.as_bytes()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pipe_recv(net: State<'_, Arc<SyncNet>>, timeout_secs: u64) -> Result<String, String> {
    let shared = Arc::clone(net.inner());
    let timeout = Duration::from_secs(timeout_secs.clamp(1, 300));
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = shared.pipe.lock().map_err(|_| "busy".to_string())?;
        let p = slot.as_mut().ok_or("not connected")?;
        let bytes = p.recv(timeout).map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => "timed-out".to_string(),
            std::io::ErrorKind::UnexpectedEof => "closed".to_string(),
            _ => e.to_string(),
        })?;
        String::from_utf8(bytes).map_err(|_| "bad message".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pipe_close(net: State<'_, Arc<SyncNet>>) -> Result<(), String> {
    net.cancel.store(true, Ordering::Relaxed);
    *net.listener.lock().map_err(|_| "busy")? = None;
    *net.pipe.lock().map_err(|_| "busy")? = None;
    Ok(())
}

// ---- Exports (phase 3) ---------------------------------------------------------

/// Saves an exported file. Windows: into Downloads, returns the full path.
/// Android: opens the share sheet, returns "shared".
#[tauri::command]
async fn save_export<R: Runtime>(app: AppHandle<R>, name: String, data: String, mime: String) -> Result<String, String> {
    let bytes = b64_decode(&data).map_err(|e| e.to_string())?;
    #[cfg(target_os = "android")]
    {
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("exports");
        // Old exports are removed so the cache doesn't grow.
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        let path = exports::write_export(&dir, &name, &bytes).map_err(|e| e.to_string())?;
        let path_str = path.to_string_lossy().to_string();
        let title = if mime.contains("wordprocessingml") { "Share Word summary" } else { "Share file" };
        crypto::platform::share_file(&app, &path_str, &mime, title)?;
        Ok("shared".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &mime;
        let dir = app.path().download_dir().map_err(|e| e.to_string())?;
        let path = exports::write_export(&dir, &name, &bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    }
}

/// Windows: shows a saved export in File Explorer. Only files in Downloads.
#[tauri::command]
async fn reveal_export<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
        let p = PathBuf::from(&path);
        if p.parent() != Some(downloads.as_path()) || !p.is_file() {
            return Err("not an export".into());
        }
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, path);
        Err("not supported on this device".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(VaultState::default())
        .manage(NetCheckState::default())
        .manage(IdentityState::default())
        .manage(Arc::new(SyncNet::default()));
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
            net_check_probe,
            identity_info,
            qr_svg,
            pipe_listen,
            pipe_accept,
            pipe_connect,
            pipe_send,
            pipe_recv,
            pipe_close,
            save_export,
            reveal_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running Work Dashboard");
}
