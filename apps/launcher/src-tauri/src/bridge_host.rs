//! Bridge host sidecar lifecycle manager.
//! Spawns the packaged `bridge-host` binary (never Node.js / PATH).

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

const PROTOCOL_VERSION: u64 = 1;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const SIDECAR_BASENAME: &str = "bridge-host";
const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";

#[derive(Default)]
pub struct BridgeHost {
  inner: Mutex<HostSlot>,
  last_telemetry: Mutex<Option<Value>>,
  last_flight_event: Mutex<Option<Value>>,
}

#[derive(Default)]
struct HostSlot {
  process: Option<HostProcess>,
  /// Serializes overlapping Start/ensure calls so only one sidecar exists.
  starting: bool,
}

struct HostProcess {
  child: Child,
  stdin: ChildStdin,
  alive: Arc<AtomicBool>,
  expecting_exit: Arc<AtomicBool>,
}

fn sidecar_candidates() -> Vec<PathBuf> {
  let mut out = Vec::new();

  // Test / explicit override (absolute path to a fake or real sidecar).
  if let Ok(override_path) = std::env::var("ORION_BRIDGE_SIDECAR") {
    let p = PathBuf::from(override_path);
    if p.exists() {
      out.push(p);
    }
  }

  // Production / installed: next to the launcher executable.
  if let Ok(mut exe) = std::env::current_exe() {
    exe.pop();
    out.push(exe.join(format!("{SIDECAR_BASENAME}.exe")));
    out.push(exe.join("binaries").join(format!("{SIDECAR_BASENAME}.exe")));
    out.push(exe.join(format!("{SIDECAR_BASENAME}-{TARGET_TRIPLE}.exe")));
  }

  // Development: src-tauri/binaries/bridge-host-<triple>.exe
  let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  out.push(
    manifest
      .join("binaries")
      .join(format!("{SIDECAR_BASENAME}-{TARGET_TRIPLE}.exe")),
  );
  out.push(manifest.join("binaries").join(format!("{SIDECAR_BASENAME}.exe")));

  // Repo dist/sidecars (optional fallback for local tooling).
  out.push(
    manifest
      .join("../../..")
      .join("dist")
      .join("sidecars")
      .join(format!("{SIDECAR_BASENAME}-{TARGET_TRIPLE}.exe")),
  );

  out
}

pub fn resolve_sidecar_path() -> Result<PathBuf, String> {
  for candidate in sidecar_candidates() {
    if candidate.is_file() {
      return Ok(candidate);
    }
  }
  Err(format!(
    "bridge-host sidecar not found. Build it with `npm run build:bridge-host` \
     (expected binaries/bridge-host-{TARGET_TRIPLE}.exe)."
  ))
}

fn event_name(value: &Value) -> Option<&str> {
  value
    .get("event")
    .and_then(|v| v.as_str())
    .or_else(|| value.get("type").and_then(|v| v.as_str()))
}

fn normalize_event(mut value: Value) -> Value {
  if value.get("protocolVersion").is_none() {
    value["protocolVersion"] = json!(PROTOCOL_VERSION);
  }
  if let Some(name) = event_name(&value).map(str::to_string) {
    if value.get("event").is_none() {
      value["event"] = json!(name);
    }
    if value.get("type").is_none() {
      value["type"] = json!(name);
    }
  }
  value
}

