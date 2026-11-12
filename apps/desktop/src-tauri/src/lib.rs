use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct SidecarProcess {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
}

#[derive(Default)]
pub struct AppState {
    process: Arc<Mutex<SidecarProcess>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ApprovalMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "approvalId")]
    approval_id: String,
    decision: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct RunPromptMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    prompt: String,
    mode: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ConnectMcpMessage {
    #[serde(rename = "type")]
    msg_type: String,
    config: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
struct SimpleCommandMessage {
    #[serde(rename = "type")]
    msg_type: String,
}

#[tauri::command]
fn start_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if proc.child.is_some() {
        return Ok("Sidecar already running".into());
    }

    let mut cmd = Command::new("node");
    cmd.arg("../../apps/core/dist/sidecar.js");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::inherit());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to take stdout")?;
    let stdin = child.stdin.take().ok_or("Failed to take stdin")?;

    proc.child = Some(child);
    proc.stdin = Some(stdin);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                if !l.trim().is_empty() {
                    let _ = app_clone.emit("sidecar-event", l);
                }
            }
        }
    });

    Ok("Sidecar started".into())
}

#[tauri::command]
fn send_prompt(
    session_id: String,
    prompt: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = &mut proc.stdin {
        let msg = RunPromptMessage {
            msg_type: "run_prompt".into(),
            session_id,
            prompt,
            mode,
        };
        let serialized = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", serialized).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar stdin not available".into())
    }
}

#[tauri::command]
fn respond_approval(
    approval_id: String,
    decision: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = &mut proc.stdin {
        let msg = ApprovalMessage {
            msg_type: "approval_response".into(),
            approval_id,
            decision,
        };
        let serialized = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", serialized).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar stdin not available".into())
    }
}

#[tauri::command]
fn connect_mcp_server(
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = &mut proc.stdin {
        let msg = ConnectMcpMessage {
            msg_type: "connect_mcp".into(),
            config,
        };
        let serialized = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", serialized).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar stdin not available".into())
    }
}

#[tauri::command]
fn request_tools_list(state: State<'_, AppState>) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = &mut proc.stdin {
        let msg = SimpleCommandMessage {
            msg_type: "list_tools".into(),
        };
        let serialized = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", serialized).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar stdin not available".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            send_prompt,
            respond_approval,
            connect_mcp_server,
            request_tools_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
