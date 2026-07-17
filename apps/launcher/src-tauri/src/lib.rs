use std::sync::Arc;

use bridge_host::BridgeHost;
use tauri::{Manager, RunEvent};

mod bridge_host;

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
      bridge_host::bridge_get_telemetry,
      bridge_host::bridge_shutdown,
    ])
    .build(tauri::generate_context!())
    .expect("error while building WinWing vibration launcher")
    .run(|app_handle, event| {
      match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
          let state = app_handle.state::<Arc<BridgeHost>>();
          bridge_host::shutdown_host(state.as_ref());
        }
        _ => {}
      }
    });
}
