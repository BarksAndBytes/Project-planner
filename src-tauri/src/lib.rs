//! Native core for Work Dashboard. Phase 1 exposes local storage only.
//! Every command validates its input; the screens are treated as untrusted.

mod storage;

use std::path::PathBuf;
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    storage::load(&data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(app: tauri::AppHandle, json: String) -> Result<(), String> {
    storage::save(&data_dir(&app)?, &json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_device_id(app: tauri::AppHandle) -> Result<Option<String>, String> {
    storage::load_device_id(&data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_device_id(app: tauri::AppHandle, id: String) -> Result<(), String> {
    storage::save_device_id(&data_dir(&app)?, &id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_data, save_data, load_device_id, save_device_id])
        .run(tauri::generate_context!())
        .expect("error while running Work Dashboard");
}
