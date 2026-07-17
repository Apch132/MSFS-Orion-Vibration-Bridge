mod bridge_host;

use std::sync::Arc;

use bridge_host::BridgeHost;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host = Arc::new(BridgeHost::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(host)
        .invoke_handler(tauri::generate_handler![
            bridge_host::bridge_ensure,
            bridge_host::bridge_start,
            bridge_host::bridge_stop,
            bridge_host::bridge_update_preferences,
            bridge_host::bridge_get_state,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<Arc<BridgeHost>>();
                bridge_host::shutdown_host(state.as_ref());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WinWing vibration launcher");
}
