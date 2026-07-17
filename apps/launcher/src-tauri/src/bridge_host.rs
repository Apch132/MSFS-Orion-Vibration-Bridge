use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct BridgeHost {
  inner: Mutex<Option<HostProcess>>,
}

struct HostProcess {
  child: Child,
  stdin: ChildStdin,
}

fn project_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../..")
    .canonicalize()
    .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn host_script_path() -> PathBuf {
  project_root().join("lib").join("bridge").join("host.js")
}

fn resolve_node() -> PathBuf {
  which_node().unwrap_or_else(|| PathBuf::from("node"))
}

fn which_node() -> Option<PathBuf> {
  let candidates = ["node.exe", "node"];
  for name in candidates {
    if let Ok(output) = Command::new("where").arg(name).output() {
      if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = text.lines().next() {
          let p = PathBuf::from(line.trim());
          if p.exists() {
            return Some(p);
          }
        }
      }
    }
  }
  None
}

fn ensure_host(app: &AppHandle, state: &BridgeHost) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
  if guard.is_some() {
    return Ok(());
  }

  let script = host_script_path();
  if !script.exists() {
    return Err(format!("bridge host script missing: {}", script.display()));
  }

  let node = resolve_node();
  let mut child = Command::new(&node)
    .arg(&script)
    .current_dir(project_root())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| {
      format!(
        "failed to spawn Node bridge host ({}): {e}. Is Node.js installed and on PATH?",
        node.display()
      )
    })?;

  let stdout = child.stdout.take().ok_or("bridge host stdout missing")?;
  let stderr = child.stderr.take().ok_or("bridge host stderr missing")?;
  let stdin = child.stdin.take().ok_or("bridge host stdin missing")?;

  let app_out = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines().flatten() {
      let trimmed = line.trim();
      if trimmed.is_empty() {
        continue;
      }
      match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => {
          let _ = app_out.emit("bridge://event", value);
        }
        Err(err) => {
          let _ = app_out.emit(
            "bridge://event",
            json!({ "event": "error", "message": format!("host parse error: {err}") }),
          );
        }
      }
    }
  });

  let app_err = app.clone();
  thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines().flatten() {
      let msg = line.trim();
      if msg.is_empty() {
        continue;
      }
      let _ = app_err.emit(
        "bridge://event",
        json!({ "event": "log", "level": "error", "message": msg }),
      );
    }
  });

  *guard = Some(HostProcess { child, stdin });
  Ok(())
}

fn write_cmd(state: &BridgeHost, cmd: Value) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
  let host = guard.as_mut().ok_or("bridge host is not running")?;
  let line = format!("{cmd}\n");
  host
    .stdin
    .write_all(line.as_bytes())
    .map_err(|e| format!("failed to write bridge command: {e}"))?;
  host
    .stdin
    .flush()
    .map_err(|e| format!("failed to flush bridge command: {e}"))?;
  Ok(())
}

pub fn shutdown_host(state: &BridgeHost) {
  if let Ok(mut guard) = state.inner.lock() {
    if let Some(mut host) = guard.take() {
      let _ = writeln!(host.stdin, "{}", json!({ "cmd": "shutdown" }));
      let _ = host.stdin.flush();
      let _ = host.child.wait();
    }
  }
}

#[tauri::command]
pub fn bridge_ensure(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, state.as_ref())
}

#[tauri::command]
pub fn bridge_start(
  app: AppHandle,
  state: State<'_, Arc<BridgeHost>>,
  preferences: Option<Value>,
) -> Result<(), String> {
  ensure_host(&app, state.as_ref())?;
  let mut cmd = json!({ "cmd": "start" });
  if let Some(prefs) = preferences {
    cmd["preferences"] = prefs;
  }
  write_cmd(state.as_ref(), cmd)
}

#[tauri::command]
pub fn bridge_stop(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, state.as_ref())?;
  write_cmd(state.as_ref(), json!({ "cmd": "stop" }))
}

#[tauri::command]
pub fn bridge_update_preferences(
  app: AppHandle,
  state: State<'_, Arc<BridgeHost>>,
  preferences: Value,
) -> Result<(), String> {
  ensure_host(&app, state.as_ref())?;
  write_cmd(
    state.as_ref(),
    json!({ "cmd": "updatePreferences", "preferences": preferences }),
  )
}

#[tauri::command]
pub fn bridge_get_state(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, state.as_ref())?;
  write_cmd(state.as_ref(), json!({ "cmd": "getState" }))
}