fn spawn_reader_threads(
  app: AppHandle,
  host: Arc<BridgeHost>,
  stdout: impl std::io::Read + Send + 'static,
  stderr: impl std::io::Read + Send + 'static,
  ready_tx: mpsc::SyncSender<Result<(), String>>,
  expecting_exit: Arc<AtomicBool>,
) {
  let ready_flag = Arc::new(AtomicBool::new(false));
  let ready_tx = Arc::new(Mutex::new(Some(ready_tx)));

  let app_out = app.clone();
  let host_out = Arc::clone(&host);
  let ready_flag_out = Arc::clone(&ready_flag);
  let ready_tx_out = Arc::clone(&ready_tx);
  let expecting_exit_out = Arc::clone(&expecting_exit);
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
      let trimmed = line.trim();
      if trimmed.is_empty() {
        continue;
      }
      match serde_json::from_str::<Value>(trimmed) {
        Ok(raw) => {
          let value = normalize_event(raw);
          cache_protocol_payload(&host_out, &value);
          if event_name(&value) == Some("ready")
            && !ready_flag_out.swap(true, Ordering::SeqCst)
          {
            if let Ok(mut guard) = ready_tx_out.lock() {
              if let Some(tx) = guard.take() {
                let _ = tx.send(Ok(()));
              }
            }
          }
          let _ = app_out.emit("bridge://event", value);
        }
        Err(err) => {
          let _ = app_out.emit(
            "bridge://event",
            json!({
              "protocolVersion": PROTOCOL_VERSION,
              "type": "error",
              "event": "error",
              "message": format!("host parse error: {err}"),
            }),
          );
        }
      }
    }
    // stdout closed: process exited
    if !ready_flag_out.load(Ordering::SeqCst) {
      if let Ok(mut guard) = ready_tx_out.lock() {
        if let Some(tx) = guard.take() {
          let _ = tx.send(Err("bridge-host exited before ready handshake".into()));
        }
      }
    } else if !expecting_exit_out.load(Ordering::SeqCst) {
      mark_telemetry_stale(&host_out);
      let _ = app_out.emit(
        "bridge://event",
        json!({
          "protocolVersion": PROTOCOL_VERSION,
          "type": "error",
          "event": "error",
          "message": "bridge-host process ended unexpectedly",
        }),
      );
    }
  });

  let app_err = app;
  thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
      let msg = line.trim();
      if msg.is_empty() {
        continue;
      }
      let _ = app_err.emit(
        "bridge://event",
        json!({
          "protocolVersion": PROTOCOL_VERSION,
          "type": "log",
          "event": "log",
          "level": "error",
          "message": msg,
        }),
      );
    }
  });
}

fn cache_protocol_payload(host: &BridgeHost, value: &Value) {
  match event_name(value) {
    Some("telemetry") => {
      if let Some(payload) = value.get("payload").cloned() {
        if let Ok(mut guard) = host.last_telemetry.lock() {
          *guard = Some(payload);
        }
      }
    }
    Some("event") => {
      if let Some(payload) = value.get("payload").cloned() {
        if let Ok(mut guard) = host.last_flight_event.lock() {
          *guard = Some(payload);
        }
      }
    }
    _ => {}
  }
}

fn mark_telemetry_stale(host: &BridgeHost) {
  if let Ok(mut guard) = host.last_telemetry.lock() {
    if let Some(ref mut payload) = *guard {
      payload["stale"] = json!(true);
      if let Some(conn) = payload.get_mut("connection") {
        conn["simconnect"] = json!("error");
      }
    }
  }
}

