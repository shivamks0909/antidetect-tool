// Clipboard auto-typing via CDP: Ctrl+Shift+E → type clipboard into active profile's focused field.

use crate::process::Tracker;
use crate::settings;
use anyhow::{Context, Result};

/// Identify which running profile owns the foreground window, then type
/// the clipboard text into its focused element via CDP.
pub async fn execute(clipboard_text: String) -> Result<String> {
    let cfg = settings::load()?.auto_type;
    if !cfg.enabled {
        anyhow::bail!("auto-type is disabled in settings");
    }
    if clipboard_text.trim().is_empty() {
        anyhow::bail!("clipboard is empty");
    }

    // 1. Find foreground window PID → match to a tracked profile.
    let fg_pid = foreground_pid()?;
    let profile_id = pid_to_profile(fg_pid)?;

    // 2. Get CDP WebSocket URL for that profile.
    let ws_url = Tracker::shared()
        .cdp(&profile_id)
        .map(|c| c.web_socket_debugger_url)
        .context("no CDP endpoint for this profile — was it launched without debugging?")?;

    // 3. Connect and type.
    type_via_cdp(&ws_url, &clipboard_text, &cfg).await?;

    Ok(profile_id)
}

// ---- Win32: foreground window → PID ----

#[cfg(windows)]
fn foreground_pid() -> Result<u32> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            anyhow::bail!("no foreground window");
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            anyhow::bail!("could not get PID of foreground window");
        }
        Ok(pid)
    }
}

#[cfg(not(windows))]
fn foreground_pid() -> Result<u32> {
    anyhow::bail!("auto-type is only supported on Windows");
}

// ---- PID → profile_id via Tracker ----

fn pid_to_profile(target_pid: u32) -> Result<String> {
    let running = Tracker::shared().running();
    // Direct PID match first.
    if let Some(r) = running.iter().find(|r| r.pid == target_pid) {
        return Ok(r.profile_id.clone());
    }
    // Chrome spawns child processes; walk up the tree via parent PID.
    #[cfg(windows)]
    {
        if let Some(parent) = parent_pid(target_pid) {
            if let Some(r) = running.iter().find(|r| r.pid == parent) {
                return Ok(r.profile_id.clone());
            }
            // One more level: renderer → browser → our tracked PID.
            if let Some(grandparent) = parent_pid(parent) {
                if let Some(r) = running.iter().find(|r| r.pid == grandparent) {
                    return Ok(r.profile_id.clone());
                }
            }
        }
    }
    anyhow::bail!(
        "foreground window (PID {target_pid}) does not belong to any tracked profile"
    );
}

#[cfg(windows)]
fn parent_pid(pid: u32) -> Option<u32> {
    use std::os::windows::process::CommandExt;
    // Use CreateToolhelp32Snapshot via a quick wmic call — avoids pulling in
    // the entire TlHelp32 feature set for one query.
    let out = std::process::Command::new("wmic")
        .args(["process", "where", &format!("ProcessId={pid}"), "get", "ParentProcessId"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let txt = String::from_utf8_lossy(&out.stdout);
    txt.lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .next()
}

// ---- CDP WebSocket typing ----

use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};

async fn type_via_cdp(
    ws_url: &str,
    text: &str,
    cfg: &settings::AutoTypeSettings,
) -> Result<()> {

    // Connect to the browser-level endpoint.
    let (ws, _) = connect_async(ws_url)
        .await
        .context("failed to connect to CDP WebSocket")?;
    let (mut tx, mut rx) = ws.split();

    // Get the first page target.
    let msg = serde_json::json!({
        "id": 1,
        "method": "Target.getTargets"
    });
    tx.send(Message::Text(msg.to_string().into())).await?;

    let page_target_id = loop {
        let Some(Ok(m)) = rx.next().await else {
            anyhow::bail!("CDP connection closed before getting targets");
        };
        if let Message::Text(t) = m {
            let v: serde_json::Value = serde_json::from_str(&t)?;
            if v["id"] == 1 {
                let targets = v["result"]["targetInfos"]
                    .as_array()
                    .context("no targetInfos")?;
                let page = targets
                    .iter()
                    .find(|t| t["type"] == "page")
                    .context("no page target found")?;
                break page["targetId"]
                    .as_str()
                    .context("no targetId")?
                    .to_string();
            }
        }
    };

    // Attach to the page target.
    let msg = serde_json::json!({
        "id": 2,
        "method": "Target.attachToTarget",
        "params": { "targetId": page_target_id, "flatten": true }
    });
    tx.send(Message::Text(msg.to_string().into())).await?;

    // Read the session ID from the attachedToTarget event.
    let session_id = loop {
        let Some(Ok(m)) = rx.next().await else {
            anyhow::bail!("CDP closed before attach");
        };
        if let Message::Text(t) = m {
            let v: serde_json::Value = serde_json::from_str(&t)?;
            if v["method"] == "Target.attachedToTarget" {
                break v["params"]["sessionId"]
                    .as_str()
                    .context("no sessionId")?
                    .to_string();
            }
        }
    };

    // Dispatch mode: paste uses Input.insertText; type uses per-character keyDown/keyUp.
    if cfg.mode == "paste" {
        let msg = serde_json::json!({
            "id": 10,
            "sessionId": session_id,
            "method": "Input.insertText",
            "params": { "text": text }
        });
        tx.send(Message::Text(msg.to_string().into())).await?;
        return Ok(());
    }

    // Type mode: character-by-character with random delays.
    let (min_ms, max_ms) = resolve_delays(cfg);
    let mut cmd_id = 10;

    for ch in text.chars() {
        let key_str = ch.to_string();

        // keyDown
        let msg = serde_json::json!({
            "id": cmd_id,
            "sessionId": session_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
                "type": "keyDown",
                "text": key_str,
                "key": key_str,
            }
        });
        tx.send(Message::Text(msg.to_string().into())).await?;
        cmd_id += 1;

        // keyUp
        let msg = serde_json::json!({
            "id": cmd_id,
            "sessionId": session_id,
            "method": "Input.dispatchKeyEvent",
            "params": {
                "type": "keyUp",
                "key": key_str,
            }
        });
        tx.send(Message::Text(msg.to_string().into())).await?;
        cmd_id += 1;

        // Inter-key delay.
        let delay = if cfg.random_delay && max_ms > min_ms {
            let range = max_ms - min_ms;
            let jitter = (uuid::Uuid::new_v4().as_bytes()[0] as u64) % range;
            min_ms + jitter
        } else {
            min_ms
        };
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
    }

    Ok(())
}

fn resolve_delays(cfg: &settings::AutoTypeSettings) -> (u64, u64) {
    match cfg.typing_speed.as_str() {
        "fast" => (30, 80),
        "slow" => (150, 350),
        _ => (cfg.min_delay_ms, cfg.max_delay_ms), // "normal" or custom
    }
}
