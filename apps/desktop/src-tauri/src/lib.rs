use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

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

fn find_sidecar(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    // 1. Явный путь через переменную окружения
    if let Ok(env_path) = std::env::var("HARNESS_SIDECAR_PATH") {
        let p = PathBuf::from(&env_path);
        if p.exists() {
            let working_dir = p.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
            return Ok((p, working_dir));
        }
    }

    // 2. Каталог ресурсов Tauri (в установленном релизном бандле)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("sidecar.js"),
            resource_dir.join("resources").join("sidecar.js"),
            resource_dir.join("apps").join("core").join("dist").join("sidecar.js"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                let working_dir = candidate.parent().unwrap_or(&resource_dir).to_path_buf();
                return Ok((candidate, working_dir));
            }
        }
    }

    // 3. Каталог рядом с исполняемым файлом (portable / unpacked сборка)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("sidecar.js"),
                exe_dir.join("resources").join("sidecar.js"),
                exe_dir.join("apps").join("core").join("dist").join("sidecar.js"),
            ];
            for candidate in candidates {
                if candidate.exists() {
                    let working_dir = candidate.parent().unwrap_or(exe_dir).to_path_buf();
                    return Ok((candidate, working_dir));
                }
            }

            // Поднимаемся вверх от exe до корня монорепозитория
            let mut curr = exe_dir.to_path_buf();
            for _ in 0..6 {
                let candidate = curr.join("apps").join("core").join("dist").join("sidecar.js");
                if candidate.exists() {
                    return Ok((candidate, curr));
                }
                if !curr.pop() {
                    break;
                }
            }
        }
    }

    // 4. Текущая рабочая директория и подъем вверх (dev-режим)
    if let Ok(cwd) = std::env::current_dir() {
        let mut curr = cwd.clone();
        for _ in 0..6 {
            let candidate = curr.join("apps").join("core").join("dist").join("sidecar.js");
            if candidate.exists() {
                return Ok((candidate, curr));
            }
            let direct = curr.join("dist").join("sidecar.js");
            if direct.exists() {
                return Ok((direct, curr));
            }
            if !curr.pop() {
                break;
            }
        }
    }

    // 5. Относительные пути
    let relative_candidates = [
        PathBuf::from("../../../apps/core/dist/sidecar.js"),
        PathBuf::from("../../apps/core/dist/sidecar.js"),
        PathBuf::from("../apps/core/dist/sidecar.js"),
        PathBuf::from("apps/core/dist/sidecar.js"),
    ];
    for rel in relative_candidates {
        if rel.exists() {
            let working_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            return Ok((rel, working_dir));
        }
    }

    Err(
        "Не удалось найти sidecar.js. Убедитесь, что apps/core собран (`pnpm build`) или укажите путь через HARNESS_SIDECAR_PATH."
            .into(),
    )
}

#[tauri::command]
fn start_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if proc.child.is_some() {
        return Ok("Sidecar already running".into());
    }

    let (sidecar_path, working_dir) = find_sidecar(&app)?;

    let mut cmd = Command::new("node");
    cmd.arg(&sidecar_path);
    cmd.current_dir(&working_dir);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::inherit());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar at {:?}: {}", sidecar_path, e))?;
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

    Ok(format!("Sidecar started from {:?}", sidecar_path))
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