fn ensure_host(app: &AppHandle, state: &Arc<BridgeHost>) -> Result<(), String> {
  loop {
    {
      let mut guard = state.inner.lock().map_err(|e| e.to_string())?;

      if let Some(host) = guard.process.as_mut() {
        match host.child.try_wait() {
          Ok(Some(status)) => {
            host.alive.store(false, Ordering::SeqCst);
            host.expecting_exit.store(true, Ordering::SeqCst);
            guard.process = None;
            mark_telemetry_stale(state);
            let _ = app.emit(
              "bridge://event",
              json!({
                "protocolVersion": PROTOCOL_VERSION,
                "type": "error",
                "event": "error",
                "message": format!("bridge-host exited unexpectedly ({status})"),
              }),
            );
          }
          Ok(None) => return Ok(()),
          Err(err) => return Err(format!("failed to poll bridge-host: {err}")),
        }
      }

      if guard.starting {
        drop(guard);
        thread::sleep(Duration::from_millis(40));
        continue;
      }
      guard.starting = true;
    }

    let start_result = (|| {
      let sidecar = resolve_sidecar_path()?;
      let mut child = Command::new(&sidecar)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
          format!(
            "failed to spawn bridge-host sidecar ({}): {e}",
            sidecar.display()
          )
        })?;

      let stdout = child.stdout.take().ok_or("bridge-host stdout missing")?;
      let stderr = child.stderr.take().ok_or("bridge-host stderr missing")?;
      let stdin = child.stdin.take().ok_or("bridge-host stdin missing")?;
      let alive = Arc::new(AtomicBool::new(true));
      let expecting_exit = Arc::new(AtomicBool::new(false));

      let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
      spawn_reader_threads(
        app.clone(),
        Arc::clone(state),
        stdout,
        stderr,
        ready_tx,
        Arc::clone(&expecting_exit),
      );

      match ready_rx.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
          expecting_exit.store(true, Ordering::SeqCst);
          let _ = child.kill();
          let _ = child.wait();
          alive.store(false, Ordering::SeqCst);
          return Err(err);
        }
        Err(_) => {
          expecting_exit.store(true, Ordering::SeqCst);
          let _ = child.kill();
          let _ = child.wait();
          alive.store(false, Ordering::SeqCst);
          return Err(format!(
            "bridge-host handshake timed out after {}s (no ready event)",
            STARTUP_TIMEOUT.as_secs()
          ));
        }
      }

      let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
      guard.process = Some(HostProcess {
        child,
        stdin,
        alive,
        expecting_exit,
      });
      Ok(())
    })();

    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    guard.starting = false;
    return start_result;
  }
}

fn write_cmd(state: &BridgeHost, cmd: Value) -> Result<(), String> {
  let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
  let host = guard
    .process
    .as_mut()
    .ok_or("bridge host is not running")?;
  if let Ok(Some(status)) = host.child.try_wait() {
    host.alive.store(false, Ordering::SeqCst);
    guard.process = None;
    return Err(format!("bridge-host exited unexpectedly ({status})"));
  }
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

/// Graceful shutdown with bounded wait, then kill. Idempotent.
pub fn shutdown_host(state: &BridgeHost) {
  let mut guard = match state.inner.lock() {
    Ok(g) => g,
    Err(_) => return,
  };
  let Some(mut host) = guard.process.take() else {
    return;
  };
  drop(guard);

  host.expecting_exit.store(true, Ordering::SeqCst);
  let _ = writeln!(
    host.stdin,
    "{}",
    json!({ "cmd": "shutdown", "protocolVersion": PROTOCOL_VERSION })
  );
  let _ = host.stdin.flush();
  // Drop stdin to signal EOF as well.
  drop(host.stdin);

  let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
  loop {
    match host.child.try_wait() {
      Ok(Some(_)) => {
        host.alive.store(false, Ordering::SeqCst);
        return;
      }
      Ok(None) if Instant::now() >= deadline => break,
      Ok(None) => thread::sleep(Duration::from_millis(50)),
      Err(_) => break,
    }
  }

  let _ = host.child.kill();
  let _ = host.child.wait();
  host.alive.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn bridge_ensure(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, &state)
}

#[tauri::command]
pub fn bridge_start(
  app: AppHandle,
  state: State<'_, Arc<BridgeHost>>,
  preferences: Option<Value>,
) -> Result<(), String> {
  ensure_host(&app, &state)?;
  let mut cmd = json!({ "cmd": "start", "protocolVersion": PROTOCOL_VERSION });
  if let Some(prefs) = preferences {
    cmd["preferences"] = prefs;
  }
  write_cmd(state.as_ref(), cmd)
}

#[tauri::command]
pub fn bridge_stop(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, &state)?;
  write_cmd(
    state.as_ref(),
    json!({ "cmd": "stop", "protocolVersion": PROTOCOL_VERSION }),
  )
}

#[tauri::command]
pub fn bridge_update_preferences(
  app: AppHandle,
  state: State<'_, Arc<BridgeHost>>,
  preferences: Value,
) -> Result<(), String> {
  ensure_host(&app, &state)?;
  write_cmd(
    state.as_ref(),
    json!({
      "cmd": "updatePreferences",
      "protocolVersion": PROTOCOL_VERSION,
      "preferences": preferences
    }),
  )
}

#[tauri::command]
pub fn bridge_get_state(app: AppHandle, state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  ensure_host(&app, &state)?;
  write_cmd(
    state.as_ref(),
    json!({ "cmd": "getState", "protocolVersion": PROTOCOL_VERSION }),
  )
}

#[tauri::command]
pub fn bridge_get_telemetry(state: State<'_, Arc<BridgeHost>>) -> Result<Option<Value>, String> {
  let guard = state
    .last_telemetry
    .lock()
    .map_err(|e| e.to_string())?;
  Ok(guard.clone())
}

#[tauri::command]
pub fn bridge_shutdown(state: State<'_, Arc<BridgeHost>>) -> Result<(), String> {
  shutdown_host(state.as_ref());
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::io::Write as IoWrite;
  use std::process::{Command, Stdio};

  fn fixture_host() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("../../..")
      .join("test")
      .join("fixtures")
      .join("fake-bridge-host.js")
  }

  fn node_bin() -> &'static str {
    "node"
  }

  #[test]
  fn resolve_sidecar_never_uses_node_path_lookup() {
    let src = fs::read_to_string(
      PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("bridge_host.rs"),
    )
    .expect("read bridge_host.rs");
    let production = src
      .split("#[cfg(test)]")
      .next()
      .expect("production section");
    assert!(
      !production.contains("fn which_node"),
      "PATH node lookup helper must be removed"
    );
    assert!(
      !production.contains("\"where\""),
      "must not shell out to where"
    );
    assert!(
      !production.contains("Command::new(\"node\")"),
      "production must not spawn node"
    );
    assert!(
      !production.contains("node.exe"),
      "production must not reference node.exe"
    );
    assert!(
      production.contains("SIDECAR_BASENAME"),
      "production must resolve the packaged sidecar"
    );
  }

  #[test]
  fn normalize_event_adds_protocol_version() {
    let value = normalize_event(json!({ "event": "ready" }));
    assert_eq!(value["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(value["type"], "ready");
  }

  #[test]
  fn event_name_accepts_type_or_event() {
    assert_eq!(event_name(&json!({ "type": "ready" })), Some("ready"));
    assert_eq!(event_name(&json!({ "event": "started" })), Some("started"));
  }

  #[test]
  fn fake_host_ready_handshake() {
    let script = fixture_host();
    assert!(script.exists(), "missing {}", script.display());

    let mut child = Command::new(node_bin())
      .arg(&script)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .expect("spawn fake host");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).expect("ready line");
    let value: Value = serde_json::from_str(line.trim()).expect("json");
    assert_eq!(event_name(&value), Some("ready"));
    assert_eq!(value["protocolVersion"], PROTOCOL_VERSION);

    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{}", json!({ "cmd": "shutdown" })).unwrap();
    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success());
  }

  #[test]
  fn fake_host_invalid_json_and_unknown_cmd() {
    let mut child = Command::new(node_bin())
      .arg(fixture_host())
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .expect("spawn fake host");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut stdin = child.stdin.take().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap(); // ready

    writeln!(stdin, "not-json").unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let err: Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(event_name(&err), Some("error"));
    assert!(err["message"].as_str().unwrap().contains("invalid json"));

    writeln!(stdin, "{}", json!({ "cmd": "nope" })).unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let unknown: Value = serde_json::from_str(line.trim()).unwrap();
    assert!(unknown["message"]
      .as_str()
      .unwrap()
      .contains("unknown cmd"));

    writeln!(stdin, "{}", json!({ "cmd": "shutdown" })).unwrap();
    let _ = child.wait();
  }

  #[test]
  fn fake_host_update_preferences_and_idempotent_stop() {
    let mut child = Command::new(node_bin())
      .arg(fixture_host())
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .expect("spawn fake host");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut stdin = child.stdin.take().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();

    writeln!(
      stdin,
      "{}",
      json!({ "cmd": "updatePreferences", "preferences": { "appearance": { "theme": "dark" } } })
    )
    .unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let updated: Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(event_name(&updated), Some("preferencesUpdated"));

    writeln!(stdin, "{}", json!({ "cmd": "stop" })).unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    assert_eq!(
      event_name(&serde_json::from_str::<Value>(line.trim()).unwrap()),
      Some("stopped")
    );

    writeln!(stdin, "{}", json!({ "cmd": "stop" })).unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    assert_eq!(
      event_name(&serde_json::from_str::<Value>(line.trim()).unwrap()),
      Some("stopped")
    );

    writeln!(stdin, "{}", json!({ "cmd": "shutdown" })).unwrap();
    let _ = child.wait();
  }

  #[test]
  fn fake_host_crash_mode_exits() {
    let mut child = Command::new(node_bin())
      .arg(fixture_host())
      .arg("--crash-after-ready")
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .expect("spawn fake host");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    assert_eq!(
      event_name(&serde_json::from_str::<Value>(line.trim()).unwrap()),
      Some("ready")
    );
    let status = child.wait().unwrap();
    assert!(!status.success());
  }

  #[test]
  fn fake_host_startup_hang_can_be_killed() {
    let mut child = Command::new(node_bin())
      .arg(fixture_host())
      .arg("--hang-before-ready")
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .expect("spawn fake host");

    thread::sleep(Duration::from_millis(100));
    match child.try_wait().unwrap() {
      None => {
        let _ = child.kill();
        let _ = child.wait();
      }
      Some(_) => panic!("hang mode should not exit immediately"),
    }
  }

  #[test]
  fn shutdown_without_process_is_idempotent() {
    let host = BridgeHost::default();
    shutdown_host(&host);
    shutdown_host(&host);
  }

  #[test]
  fn cache_protocol_payload_stores_telemetry_and_events() {
    let host = BridgeHost::default();
    cache_protocol_payload(
      &host,
      &json!({
        "type": "telemetry",
        "event": "telemetry",
        "payload": {
          "schemaVersion": 1,
          "flight": { "mach": 0.82 }
        }
      }),
    );
    cache_protocol_payload(
      &host,
      &json!({
        "type": "event",
        "event": "event",
        "payload": { "kind": "takeoff", "timestamp": 1 }
      }),
    );

    let telemetry = host.last_telemetry.lock().unwrap().clone().unwrap();
    assert_eq!(telemetry["schemaVersion"], 1);
    assert_eq!(telemetry["flight"]["mach"], 0.82);

    let event = host.last_flight_event.lock().unwrap().clone().unwrap();
    assert_eq!(event["kind"], "takeoff");
  }

  #[test]
  fn cache_ignores_incomplete_telemetry_payload() {
    let host = BridgeHost::default();
    cache_protocol_payload(&host, &json!({ "type": "telemetry", "event": "telemetry" }));
    assert!(host.last_telemetry.lock().unwrap().is_none());
  }

  #[test]
  fn mark_telemetry_stale_sets_error_flag() {
    let host = BridgeHost::default();
    cache_protocol_payload(
      &host,
      &json!({
        "type": "telemetry",
        "payload": {
          "stale": false,
          "connection": { "simconnect": "connected", "hid": "connected" }
        }
      }),
    );
    mark_telemetry_stale(&host);
    let telemetry = host.last_telemetry.lock().unwrap().clone().unwrap();
    assert_eq!(telemetry["stale"], true);
    assert_eq!(telemetry["connection"]["simconnect"], "error");
  }

  #[test]
  fn normalize_event_accepts_telemetry_type() {
    let value = normalize_event(json!({ "type": "telemetry", "payload": {} }));
    assert_eq!(value["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(value["event"], "telemetry");
    assert_eq!(event_name(&value), Some("telemetry"));
  }

  #[test]
  fn fake_host_emits_telemetry_on_get() {
    let mut child = Command::new(node_bin())
      .arg(fixture_host())
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .expect("spawn fake host");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut stdin = child.stdin.take().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();

    writeln!(stdin, "{}", json!({ "cmd": "getTelemetry" })).unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let msg: Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(event_name(&msg), Some("telemetry"));
    assert!(msg.get("payload").is_some());

    writeln!(stdin, "{}", json!({ "cmd": "shutdown" })).unwrap();
    let _ = child.wait();
  }
}
