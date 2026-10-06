use crate::{settings, store};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyKind {
    Socks5,
    Http,
    Https,
    Geolocation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub protocol: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub source_format: Option<String>,
    #[serde(default)]
    pub location_label: Option<String>,
    #[serde(default)]
    pub raw_input: Option<String>,
}

impl ProxyConfig {
    /// Safe string representation with credentials redacted as ****
    pub fn to_sanitized_string(&self) -> String {
        if self.username.is_some() || self.password.is_some() {
            format!("{}://****:****@{}:{}", self.protocol, self.host, self.port)
        } else {
            format!("{}://{}:{}", self.protocol, self.host, self.port)
        }
    }

    pub fn host_port(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn parse_url(raw: &str) -> std::result::Result<Self, String> {
        let entry = parse_one(raw, &ProxyKind::Http)
            .ok_or_else(|| "Failed to parse proxy URL".to_string())?;
        Ok(Self::from_entry(&entry))
    }

    pub fn from_entry(entry: &ProxyEntry) -> Self {
        let protocol = match entry.kind {
            ProxyKind::Socks5 => "socks5",
            ProxyKind::Http | ProxyKind::Geolocation => "http",
            ProxyKind::Https => "https",
        }
        .to_string();
        Self {
            protocol,
            host: entry.host.clone(),
            port: entry.port,
            username: if entry.username.is_empty() { None } else { Some(entry.username.clone()) },
            password: if entry.password.is_empty() { None } else { Some(entry.password.clone()) },
            source_format: entry.source_format.clone(),
            location_label: entry.location_label.clone(),
            raw_input: entry.raw_input.clone(),
        }
    }

    pub fn to_entry(&self) -> ProxyEntry {
        let kind = match self.source_format.as_deref() {
            Some("geolocation") => ProxyKind::Geolocation,
            _ => match self.protocol.to_lowercase().as_str() {
                "socks5" => ProxyKind::Socks5,
                "https" => ProxyKind::Https,
                _ => ProxyKind::Http,
            },
        };
        ProxyEntry {
            id: String::new(),
            name: format!("{}:{}", self.host, self.port),
            kind,
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone().unwrap_or_default(),
            password: self.password.clone().unwrap_or_default(),
            country: String::new(),
            notes: String::new(),
            source_format: self.source_format.clone(),
            location_label: self.location_label.clone(),
            raw_input: self.raw_input.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProxyErrorCategory {
    Success,
    InvalidProxyUrl,
    InvalidCredentialsFormat,
    DnsFailure,
    TcpConnectionFailed,
    ConnectionTimeout,
    ProxyAuthFailed,
    HttpProxyRequestFailed,
    HttpsConnectFailed,
    TlsHandshakeFailed,
    TargetConnectionFailed,
    TargetTimeout,
    ConnectionReset,
    ProxyReturned4xx,
    ProxyReturned5xx,
}

impl ProxyErrorCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "SUCCESS",
            Self::InvalidProxyUrl => "INVALID_PROXY_URL",
            Self::InvalidCredentialsFormat => "INVALID_CREDENTIALS_FORMAT",
            Self::DnsFailure => "DNS_FAILURE",
            Self::TcpConnectionFailed => "TCP_CONNECTION_FAILED",
            Self::ConnectionTimeout => "CONNECTION_TIMEOUT",
            Self::ProxyAuthFailed => "PROXY_AUTH_FAILED",
            Self::HttpProxyRequestFailed => "HTTP_PROXY_REQUEST_FAILED",
            Self::HttpsConnectFailed => "HTTPS_CONNECT_FAILED",
            Self::TlsHandshakeFailed => "TLS_HANDSHAKE_FAILED",
            Self::TargetConnectionFailed => "TARGET_CONNECTION_FAILED",
            Self::TargetTimeout => "TARGET_TIMEOUT",
            Self::ConnectionReset => "CONNECTION_RESET",
            Self::ProxyReturned4xx => "PROXY_RETURNED_4XX",
            Self::ProxyReturned5xx => "PROXY_RETURNED_5XX",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTestResult {
    pub proxy_id: String,
    pub success: bool,
    pub protocol: String,
    pub host_port: String,
    pub latency_ms: Option<u64>,
    pub total_time_ms: Option<u64>,
    pub error_category: ProxyErrorCategory,
    pub status_code: Option<u16>,
    pub test_type: String,
    pub tested_at: String,
    pub retry_count: u32,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTimeouts {
    pub tcp_connect_ms: u64,
    pub auth_handshake_ms: u64,
    pub connect_tunnel_ms: u64,
    pub tls_handshake_ms: u64,
    pub target_response_ms: u64,
}

impl Default for ProxyTimeouts {
    fn default() -> Self {
        Self {
            tcp_connect_ms: 5000,
            auth_handshake_ms: 8000,
            connect_tunnel_ms: 8000,
            tls_handshake_ms: 8000,
            target_response_ms: 10000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProxyHealthState {
    Healthy,
    TemporarilyFailed,
    AuthFailed,
    Dead,
    Cooldown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyHealth {
    pub proxy_id: String,
    pub state: ProxyHealthState,
    pub consecutive_failures: u32,
    pub last_tested_at: Option<String>,
    pub last_success_at: Option<String>,
    pub cooldown_until_unix: Option<u64>,
    pub last_error: Option<ProxyErrorCategory>,
}

#[derive(Debug, Default, Clone)]
pub struct ProxyPool {
    proxies: Vec<ProxyEntry>,
    health_map: HashMap<String, ProxyHealth>,
    cursor: usize,
}

impl ProxyPool {
    pub fn new(proxies: Vec<ProxyEntry>) -> Self {
        let mut health_map = HashMap::new();
        for p in &proxies {
            health_map.insert(
                p.id.clone(),
                ProxyHealth {
                    proxy_id: p.id.clone(),
                    state: ProxyHealthState::Healthy,
                    consecutive_failures: 0,
                    last_tested_at: None,
                    last_success_at: None,
                    cooldown_until_unix: None,
                    last_error: None,
                },
            );
        }
        Self {
            proxies,
            health_map,
            cursor: 0,
        }
    }

    pub fn get_next_healthy(&mut self, now_unix: u64) -> Option<ProxyEntry> {
        if self.proxies.is_empty() {
            return None;
        }
        let total = self.proxies.len();
        for _ in 0..total {
            let idx = self.cursor % total;
            self.cursor = (self.cursor + 1) % total;
            let candidate = &self.proxies[idx];
            if let Some(h) = self.health_map.get_mut(&candidate.id) {
                if h.state == ProxyHealthState::Cooldown {
                    if let Some(until) = h.cooldown_until_unix {
                        if now_unix >= until {
                            h.state = ProxyHealthState::TemporarilyFailed;
                        }
                    }
                }
                if matches!(h.state, ProxyHealthState::Healthy | ProxyHealthState::TemporarilyFailed) {
                    return Some(candidate.clone());
                }
            }
        }
        None
    }

    pub fn record_result(&mut self, proxy_id: &str, result: &ProxyTestResult, now_unix: u64) {
        if let Some(h) = self.health_map.get_mut(proxy_id) {
            h.last_tested_at = Some(result.tested_at.clone());
            if result.success {
                h.state = ProxyHealthState::Healthy;
                h.consecutive_failures = 0;
                h.cooldown_until_unix = None;
                h.last_success_at = Some(result.tested_at.clone());
                h.last_error = None;
            } else {
                h.last_error = Some(result.error_category);
                match result.error_category {
                    ProxyErrorCategory::ProxyAuthFailed => {
                        h.state = ProxyHealthState::AuthFailed;
                    }
                    ProxyErrorCategory::TargetTimeout | ProxyErrorCategory::TargetConnectionFailed => {
                        h.state = ProxyHealthState::TemporarilyFailed;
                        h.cooldown_until_unix = Some(now_unix + 5);
                    }
                    _ => {
                        h.consecutive_failures += 1;
                        if h.consecutive_failures >= 5 {
                            h.state = ProxyHealthState::Dead;
                        } else {
                            h.state = ProxyHealthState::Cooldown;
                            let backoff = std::cmp::min(300, 5 * (2u64.pow(h.consecutive_failures - 1)));
                            h.cooldown_until_unix = Some(now_unix + backoff);
                        }
                    }
                }
            }
        }
    }

    pub fn evict(&mut self, proxy_id: &str) {
        self.proxies.retain(|p| p.id != proxy_id);
        self.health_map.remove(proxy_id);
    }

    pub fn reset_pool(&mut self) {
        for h in self.health_map.values_mut() {
            if h.state != ProxyHealthState::Dead && h.state != ProxyHealthState::AuthFailed {
                h.state = ProxyHealthState::Healthy;
                h.consecutive_failures = 0;
                h.cooldown_until_unix = None;
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyEntry {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    /// "PL", "US", …
    #[serde(default)]
    pub country: String,
    /// Free-form note.
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub source_format: Option<String>,
    #[serde(default)]
    pub location_label: Option<String>,
    #[serde(default)]
    pub raw_input: Option<String>,
}

impl ProxyEntry {
    /// Build `--proxy-server=<scheme>://[user:pass@]host:port`.
    /// SOCKS5: credentials embedded in URL (Chromium handles natively).
    /// HTTP/HTTPS/Geolocation: credentials stripped — use CDP Fetch domain for auth.
    pub fn to_proxy_server_arg(&self) -> String {
        let scheme = match self.kind {
            ProxyKind::Socks5 => "socks5",
            ProxyKind::Http | ProxyKind::Geolocation => "http",
            ProxyKind::Https => "https",
        };
        let host_port = format!("{}:{}", self.host, self.port);

        if matches!(self.kind, ProxyKind::Socks5)
            && (!self.username.is_empty() || !self.password.is_empty())
        {
            let user = url::form_urlencoded::byte_serialize(self.username.as_bytes())
                .collect::<String>();
            let pass = url::form_urlencoded::byte_serialize(self.password.as_bytes())
                .collect::<String>();
            format!("{scheme}://{user}:{pass}@{host_port}")
        } else {
            format!("{scheme}://{host_port}")
        }
    }

    /// Whether this proxy has authentication credentials.
    pub fn has_credentials(&self) -> bool {
        !self.username.is_empty() || !self.password.is_empty()
    }

    pub fn to_config(&self) -> ProxyConfig {
        ProxyConfig {
            protocol: match self.kind {
                ProxyKind::Socks5 => "socks5".to_string(),
                ProxyKind::Http | ProxyKind::Geolocation => "http".to_string(),
                ProxyKind::Https => "https".to_string(),
            },
            host: self.host.clone(),
            port: self.port,
            username: if self.username.is_empty() { None } else { Some(self.username.clone()) },
            password: if self.password.is_empty() { None } else { Some(self.password.clone()) },
            source_format: self.source_format.clone(),
            location_label: self.location_label.clone(),
            raw_input: self.raw_input.clone(),
        }
    }

    pub fn host_port(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn sanitized_label(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

impl Default for ProxyEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: ProxyKind::Http,
            host: String::new(),
            port: 8080,
            username: String::new(),
            password: String::new(),
            country: String::new(),
            notes: String::new(),
            source_format: None,
            location_label: None,
            raw_input: None,
        }
    }
}

// ---- Profile-Scoped Runtime Proxy Authentication Extension ----
/// Subdirectory name inside `<udd>` where the ephemeral proxy authentication extension resides.
pub const PROXY_AUTH_EXT_DIR: &str = "proxy_auth_ext";

/// Generate or refresh a profile-scoped Manifest V3 extension in `<udd>/proxy_auth_ext`
/// that answers proxy 407 authentication challenges synchronously via `chrome.webRequest.onAuthRequired`.
/// This supplies credentials at the Chromium network layer with zero native "Sign in" popup.
pub fn create_proxy_auth_extension(udd: &Path, proxy: &ProxyEntry) -> Result<PathBuf> {
    let ext_dir = udd.join(PROXY_AUTH_EXT_DIR);
    fs::create_dir_all(&ext_dir).context("failed to create proxy auth extension directory")?;

    let manifest = serde_json::json!({
        "name": "Proxy Authentication Handler",
        "version": "1.0.0",
        "manifest_version": 3,
        "permissions": [
            "webRequest",
            "webRequestAuthProvider"
        ],
        "host_permissions": [
            "<all_urls>"
        ],
        "background": {
            "service_worker": "background.js"
        }
    });

    let manifest_body = serde_json::to_string_pretty(&manifest)?;
    fs::write(ext_dir.join("manifest.json"), manifest_body)
        .context("failed to write proxy auth manifest.json")?;

    let u_json = serde_json::to_string(&proxy.username).unwrap_or_else(|_| "\"\"".into());
    let p_json = serde_json::to_string(&proxy.password).unwrap_or_else(|_| "\"\"".into());
    let h_json = serde_json::to_string(&proxy.host).unwrap_or_else(|_| "\"\"".into());

    let background_js = format!(
        r#"// Profile-scoped proxy authentication handler
const USERNAME = {u_json};
const PASSWORD = {p_json};
const PROXY_HOST = {h_json};

let attempts = 0;

chrome.webRequest.onAuthRequired.addListener(
  function(details, asyncCallback) {{
    if (details.isProxy) {{
      attempts++;
      if (attempts > 3) {{
        // Cancel challenge if proxy authentication keeps failing, blocking the modal popup
        asyncCallback({{ cancel: true }});
        return;
      }}
      asyncCallback({{
        authCredentials: {{
          username: USERNAME,
          password: PASSWORD
        }}
      }});
    }} else {{
      asyncCallback({{}});
    }}
  }},
  {{ urls: ["<all_urls>"] }},
  ["asyncBlocking"]
);
"#
    );

    fs::write(ext_dir.join("background.js"), background_js)
        .context("failed to write proxy auth background.js")?;

    Ok(ext_dir)
}

/// Remove the ephemeral proxy authentication extension if proxy credentials are no longer needed.
pub fn remove_proxy_auth_extension(udd: &Path) -> Result<()> {
    let ext_dir = udd.join(PROXY_AUTH_EXT_DIR);
    if ext_dir.exists() {
        let _ = fs::remove_dir_all(&ext_dir);
    }
    Ok(())
}

// ---- CDP Fetch-domain proxy authentication ----
// When Chromium hits a 407 from an HTTP/HTTPS proxy, it fires a
// Fetch.authRequired CDP event. We answer with stored credentials so
// the user never sees the native auth popup.
//
// Uses Target.setAutoAttach (flatten: true) so all tabs / frames receive Fetch.enable.

/// Spawn a long-lived CDP event loop that answers proxy auth challenges.
/// Non-blocking: the handler runs on the Tokio runtime.
pub fn spawn_proxy_auth_handler(ws_url: String, proxy: ProxyEntry) {
    tokio::spawn(async move {
        if let Err(e) = proxy_auth_loop(&ws_url, &proxy).await {
            eprintln!("[proxy-auth] handler exited: {e:#}");
        }
    });
}

async fn proxy_auth_loop(ws_url: &str, proxy: &ProxyEntry) -> Result<()> {
    let (ws, _) = connect_async(ws_url)
        .await
        .context("failed to connect to CDP for proxy auth")?;
    let (mut tx, mut rx) = ws.split();

    // Enable Fetch domain on root target with patterns: [] so ordinary network traffic is never paused
    tx.send(Message::Text(
        serde_json::json!({
            "id": 1,
            "method": "Fetch.enable",
            "params": {
                "patterns": [],
                "handleAuthRequests": true
            }
        })
        .to_string()
        .into(),
    ))
    .await?;

    // Enable auto-attach across all pages, frames, and workers with flatten: true
    tx.send(Message::Text(
        serde_json::json!({
            "id": 2,
            "method": "Target.setAutoAttach",
            "params": {
                "autoAttach": true,
                "waitForDebuggerOnStart": false,
                "flatten": true
            }
        })
        .to_string()
        .into(),
    ))
    .await?;

    eprintln!("[proxy-auth] handler started for {}:{}", proxy.host, proxy.port);

    let mut next_id = 3u32;
    let mut auth_attempts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    while let Some(Ok(msg)) = rx.next().await {
        if let Message::Text(text) = msg {
            let v: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let session_id = v.get("sessionId").and_then(|s| s.as_str());

            if v["method"] == "Target.attachedToTarget" {
                if let Some(sid) = v["params"]["sessionId"].as_str() {
                    let req = serde_json::json!({
                        "id": next_id,
                        "sessionId": sid,
                        "method": "Fetch.enable",
                        "params": {
                            "patterns": [],
                            "handleAuthRequests": true
                        }
                    });
                    next_id += 1;
                    let _ = tx.send(Message::Text(req.to_string().into())).await;
                }
            } else if v["method"] == "Fetch.authRequired" {
                let req_id = v["params"]["requestId"].as_str().unwrap_or("").to_string();
                let attempts = auth_attempts.entry(req_id.clone()).or_insert(0);
                *attempts += 1;

                let auth_response = if *attempts > 3 {
                    eprintln!("[proxy-auth] auth failed/looping ({attempts} attempts) for {req_id}; canceling challenge to block popup dialog");
                    serde_json::json!({
                        "response": "CancelAuth"
                    })
                } else {
                    eprintln!("[proxy-auth] answering auth challenge for request {req_id} (attempt {attempts})");
                    serde_json::json!({
                        "response": "ProvideCredentials",
                        "username": proxy.username,
                        "password": proxy.password
                    })
                };

                let mut resp = serde_json::json!({
                    "id": next_id,
                    "method": "Fetch.continueWithAuth",
                    "params": {
                        "requestId": req_id,
                        "authChallengeResponse": auth_response
                    }
                });
                if let Some(sid) = session_id {
                    resp["sessionId"] = serde_json::Value::String(sid.to_string());
                }
                next_id += 1;
                let _ = tx.send(Message::Text(resp.to_string().into())).await;
            } else if v["method"] == "Fetch.requestPaused" {
                let req_id = v["params"]["requestId"].as_str().unwrap_or("");
                let mut resp = serde_json::json!({
                    "id": next_id,
                    "method": "Fetch.continueRequest",
                    "params": { "requestId": req_id }
                });
                if let Some(sid) = session_id {
                    resp["sessionId"] = serde_json::Value::String(sid.to_string());
                }
                next_id += 1;
                let _ = tx.send(Message::Text(resp.to_string().into())).await;
            }
        }
    }

    anyhow::bail!("CDP connection closed — proxy auth handler stopped")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyStore {
    #[serde(default)]
    pub proxies: Vec<ProxyEntry>,
}

pub fn load() -> Result<ProxyStore> {
    let path = store::proxies_path()?;
    if !path.exists() {
        return Ok(ProxyStore::default());
    }
    let body = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&body).unwrap_or_default())
}

fn save(s: &ProxyStore) -> Result<()> {
    let body = serde_json::to_string_pretty(s)?;
    fs::write(store::proxies_path()?, body)?;
    Ok(())
}

pub fn list() -> Result<Vec<ProxyEntry>> {
    Ok(load()?.proxies)
}

pub fn upsert(mut entry: ProxyEntry) -> Result<ProxyEntry> {
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    let mut s = load()?;
    if let Some(slot) = s.proxies.iter_mut().find(|p| p.id == entry.id) {
        *slot = entry.clone();
    } else {
        s.proxies.push(entry.clone());
    }
    save(&s)?;
    Ok(entry)
}

/// Upsert that reuses an entry with the same kind/host/port/username.
pub fn upsert_dedup(mut entry: ProxyEntry) -> Result<ProxyEntry> {
    let mut s = load()?;
    if let Some(existing) = s.proxies.iter().find(|p| {
        p.kind == entry.kind
            && p.host == entry.host
            && p.port == entry.port
            && p.username == entry.username
    }) {
        return Ok(existing.clone());
    }
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    s.proxies.push(entry.clone());
    save(&s)?;
    Ok(entry)
}

pub fn delete(id: &str) -> Result<()> {
    let mut s = load()?;
    s.proxies.retain(|p| p.id != id);
    save(&s)?;
    let mut hs = load_history()?;
    if hs.by_proxy.remove(id).is_some() {
        save_history(&hs)?;
    }
    Ok(())
}

pub fn get(id: &str) -> Result<Option<ProxyEntry>> {
    Ok(load()?.proxies.into_iter().find(|p| p.id == id))
}

/// SOCKS5/HTTP CONNECT probe; returns RTT in ms on success.
pub async fn probe(entry: &ProxyEntry) -> Result<u128> {
    let started = Instant::now();
    let addr = format!("{}:{}", entry.host, entry.port);
    let mut stream = timeout(Duration::from_secs(8), TcpStream::connect(&addr))
        .await
        .context("connect timeout")??;

    match entry.kind {
        ProxyKind::Socks5 => {
            let auth_method: u8 = if entry.username.is_empty() { 0x00 } else { 0x02 };
            stream.write_all(&[0x05, 0x01, auth_method]).await?;
            let mut resp = [0u8; 2];
            stream.read_exact(&mut resp).await?;
            if resp[0] != 0x05 {
                anyhow::bail!("not SOCKS5");
            }
            if resp[1] == 0xFF {
                anyhow::bail!("no acceptable auth method");
            }
            if auth_method == 0x02 {
                let mut buf = vec![0x01u8];
                buf.push(entry.username.len() as u8);
                buf.extend_from_slice(entry.username.as_bytes());
                buf.push(entry.password.len() as u8);
                buf.extend_from_slice(entry.password.as_bytes());
                stream.write_all(&buf).await?;
                let mut auth_resp = [0u8; 2];
                stream.read_exact(&mut auth_resp).await?;
                if auth_resp[1] != 0x00 {
                    anyhow::bail!("auth failed");
                }
            }
        }
        ProxyKind::Http | ProxyKind::Https | ProxyKind::Geolocation => {
            let mut req = String::from(
                "CONNECT example.com:443 HTTP/1.1\r\n\
                 Host: example.com:443\r\n",
            );
            if !entry.username.is_empty() || !entry.password.is_empty() {
                let creds = format!("{}:{}", entry.username, entry.password);
                let encoded = STANDARD.encode(creds.as_bytes());
                req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
            }
            req.push_str("Proxy-Connection: keep-alive\r\n\r\n");
            stream.write_all(req.as_bytes()).await?;

            let mut buf = Vec::with_capacity(512);
            let mut tmp = [0u8; 256];
            let head: String = loop {
                let n = timeout(Duration::from_secs(8), stream.read(&mut tmp))
                    .await
                    .context("read timeout")??;
                if n == 0 { break String::from_utf8_lossy(&buf).to_string(); }
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 4096 {
                    break String::from_utf8_lossy(&buf).to_string();
                }
            };
            let first_line = head.lines().next().unwrap_or("");
            if !first_line.starts_with("HTTP/1.1 200") && !first_line.starts_with("HTTP/1.0 200") {
                anyhow::bail!("CONNECT failed: {first_line}");
            }
        }
    }
    Ok(started.elapsed().as_millis())
}

// ---- Multi-Stage Diagnostic Layer ----

/// Complete multi-stage proxy diagnostic runner with failure classification
pub async fn diagnose_proxy(
    entry: &ProxyEntry,
    target_url: &str,
    timeouts: &ProxyTimeouts,
    debug: bool,
    proxy_index: Option<usize>,
) -> ProxyTestResult {
    let tested_at = unix_now();
    let idx_label = proxy_index
        .map(|i| format!("[proxy #{i}] "))
        .unwrap_or_else(|| "[proxy] ".to_string());
    let host_port = format!("{}:{}", entry.host, entry.port);
    let proto_str = match entry.kind {
        ProxyKind::Socks5 => "socks5",
        ProxyKind::Http | ProxyKind::Geolocation => "http",
        ProxyKind::Https => "https",
    }
    .to_string();

    let start_total = Instant::now();

    // 0. Parameter and URL validation
    if entry.host.trim().is_empty() || entry.port == 0 {
        if debug {
            eprintln!("{idx_label}{host_port}\n{idx_label}error: INVALID_PROXY_URL");
        }
        return ProxyTestResult {
            proxy_id: entry.id.clone(),
            success: false,
            protocol: proto_str,
            host_port,
            latency_ms: None,
            total_time_ms: Some(start_total.elapsed().as_millis() as u64),
            error_category: ProxyErrorCategory::InvalidProxyUrl,
            status_code: None,
            test_type: "VALIDATION".into(),
            tested_at,
            retry_count: 0,
            details: Some("Proxy host cannot be empty and port must be between 1 and 65535".into()),
        };
    }

    if debug {
        eprintln!("{idx_label}{host_port}");
    }

    // 1. DNS Resolution Stage
    let addr_str = format!("{}:{}", entry.host, entry.port);
    let socket_addrs = match tokio::net::lookup_host(&addr_str).await {
        Ok(addrs) => addrs.collect::<Vec<_>>(),
        Err(e) => {
            if debug {
                eprintln!("{idx_label}DNS resolution: FAILED\n{idx_label}error: DNS_FAILURE");
            }
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: None,
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::DnsFailure,
                status_code: None,
                test_type: "DNS".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("DNS resolution failed for host: {e}")),
            };
        }
    };

    if socket_addrs.is_empty() {
        if debug {
            eprintln!("{idx_label}DNS resolution: FAILED (no IP resolved)\n{idx_label}error: DNS_FAILURE");
        }
        return ProxyTestResult {
            proxy_id: entry.id.clone(),
            success: false,
            protocol: proto_str,
            host_port,
            latency_ms: None,
            total_time_ms: Some(start_total.elapsed().as_millis() as u64),
            error_category: ProxyErrorCategory::DnsFailure,
            status_code: None,
            test_type: "DNS".into(),
            tested_at,
            retry_count: 0,
            details: Some("DNS resolution returned empty address list".into()),
        };
    }

    // 2. TCP Connectivity Stage
    let tcp_start = Instant::now();
    let tcp_stream = match timeout(
        Duration::from_millis(timeouts.tcp_connect_ms),
        TcpStream::connect(&socket_addrs[..]),
    )
    .await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            if debug {
                eprintln!("{idx_label}TCP connection: FAILED ({e})\n{idx_label}error: TCP_CONNECTION_FAILED");
            }
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: None,
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::TcpConnectionFailed,
                status_code: None,
                test_type: "TCP".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("TCP connect failed: {e}")),
            };
        }
        Err(_) => {
            if debug {
                eprintln!("{idx_label}TCP connection: TIMEOUT\n{idx_label}error: CONNECTION_TIMEOUT");
            }
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: None,
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::ConnectionTimeout,
                status_code: None,
                test_type: "TCP".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("TCP connect timed out after {}ms", timeouts.tcp_connect_ms)),
            };
        }
    };
    let tcp_latency = tcp_start.elapsed().as_millis() as u64;
    if debug {
        eprintln!("{idx_label}TCP connection: OK");
    }

    // Resolve target URL attributes
    let target = if target_url.trim().is_empty() {
        "https://example.com/"
    } else {
        target_url.trim()
    };
    let parsed_target = url::Url::parse(target).unwrap_or_else(|_| url::Url::parse("https://example.com/").unwrap());
    let target_host = parsed_target.host_str().unwrap_or("example.com");
    let target_port = parsed_target.port_or_known_default().unwrap_or(443);
    let is_https = parsed_target.scheme() == "https";

    // 3. Handshake & Tunnel Authentication Stage
    let mut stream = tcp_stream;
    if matches!(entry.kind, ProxyKind::Socks5) {
        let auth_method: u8 = if entry.username.is_empty() { 0x00 } else { 0x02 };
        if let Err(e) = stream.write_all(&[0x05, 0x01, auth_method]).await {
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::ConnectionReset,
                status_code: None,
                test_type: "SOCKS5_GREETING".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("Failed to write SOCKS5 greeting: {e}")),
            };
        }
        let mut resp = [0u8; 2];
        match timeout(Duration::from_millis(timeouts.auth_handshake_ms), stream.read_exact(&mut resp)).await {
            Ok(Ok(_)) => {
                if resp[0] != 0x05 || resp[1] == 0xFF {
                    if debug {
                        eprintln!("{idx_label}authentication: FAILED\n{idx_label}error: PROXY_AUTH_FAILED");
                    }
                    return ProxyTestResult {
                        proxy_id: entry.id.clone(),
                        success: false,
                        protocol: proto_str,
                        host_port,
                        latency_ms: Some(tcp_latency),
                        total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                        error_category: ProxyErrorCategory::ProxyAuthFailed,
                        status_code: None,
                        test_type: "SOCKS5_AUTH".into(),
                        tested_at,
                        retry_count: 0,
                        details: Some("No acceptable authentication method supported by proxy".into()),
                    };
                }
            }
            Ok(Err(e)) => {
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ConnectionReset,
                    status_code: None,
                    test_type: "SOCKS5_GREETING".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("SOCKS5 greeting read error: {e}")),
                };
            }
            Err(_) => {
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ConnectionTimeout,
                    status_code: None,
                    test_type: "SOCKS5_GREETING".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("SOCKS5 greeting read timed out".into()),
                };
            }
        }
        if auth_method == 0x02 {
            let mut buf = vec![0x01u8];
            buf.push(entry.username.len() as u8);
            buf.extend_from_slice(entry.username.as_bytes());
            buf.push(entry.password.len() as u8);
            buf.extend_from_slice(entry.password.as_bytes());
            let _ = stream.write_all(&buf).await;
            let mut ar = [0u8; 2];
            match timeout(Duration::from_millis(timeouts.auth_handshake_ms), stream.read_exact(&mut ar)).await {
                Ok(Ok(_)) => {
                    if ar[1] != 0x00 {
                        if debug {
                            eprintln!("{idx_label}authentication: FAILED\n{idx_label}error: PROXY_AUTH_FAILED");
                        }
                        return ProxyTestResult {
                            proxy_id: entry.id.clone(),
                            success: false,
                            protocol: proto_str,
                            host_port,
                            latency_ms: Some(tcp_latency),
                            total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                            error_category: ProxyErrorCategory::ProxyAuthFailed,
                            status_code: None,
                            test_type: "SOCKS5_AUTH".into(),
                            tested_at,
                            retry_count: 0,
                            details: Some("SOCKS5 user/pass authentication rejected".into()),
                        };
                    }
                }
                Ok(Err(e)) => {
                    return ProxyTestResult {
                        proxy_id: entry.id.clone(),
                        success: false,
                        protocol: proto_str,
                        host_port,
                        latency_ms: Some(tcp_latency),
                        total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                        error_category: ProxyErrorCategory::ConnectionReset,
                        status_code: None,
                        test_type: "SOCKS5_AUTH".into(),
                        tested_at,
                        retry_count: 0,
                        details: Some(format!("SOCKS5 auth read error: {e}")),
                    };
                }
                Err(_) => {
                    return ProxyTestResult {
                        proxy_id: entry.id.clone(),
                        success: false,
                        protocol: proto_str,
                        host_port,
                        latency_ms: Some(tcp_latency),
                        total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                        error_category: ProxyErrorCategory::ConnectionTimeout,
                        status_code: None,
                        test_type: "SOCKS5_AUTH".into(),
                        tested_at,
                        retry_count: 0,
                        details: Some("SOCKS5 auth read timed out".into()),
                    };
                }
            }
        }
        if debug {
            eprintln!("{idx_label}authentication: OK");
            eprintln!("{idx_label}CONNECT: OK");
        }
    } else {
        // HTTP / HTTPS / Geolocation CONNECT tunnel probe
        let mut req = format!("CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n");
        if !entry.username.is_empty() || !entry.password.is_empty() {
            let creds = format!("{}:{}", entry.username, entry.password);
            let encoded = STANDARD.encode(creds.as_bytes());
            req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
        }
        req.push_str("Proxy-Connection: keep-alive\r\n\r\n");
        if let Err(e) = stream.write_all(req.as_bytes()).await {
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::ConnectionReset,
                status_code: None,
                test_type: "CONNECT".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("Write CONNECT failed: {e}")),
            };
        }

        let mut buf = Vec::with_capacity(512);
        let mut tmp = [0u8; 256];
        let head_res = loop {
            match timeout(Duration::from_millis(timeouts.connect_tunnel_ms), stream.read(&mut tmp)).await {
                Ok(Ok(n)) => {
                    if n == 0 {
                        break Ok(String::from_utf8_lossy(&buf).to_string());
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 4096 {
                        break Ok(String::from_utf8_lossy(&buf).to_string());
                    }
                }
                Ok(Err(_)) => break Err(ProxyErrorCategory::ConnectionReset),
                Err(_) => break Err(ProxyErrorCategory::ConnectionTimeout),
            }
        };

        let head = match head_res {
            Ok(h) => h,
            Err(cat) => {
                if debug {
                    eprintln!("{idx_label}CONNECT: FAILED\n{idx_label}error: {}", cat.as_str());
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: cat,
                    status_code: None,
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("Failed to read CONNECT response headers".into()),
                };
            }
        };

        let first_line = head.lines().next().unwrap_or("").trim();
        let status_code: Option<u16> = first_line.split_whitespace().nth(1).and_then(|s| s.parse().ok());

        if let Some(code) = status_code {
            if code == 407 {
                if debug {
                    eprintln!("{idx_label}authentication: FAILED\n{idx_label}error: PROXY_AUTH_FAILED");
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ProxyAuthFailed,
                    status_code: Some(407),
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("HTTP 407 Proxy Authentication Required".into()),
                };
            } else if code == 403 {
                if debug {
                    eprintln!("{idx_label}authentication: FAILED\n{idx_label}error: PROXY_AUTH_FAILED");
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ProxyAuthFailed,
                    status_code: Some(403),
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("HTTP 403 Forbidden by proxy administrative rules".into()),
                };
            } else if code >= 400 && code < 500 {
                if debug {
                    eprintln!("{idx_label}CONNECT: FAILED (HTTP {code})\n{idx_label}error: PROXY_RETURNED_4XX");
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ProxyReturned4xx,
                    status_code: Some(code),
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("Proxy returned HTTP {code}")),
                };
            } else if code >= 500 {
                if debug {
                    eprintln!("{idx_label}CONNECT: FAILED (HTTP {code})\n{idx_label}error: PROXY_RETURNED_5XX");
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::ProxyReturned5xx,
                    status_code: Some(code),
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("Proxy returned HTTP {code}")),
                };
            } else if code != 200 {
                if debug {
                    eprintln!("{idx_label}CONNECT: FAILED (status {code})\n{idx_label}error: HTTPS_CONNECT_FAILED");
                }
                return ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                    error_category: ProxyErrorCategory::HttpsConnectFailed,
                    status_code: Some(code),
                    test_type: "CONNECT".into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("Unexpected CONNECT status: {code}")),
                };
            }
        } else {
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::HttpsConnectFailed,
                status_code: None,
                test_type: "CONNECT".into(),
                tested_at,
                retry_count: 0,
                details: Some("Unrecognized CONNECT response header".into()),
            };
        }

        if debug {
            eprintln!("{idx_label}authentication: OK");
            eprintln!("{idx_label}CONNECT: OK");
        }
    }
    drop(stream);

    // 4. Functional Target Request via reqwest with strict no_proxy precedence
    let scheme = match entry.kind {
        ProxyKind::Socks5 => "socks5h",
        ProxyKind::Http | ProxyKind::Geolocation => "http",
        ProxyKind::Https => "https",
    };
    let proxy_url = if entry.username.is_empty() && entry.password.is_empty() {
        format!("{scheme}://{}:{}", entry.host, entry.port)
    } else {
        let u = url::form_urlencoded::byte_serialize(entry.username.as_bytes()).collect::<String>();
        let p = url::form_urlencoded::byte_serialize(entry.password.as_bytes()).collect::<String>();
        format!("{scheme}://{u}:{p}@{}:{}", entry.host, entry.port)
    };

    let req_proxy = match reqwest::Proxy::all(&proxy_url) {
        Ok(p) => p,
        Err(e) => {
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::InvalidProxyUrl,
                status_code: None,
                test_type: "CLIENT_BUILD".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("Failed to build reqwest proxy config: {e}")),
            };
        }
    };

    let client = match reqwest::Client::builder()
        .no_proxy()
        .proxy(req_proxy)
        .timeout(Duration::from_millis(timeouts.target_response_ms))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(start_total.elapsed().as_millis() as u64),
                error_category: ProxyErrorCategory::HttpProxyRequestFailed,
                status_code: None,
                test_type: "CLIENT_BUILD".into(),
                tested_at,
                retry_count: 0,
                details: Some(format!("Failed to build HTTP client: {e}")),
            };
        }
    };

    let target_test_type = if is_https { "HTTPS" } else { "HTTP" };
    match client.get(target).send().await {
        Ok(resp) => {
            let code = resp.status().as_u16();
            let total_ms = start_total.elapsed().as_millis() as u64;
            if (200..400).contains(&code) {
                if debug {
                    eprintln!("{idx_label}{target_test_type} request: OK");
                    eprintln!("{idx_label}latency: {total_ms}ms");
                }
                ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: true,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(total_ms),
                    error_category: ProxyErrorCategory::Success,
                    status_code: Some(code),
                    test_type: target_test_type.into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("Request completed successfully".into()),
                }
            } else if code == 407 {
                if debug {
                    eprintln!("{idx_label}authentication: FAILED (HTTP 407)\n{idx_label}error: PROXY_AUTH_FAILED");
                }
                ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(total_ms),
                    error_category: ProxyErrorCategory::ProxyAuthFailed,
                    status_code: Some(code),
                    test_type: target_test_type.into(),
                    tested_at,
                    retry_count: 0,
                    details: Some("Proxy authentication required".into()),
                }
            } else if (400..500).contains(&code) {
                if debug {
                    eprintln!("{idx_label}target returned status {code}");
                }
                ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(total_ms),
                    error_category: ProxyErrorCategory::ProxyReturned4xx,
                    status_code: Some(code),
                    test_type: target_test_type.into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("Target or proxy returned HTTP {code}")),
                }
            } else {
                if debug {
                    eprintln!("{idx_label}target returned status {code}");
                }
                ProxyTestResult {
                    proxy_id: entry.id.clone(),
                    success: false,
                    protocol: proto_str,
                    host_port,
                    latency_ms: Some(tcp_latency),
                    total_time_ms: Some(total_ms),
                    error_category: ProxyErrorCategory::ProxyReturned5xx,
                    status_code: Some(code),
                    test_type: target_test_type.into(),
                    tested_at,
                    retry_count: 0,
                    details: Some(format!("Target or proxy returned HTTP {code}")),
                }
            }
        }
        Err(e) => {
            let total_ms = start_total.elapsed().as_millis() as u64;
            let err_str = e.to_string();
            let cat = if e.is_timeout() {
                ProxyErrorCategory::TargetTimeout
            } else if e.is_connect() {
                ProxyErrorCategory::TargetConnectionFailed
            } else if err_str.to_lowercase().contains("tls")
                || err_str.to_lowercase().contains("handshake")
                || err_str.to_lowercase().contains("cert")
            {
                ProxyErrorCategory::TlsHandshakeFailed
            } else {
                ProxyErrorCategory::HttpProxyRequestFailed
            };

            if debug {
                eprintln!(
                    "{idx_label}{target_test_type} request: FAILED\n{idx_label}error: {}",
                    cat.as_str()
                );
            }

            ProxyTestResult {
                proxy_id: entry.id.clone(),
                success: false,
                protocol: proto_str,
                host_port,
                latency_ms: Some(tcp_latency),
                total_time_ms: Some(total_ms),
                error_category: cat,
                status_code: None,
                test_type: target_test_type.into(),
                tested_at,
                retry_count: 0,
                details: Some("Functional request through proxy failed".into()),
            }
        }
    }
}

pub async fn diagnose_proxies_bulk(
    entries: &[ProxyEntry],
    target_url: &str,
    timeouts: &ProxyTimeouts,
    debug: bool,
    concurrency: usize,
) -> Vec<ProxyTestResult> {
    use futures_util::stream::{self, StreamExt};
    let conc = std::cmp::max(1, std::cmp::min(concurrency, 20));
    let tasks: Vec<(usize, ProxyEntry)> = entries.iter().cloned().enumerate().collect();

    stream::iter(tasks)
        .map(|(idx, entry)| {
            let timeouts_clone = timeouts.clone();
            let target_str = target_url.to_string();
            async move {
                diagnose_proxy(&entry, &target_str, &timeouts_clone, debug, Some(idx + 1)).await
            }
        })
        .buffer_unordered(conc)
        .collect::<Vec<_>>()
        .await
}

// ---- Bulk import & parser ----

pub fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                let hex_str = [c1, c2];
                if let Ok(s) = std::str::from_utf8(&hex_str) {
                    if let Ok(val) = u8::from_str_radix(s, 16) {
                        bytes.push(val);
                        continue;
                    }
                }
                bytes.push(b'%');
                bytes.push(c1);
                bytes.push(c2);
                continue;
            } else {
                bytes.push(b'%');
                if let Some(c1) = h1 {
                    bytes.push(c1);
                }
                break;
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

/// Parse a single proxy line for inline (unsaved) use by the API.
pub fn parse_single(line: &str) -> Option<ProxyEntry> {
    parse_one(line.trim(), &ProxyKind::Socks5)
}

pub fn parse_bulk(text: &str, default_kind: ProxyKind) -> Vec<ProxyEntry> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(p) = parse_one(line, &default_kind) {
            out.push(p);
        }
    }
    out
}

fn parse_one(line: &str, default_kind: &ProxyKind) -> Option<ProxyEntry> {
    let (main, comment) = {
        let comment_pos = if let Some(at_idx) = line.find('@') {
            line[at_idx..].find('#').map(|i| at_idx + i)
        } else {
            line.find('#')
        };
        match comment_pos {
            Some(i) => (line[..i].trim(), Some(line[i + 1..].trim())),
            None => (line.trim(), None),
        }
    };
    let lower_main = main.to_lowercase();
    if lower_main.starts_with("geolocation://") {
        let after_scheme = &main[14..];
        let (auth, rest_hp) = after_scheme.split_once('@')?;
        let (user, pass) = auth.split_once(':')?;
        let (host, remainder) = rest_hp.split_once(':')?;
        let (port_s, location_label) = remainder.split_once(':')?;
        let port: u16 = port_s.trim().parse().ok()?;
        let loc = location_label.trim().to_string();
        let name = if let Some(c) = comment {
            c.to_string()
        } else {
            format!("{loc} ({host}:{port})")
        };
        return Some(ProxyEntry {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            kind: ProxyKind::Geolocation,
            host: host.trim().to_string(),
            port,
            username: percent_decode(user.trim()),
            password: percent_decode(pass),
            country: loc.clone(),
            notes: format!("Location: {loc}"),
            source_format: Some("geolocation".to_string()),
            location_label: Some(loc),
            raw_input: Some(line.to_string()),
        });
    }

    // Standard URI with scheme (http://, https://, socks5://)
    if main.contains("://") {
        if let Ok(parsed_url) = url::Url::parse(main) {
            let scheme = parsed_url.scheme().to_lowercase();
            let kind = match scheme.as_str() {
                "socks5" | "socks5h" => ProxyKind::Socks5,
                "https" => ProxyKind::Https,
                "http" => ProxyKind::Http,
                _ => default_kind.clone(),
            };
            let host = parsed_url.host_str()?.to_string();
            let port = parsed_url.port().unwrap_or(match kind {
                ProxyKind::Socks5 => 1080,
                ProxyKind::Https => 443,
                _ => 8080,
            });
            let user = percent_decode(parsed_url.username());
            let pass = parsed_url.password().map(percent_decode).unwrap_or_default();

            let mut country = String::new();
            let mut notes = String::new();
            let mut name_parts: Vec<&str> = Vec::new();
            if let Some(c) = comment {
                for kv in c.split_whitespace() {
                    if let Some(v) = kv.strip_prefix("country=") {
                        country = v.to_string();
                    } else if let Some(v) = kv.strip_prefix("note=") {
                        notes = v.to_string();
                    } else {
                        name_parts.push(kv.trim_start_matches('#'));
                    }
                }
            }
            let name = name_parts.join(" ");
            let src_fmt = match scheme.as_str() {
                "socks5" | "socks5h" => "socks5",
                "https" => "https",
                "http" => "http",
                _ => "custom",
            };
            return Some(ProxyEntry {
                id: uuid::Uuid::new_v4().to_string(),
                name: if name.is_empty() { format!("{host}:{port}") } else { name },
                kind,
                host,
                port,
                username: user,
                password: pass,
                country,
                notes,
                source_format: Some(src_fmt.to_string()),
                location_label: None,
                raw_input: Some(line.to_string()),
            });
        }
    }

    let kind = default_kind.clone();
    let (host_part, user, pass) = if let Some(at_idx) = main.rfind('@') {
        let auth_part = &main[..at_idx];
        let hp = &main[at_idx + 1..];
        let (un, pw) = auth_part.split_once(':').unwrap_or((auth_part, ""));
        (hp.to_string(), percent_decode(un), percent_decode(pw))
    } else {
        let parts: Vec<&str> = main.split(':').collect();
        match parts.len() {
            2 => (main.to_string(), String::new(), String::new()),
            4 => {
                if parts[1].parse::<u16>().is_ok() {
                    (
                        format!("{}:{}", parts[0], parts[1]),
                        percent_decode(parts[2]),
                        percent_decode(parts[3]),
                    )
                } else if parts[3].parse::<u16>().is_ok() {
                    (
                        format!("{}:{}", parts[2], parts[3]),
                        percent_decode(parts[0]),
                        percent_decode(parts[1]),
                    )
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    };

    let (host, port_s) = host_part.rsplit_once(':')?;
    let port: u16 = port_s.parse().ok()?;
    let mut country = String::new();
    let mut notes = String::new();
    let mut name_parts: Vec<&str> = Vec::new();
    if let Some(c) = comment {
        for kv in c.split_whitespace() {
            if let Some(v) = kv.strip_prefix("country=") {
                country = v.to_string();
            } else if let Some(v) = kv.strip_prefix("note=") {
                notes = v.to_string();
            } else {
                name_parts.push(kv.trim_start_matches('#'));
            }
        }
    }
    let name = name_parts.join(" ");
    let src_fmt = match default_kind {
        ProxyKind::Socks5 => "socks5",
        ProxyKind::Geolocation => "geolocation",
        ProxyKind::Https => "https",
        ProxyKind::Http => "http",
    };
    Some(ProxyEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: if name.is_empty() { format!("{host}:{port}") } else { name },
        kind,
        host: host.to_string(),
        port,
        username: user,
        password: pass,
        country,
        notes,
        source_format: Some(src_fmt.to_string()),
        location_label: None,
        raw_input: Some(line.to_string()),
    })
}

/// Save many entries; returns count actually persisted (deduped on host:port:user).
pub fn bulk_save(entries: Vec<ProxyEntry>) -> Result<usize> {
    let mut store_data = load()?;
    let mut added = 0usize;
    for mut e in entries {
        let dup = store_data
            .proxies
            .iter()
            .any(|x| x.host == e.host && x.port == e.port && x.username == e.username);
        if dup {
            continue;
        }
        if e.id.is_empty() {
            e.id = uuid::Uuid::new_v4().to_string();
        }
        store_data.proxies.push(e);
        added += 1;
    }
    save(&store_data)?;
    Ok(added)
}

// ---- UDP probe (SOCKS5 UDP_ASSOCIATE; RFC 1928 §7) ----

async fn resolve_stun_ipv4() -> Result<(std::net::Ipv4Addr, u16)> {
    const HOSTS: &[&str] = &[
        "stun.l.google.com:19302",
        "stun1.l.google.com:19302",
        "stun.cloudflare.com:3478",
    ];
    for h in HOSTS {
        if let Ok(addrs) = tokio::net::lookup_host(*h).await {
            for a in addrs {
                if let std::net::IpAddr::V4(v4) = a.ip() {
                    return Ok((v4, a.port()));
                }
            }
        }
    }
    anyhow::bail!("no STUN server resolved to IPv4")
}

pub async fn probe_udp(entry: &ProxyEntry) -> Result<u128> {
    use tokio::net::UdpSocket;

    if !matches!(entry.kind, ProxyKind::Socks5) {
        anyhow::bail!("UDP probe only supported for SOCKS5");
    }
    let started = Instant::now();
    let mut tcp = timeout(
        Duration::from_secs(8),
        TcpStream::connect(format!("{}:{}", entry.host, entry.port)),
    )
    .await
    .context("connect timeout")??;

    let auth_method: u8 = if entry.username.is_empty() { 0x00 } else { 0x02 };
    tcp.write_all(&[0x05, 0x01, auth_method]).await?;
    let mut greet = [0u8; 2];
    tcp.read_exact(&mut greet).await?;
    if greet[1] == 0xFF {
        anyhow::bail!("no acceptable auth method");
    }
    if auth_method == 0x02 {
        let mut buf = vec![0x01u8];
        buf.push(entry.username.len() as u8);
        buf.extend_from_slice(entry.username.as_bytes());
        buf.push(entry.password.len() as u8);
        buf.extend_from_slice(entry.password.as_bytes());
        tcp.write_all(&buf).await?;
        let mut ar = [0u8; 2];
        tcp.read_exact(&mut ar).await?;
        if ar[1] != 0x00 {
            anyhow::bail!("auth failed");
        }
    }
    tcp.write_all(&[0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;
    let mut hdr = [0u8; 4];
    tcp.read_exact(&mut hdr).await?;
    if hdr[1] != 0x00 {
        anyhow::bail!("UDP_ASSOCIATE refused (rep={:#x})", hdr[1]);
    }
    let bind_addr: SocketAddr = match hdr[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            tcp.read_exact(&mut ip).await?;
            let mut p = [0u8; 2];
            tcp.read_exact(&mut p).await?;
            let port = u16::from_be_bytes(p);
            let v4 = std::net::Ipv4Addr::from(ip);
            if v4.is_unspecified() {
                let peer = tcp.peer_addr()?;
                SocketAddr::new(peer.ip(), port)
            } else {
                SocketAddr::new(std::net::IpAddr::V4(v4), port)
            }
        }
        0x04 => {
            let mut ip = [0u8; 16];
            tcp.read_exact(&mut ip).await?;
            let mut p = [0u8; 2];
            tcp.read_exact(&mut p).await?;
            SocketAddr::new(std::net::IpAddr::V6(std::net::Ipv6Addr::from(ip)), u16::from_be_bytes(p))
        }
        _ => anyhow::bail!("unsupported ATYP in UDP reply"),
    };

    let (stun_ip, stun_port) = resolve_stun_ipv4()
        .await
        .context("could not resolve a STUN server to probe UDP with")?;

    let udp = UdpSocket::bind("0.0.0.0:0").await?;
    udp.connect(bind_addr).await?;
    let mut pkt: Vec<u8> = Vec::with_capacity(32);
    pkt.extend_from_slice(&[0, 0, 0, 0x01]);
    pkt.extend_from_slice(&stun_ip.octets());
    pkt.extend_from_slice(&stun_port.to_be_bytes());
    let mut stun = vec![0x00u8, 0x01, 0x00, 0x00, 0x21, 0x12, 0xA4, 0x42];
    stun.extend_from_slice(&uuid::Uuid::new_v4().as_bytes()[..12]);
    pkt.extend_from_slice(&stun);
    udp.send(&pkt).await?;

    let mut buf = vec![0u8; 1500];
    let n = timeout(Duration::from_secs(6), udp.recv(&mut buf))
        .await
        .context("UDP reply timeout — proxy doesn't relay UDP")??;
    if n < 20 {
        anyhow::bail!("UDP reply too short");
    }
    drop(tcp);
    Ok(started.elapsed().as_millis())
}

// ---- Geo lookup ----

#[derive(Debug, Clone, Serialize)]
pub struct GeoInfo {
    pub ip: String,
    pub country: String,
    pub country_code: String,
    pub region: String,
    pub city: String,
    pub isp: String,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub provider: String,
}

pub async fn geo_check(entry: &ProxyEntry, provider_override: Option<String>) -> Result<GeoInfo> {
    geo_check_via(Some(entry), provider_override).await
}

pub async fn geo_check_via(entry: Option<&ProxyEntry>, provider_override: Option<String>) -> Result<GeoInfo> {
    let provider = provider_override
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| settings::load().ok().and_then(|s| s.geo_checker).unwrap_or_else(|| "ip-api.com".into()));

    let url = match provider.as_str() {
        "ip-api.com" => "http://ip-api.com/json/?fields=status,message,query,country,countryCode,regionName,city,isp,timezone,lat,lon",
        "ipapi.co" => "https://ipapi.co/json/",
        "ipwho.is" => "https://ipwho.is/",
        _ => "http://ip-api.com/json/?fields=status,message,query,country,countryCode,regionName,city,isp,timezone,lat,lon",
    };

    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10));
    if let Some(entry) = entry {
        let scheme = match entry.kind {
            ProxyKind::Socks5 => "socks5h",
            ProxyKind::Http | ProxyKind::Geolocation => "http",
            ProxyKind::Https => "https",
        };
        let proxy_url = if entry.username.is_empty() && entry.password.is_empty() {
            format!("{scheme}://{}:{}", entry.host, entry.port)
        } else {
            let user = url::form_urlencoded::byte_serialize(entry.username.as_bytes()).collect::<String>();
            let pass = url::form_urlencoded::byte_serialize(entry.password.as_bytes()).collect::<String>();
            format!("{scheme}://{user}:{pass}@{}:{}", entry.host, entry.port)
        };
        let proxy = reqwest::Proxy::all(&proxy_url).context("bad proxy URL")?;
        builder = builder.no_proxy().proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }
    let client = builder.build()?;

    let body: serde_json::Value = client.get(url).send().await?.json().await?;

    let s = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    let f = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0)
    };
    let info = match provider.as_str() {
        "ip-api.com" => {
            if s(&body, "status") == "fail" {
                anyhow::bail!("ip-api.com: {}", s(&body, "message"));
            }
            GeoInfo {
                ip: s(&body, "query"),
                country: s(&body, "country"),
                country_code: s(&body, "countryCode"),
                region: s(&body, "regionName"),
                city: s(&body, "city"),
                isp: s(&body, "isp"),
                timezone: s(&body, "timezone"),
                latitude: f(&body, "lat"),
                longitude: f(&body, "lon"),
                provider,
            }
        }
        "ipapi.co" => GeoInfo {
            ip: s(&body, "ip"),
            country: s(&body, "country_name"),
            country_code: s(&body, "country_code"),
            region: s(&body, "region"),
            city: s(&body, "city"),
            isp: s(&body, "org"),
            timezone: s(&body, "timezone"),
            latitude: f(&body, "latitude"),
            longitude: f(&body, "longitude"),
            provider,
        },
        "ipwho.is" => GeoInfo {
            ip: s(&body, "ip"),
            country: s(&body, "country"),
            country_code: s(&body, "country_code"),
            region: s(&body, "region"),
            city: s(&body, "city"),
            isp: body.get("connection").and_then(|c| c.get("isp")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
            timezone: body.get("timezone").and_then(|t| t.get("id")).and_then(|x| x.as_str()).unwrap_or("").to_string(),
            latitude: f(&body, "latitude"),
            longitude: f(&body, "longitude"),
            provider,
        },
        _ => GeoInfo {
            ip: s(&body, "query"),
            country: s(&body, "country"),
            country_code: s(&body, "countryCode"),
            region: String::new(),
            city: String::new(),
            isp: String::new(),
            timezone: String::new(),
            latitude: 0.0,
            longitude: 0.0,
            provider,
        },
    };
    Ok(info)
}

pub fn country_to_locale(cc: &str) -> &'static str {
    match cc.to_ascii_uppercase().as_str() {
        "US" => "en-US",
        "GB" | "UK" => "en-GB",
        "CA" => "en-CA",
        "AU" => "en-AU",
        "NZ" => "en-NZ",
        "IE" => "en-IE",
        "ZA" => "en-ZA",
        "IN" => "en-IN",
        "DE" => "de-DE",
        "AT" => "de-AT",
        "CH" => "de-CH",
        "FR" => "fr-FR",
        "BE" => "fr-BE",
        "ES" => "es-ES",
        "MX" => "es-MX",
        "AR" => "es-AR",
        "CO" => "es-CO",
        "CL" => "es-CL",
        "IT" => "it-IT",
        "NL" => "nl-NL",
        "PL" => "pl-PL",
        "BR" => "pt-BR",
        "PT" => "pt-PT",
        "RO" => "ro-RO",
        "RU" => "ru-RU",
        "BY" => "be-BY",
        "UA" => "uk-UA",
        "TR" => "tr-TR",
        "GR" => "el-GR",
        "CZ" => "cs-CZ",
        "SK" => "sk-SK",
        "HU" => "hu-HU",
        "SE" => "sv-SE",
        "FI" => "fi-FI",
        "NO" => "nb-NO",
        "DK" => "da-DK",
        "BG" => "bg-BG",
        "HR" => "hr-HR",
        "SI" => "sl-SI",
        "RS" => "sr-RS",
        "IL" => "he-IL",
        "SA" | "AE" | "EG" => "ar-SA",
        "ID" => "id-ID",
        "MY" => "ms-MY",
        "PH" => "fil-PH",
        "VN" => "vi-VN",
        "TH" => "th-TH",
        "CN" => "zh-CN",
        "HK" => "zh-HK",
        "TW" => "zh-TW",
        "JP" => "ja-JP",
        "KR" => "ko-KR",
        _ => "en-US",
    }
}

// ---- Test history ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSnapshot {
    pub first_seen: String,
    pub last_seen: String,
    pub ip: String,
    pub country_code: String,
    pub country: String,
    pub region: String,
    pub city: String,
    pub isp: String,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub tcp_ms: Option<u128>,
    pub udp_ms: Option<u128>,
    pub udp_error: Option<String>,
    pub provider: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HistoryStore {
    #[serde(default)]
    by_proxy: HashMap<String, Vec<TestSnapshot>>,
}

fn history_path() -> Result<PathBuf> {
    store::proxies_history_path()
}

fn load_history() -> Result<HistoryStore> {
    let path = history_path()?;
    if !path.exists() {
        return Ok(HistoryStore::default());
    }
    let body = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&body).unwrap_or_default())
}

fn save_history(s: &HistoryStore) -> Result<()> {
    let body = serde_json::to_string_pretty(s)?;
    fs::write(history_path()?, body)?;
    Ok(())
}

fn record_test(proxy_id: &str, mut snap: TestSnapshot) -> Result<TestSnapshot> {
    if proxy_id.is_empty() {
        if snap.first_seen.is_empty() {
            snap.first_seen = snap.last_seen.clone();
        }
        return Ok(snap);
    }
    let mut hs = load_history()?;
    let entries = hs.by_proxy.entry(proxy_id.into()).or_default();
    if let Some(last) = entries.last_mut() {
        if !snap.ip.is_empty() && last.ip == snap.ip {
            last.last_seen = snap.last_seen.clone();
            last.tcp_ms = snap.tcp_ms;
            last.udp_ms = snap.udp_ms;
            last.udp_error = snap.udp_error.clone();
            let out = last.clone();
            save_history(&hs)?;
            return Ok(out);
        }
    }
    if snap.first_seen.is_empty() {
        snap.first_seen = snap.last_seen.clone();
    }
    entries.push(snap.clone());
    if entries.len() > 50 {
        let drop = entries.len() - 50;
        entries.drain(..drop);
    }
    save_history(&hs)?;
    Ok(snap)
}

pub fn history(proxy_id: &str) -> Result<Vec<TestSnapshot>> {
    let hs = load_history()?;
    Ok(hs.by_proxy.get(proxy_id).cloned().unwrap_or_default())
}

pub fn latest_test(proxy_id: &str) -> Option<TestSnapshot> {
    load_history()
        .ok()
        .and_then(|hs| hs.by_proxy.get(proxy_id).and_then(|v| v.last().cloned()))
}

fn unix_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{s}")
}

pub async fn full_test(entry: &ProxyEntry) -> Result<TestSnapshot> {
    let now = unix_now();

    let tcp_res = probe(entry).await;
    let udp_res = if matches!(entry.kind, ProxyKind::Socks5) {
        Some(probe_udp(entry).await)
    } else {
        None
    };
    let geo_res = geo_check(entry, None).await;

    let tcp_failed = tcp_res.is_err();
    let (ip, country_code, country, region, city, isp, tz, lat, lng, provider) =
        match (&geo_res, tcp_failed) {
            (Ok(g), false) => (
                g.ip.clone(), g.country_code.clone(), g.country.clone(),
                g.region.clone(), g.city.clone(), g.isp.clone(),
                g.timezone.clone(), g.latitude, g.longitude, g.provider.clone(),
            ),
            _ => (String::new(), String::new(), String::new(),
                  String::new(), String::new(), String::new(),
                  String::new(), 0.0, 0.0, String::new()),
        };

    let snap = TestSnapshot {
        first_seen: String::new(),
        last_seen: now,
        ip,
        country_code,
        country,
        region,
        city,
        isp,
        timezone: tz,
        latitude: lat,
        longitude: lng,
        tcp_ms: tcp_res.ok(),
        udp_ms: udp_res
            .as_ref()
            .and_then(|r| r.as_ref().ok().copied()),
        udp_error: udp_res
            .as_ref()
            .and_then(|r| r.as_ref().err().map(|e| e.to_string())),
        provider,
    };

    let recorded = record_test(&entry.id, snap)?;

    if !recorded.country_code.is_empty() {
        let mut store_data = load()?;
        if let Some(p) = store_data.proxies.iter_mut().find(|p| p.id == entry.id) {
            if p.country.is_empty() || p.country == "—" {
                p.country = recorded.country_code.clone();
                save(&store_data)?;
            }
        }
    }

    Ok(recorded)
}

pub fn country_to_timezone(cc: &str) -> &'static str {
    match cc.to_ascii_uppercase().as_str() {
        "US" => "America/New_York",
        "CA" => "America/Toronto",
        "GB" | "UK" => "Europe/London",
        "DE" => "Europe/Berlin",
        "FR" => "Europe/Paris",
        "ES" => "Europe/Madrid",
        "IT" => "Europe/Rome",
        "NL" => "Europe/Amsterdam",
        "PL" => "Europe/Warsaw",
        "PT" => "Europe/Lisbon",
        "RO" => "Europe/Bucharest",
        "RU" => "Europe/Moscow",
        "UA" => "Europe/Kyiv",
        "TR" => "Europe/Istanbul",
        "GR" => "Europe/Athens",
        "CZ" => "Europe/Prague",
        "HU" => "Europe/Budapest",
        "SE" => "Europe/Stockholm",
        "FI" => "Europe/Helsinki",
        "NO" => "Europe/Oslo",
        "DK" => "Europe/Copenhagen",
        "CH" => "Europe/Zurich",
        "AT" => "Europe/Vienna",
        "BR" => "America/Sao_Paulo",
        "AR" => "America/Argentina/Buenos_Aires",
        "MX" => "America/Mexico_City",
        "AU" => "Australia/Sydney",
        "NZ" => "Pacific/Auckland",
        "IN" => "Asia/Kolkata",
        "ID" => "Asia/Jakarta",
        "MY" => "Asia/Kuala_Lumpur",
        "SG" => "Asia/Singapore",
        "TH" => "Asia/Bangkok",
        "VN" => "Asia/Ho_Chi_Minh",
        "CN" => "Asia/Shanghai",
        "HK" => "Asia/Hong_Kong",
        "TW" => "Asia/Taipei",
        "JP" => "Asia/Tokyo",
        "KR" => "Asia/Seoul",
        "IL" => "Asia/Jerusalem",
        "SA" => "Asia/Riyadh",
        "AE" => "Asia/Dubai",
        _ => "UTC",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    // 1. URL-encoded credentials parsing test
    #[test]
    fn test_url_encoded_credentials_parsing() {
        let raw = "http://user%40domain.com:p%40ss%3Aword%21@127.0.0.1:8080";
        let parsed = parse_single(raw).expect("Must parse valid encoded proxy URL");
        assert_eq!(parsed.kind, ProxyKind::Http);
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, 8080);
        assert_eq!(parsed.username, "user@domain.com");
        assert_eq!(parsed.password, "p@ss:word!");
    }

    // 2. Malformed proxy URL test
    #[test]
    fn test_malformed_proxy_url() {
        let entry = ProxyEntry {
            id: "test-bad".into(),
            name: "Bad".into(),
            kind: ProxyKind::Http,
            host: "".into(),
            port: 0,
            username: "".into(),
            password: "".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };
        let timeouts = ProxyTimeouts::default();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(diagnose_proxy(&entry, "https://example.com/", &timeouts, false, None));
        assert_eq!(res.error_category, ProxyErrorCategory::InvalidProxyUrl);
        assert!(!res.success);
    }

    // 3. Invalid hostname -> DNS_FAILURE test
    #[tokio::test]
    async fn test_invalid_hostname_dns_failure() {
        let entry = ProxyEntry {
            id: "test-dns".into(),
            name: "Bad Host".into(),
            kind: ProxyKind::Http,
            host: "invalid-domain-xyz-nonexistent-987.local".into(),
            port: 1080,
            username: "user".into(),
            password: "pass".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };
        let timeouts = ProxyTimeouts::default();
        let res = diagnose_proxy(&entry, "https://example.com/", &timeouts, false, None).await;
        assert_eq!(res.error_category, ProxyErrorCategory::DnsFailure);
        assert!(!res.success);
    }

    // 4. Closed port -> TCP_CONNECTION_FAILED test
    #[tokio::test]
    async fn test_closed_port_tcp_failure() {
        // Port 59998 is closed
        let entry = ProxyEntry {
            id: "test-closed".into(),
            name: "Closed Port".into(),
            kind: ProxyKind::Http,
            host: "127.0.0.1".into(),
            port: 59998,
            username: "user".into(),
            password: "pass".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };
        let timeouts = ProxyTimeouts {
            tcp_connect_ms: 3000,
            ..Default::default()
        };
        let res = diagnose_proxy(&entry, "https://example.com/", &timeouts, false, None).await;
        assert!(matches!(
            res.error_category,
            ProxyErrorCategory::TcpConnectionFailed | ProxyErrorCategory::ConnectionTimeout
        ));
        assert!(!res.success);
    }

    // 5. HTTP 407 Proxy Authentication Required test
    #[tokio::test]
    async fn test_mock_proxy_auth_failure_407() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let resp = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"mock\"\r\nContent-Length: 0\r\n\r\n";
                let _ = socket.write_all(resp.as_bytes()).await;
            }
        });

        let entry = ProxyEntry {
            id: "mock-407".into(),
            name: "Mock 407".into(),
            kind: ProxyKind::Http,
            host: "127.0.0.1".into(),
            port,
            username: "baduser".into(),
            password: "badpassword".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };

        let timeouts = ProxyTimeouts::default();
        let res = diagnose_proxy(&entry, "https://example.com/", &timeouts, false, None).await;
        assert_eq!(res.error_category, ProxyErrorCategory::ProxyAuthFailed);
        assert_eq!(res.status_code, Some(407));
        assert!(!res.success);
    }

    // 6. Connection Timeout test
    #[tokio::test]
    async fn test_mock_connection_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        // Accept connection but do not read or respond (hanging)
        tokio::spawn(async move {
            if let Ok((_socket, _)) = listener.accept().await {
                tokio::time::sleep(Duration::from_millis(5000)).await;
            }
        });

        let entry = ProxyEntry {
            id: "mock-timeout".into(),
            name: "Mock Timeout".into(),
            kind: ProxyKind::Http,
            host: "127.0.0.1".into(),
            port,
            username: "user".into(),
            password: "pass".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };

        let timeouts = ProxyTimeouts {
            tcp_connect_ms: 2000,
            auth_handshake_ms: 500,
            connect_tunnel_ms: 500,
            tls_handshake_ms: 500,
            target_response_ms: 500,
        };
        let res = diagnose_proxy(&entry, "https://example.com/", &timeouts, false, None).await;
        assert_eq!(res.error_category, ProxyErrorCategory::ConnectionTimeout);
        assert!(!res.success);
    }

    // 7. Proxy Pool Rotation & Health Transition test
    #[test]
    fn test_proxy_pool_lifecycle_and_rotation() {
        let p1 = ProxyEntry {
            id: "p1".into(), name: "P1".into(), kind: ProxyKind::Http, host: "1.1.1.1".into(), port: 80,
            username: "".into(), password: "".into(), country: "".into(), notes: "".into(), source_format: None, location_label: None, raw_input: None,
        };
        let p2 = ProxyEntry {
            id: "p2".into(), name: "P2".into(), kind: ProxyKind::Http, host: "2.2.2.2".into(), port: 80,
            username: "".into(), password: "".into(), country: "".into(), notes: "".into(), source_format: None, location_label: None, raw_input: None,
        };

        let mut pool = ProxyPool::new(vec![p1.clone(), p2.clone()]);
        let now = 1000u64;

        // Round robin
        let next1 = pool.get_next_healthy(now).unwrap();
        assert_eq!(next1.id, "p1");
        let next2 = pool.get_next_healthy(now).unwrap();
        assert_eq!(next2.id, "p2");

        // Report failure on p1 -> enters Cooldown
        let failure_res = ProxyTestResult {
            proxy_id: "p1".into(),
            success: false,
            protocol: "http".into(),
            host_port: "1.1.1.1:80".into(),
            latency_ms: None,
            total_time_ms: None,
            error_category: ProxyErrorCategory::TcpConnectionFailed,
            status_code: None,
            test_type: "TCP".into(),
            tested_at: "@1000".into(),
            retry_count: 1,
            details: None,
        };
        pool.record_result("p1", &failure_res, now);

        // p1 is in cooldown; only p2 is available
        let next3 = pool.get_next_healthy(now).unwrap();
        assert_eq!(next3.id, "p2");

        // Advance time past cooldown (5s)
        let next4 = pool.get_next_healthy(now + 10).unwrap();
        assert_eq!(next4.id, "p1");

        // Target site error should NOT mark proxy dead
        let target_err = ProxyTestResult {
            proxy_id: "p1".into(),
            success: false,
            protocol: "http".into(),
            host_port: "1.1.1.1:80".into(),
            latency_ms: None,
            total_time_ms: None,
            error_category: ProxyErrorCategory::TargetTimeout,
            status_code: None,
            test_type: "HTTPS".into(),
            tested_at: "@1015".into(),
            retry_count: 1,
            details: None,
        };
        pool.record_result("p1", &target_err, now + 15);
        assert_eq!(pool.health_map["p1"].state, ProxyHealthState::TemporarilyFailed);

        // Reset pool
        pool.reset_pool();
        assert_eq!(pool.health_map["p1"].state, ProxyHealthState::Healthy);
    }

    // 8. Safe debug mode secret protection test
    #[test]
    fn test_secret_redaction_in_config_and_results() {
        let config = ProxyConfig {
            protocol: "http".into(),
            host: "geo.floppydata.com".into(),
            port: 10080,
            username: Some("SuperSecretUser123".into()),
            password: Some("UltraConfidentialPass456".into()),
            source_format: Some("geolocation".into()),
            location_label: Some("United States - 54".into()),
            raw_input: None,
        };

        let sanitized = config.to_sanitized_string();
        assert!(!sanitized.contains("SuperSecretUser123"));
        assert!(!sanitized.contains("UltraConfidentialPass456"));
        assert!(sanitized.contains("****:****"));

        let result = ProxyTestResult {
            proxy_id: "test".into(),
            success: true,
            protocol: "http".into(),
            host_port: config.host_port(),
            latency_ms: Some(150),
            total_time_ms: Some(300),
            error_category: ProxyErrorCategory::Success,
            status_code: Some(200),
            test_type: "HTTPS".into(),
            tested_at: "@1000".into(),
            retry_count: 0,
            details: Some("Connected OK".into()),
        };
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("SuperSecretUser123"));
        assert!(!serialized.contains("UltraConfidentialPass456"));
    }

    // 9. Profile-scoped runtime proxy auth extension tests
    #[test]
    fn test_create_proxy_auth_extension_manifest_and_script() {
        let temp_dir = std::env::temp_dir().join(format!("test_udd_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let entry = ProxyEntry {
            id: "p-test".into(),
            name: "Test Auth Proxy".into(),
            kind: ProxyKind::Http,
            host: "geo.floppydata.com".into(),
            port: 10080,
            username: "test_user_\"special\"\\chars".into(),
            password: "test_pass_'secure'$123".into(),
            country: "US".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
            notes: "Test notes".into(),
        };

        let ext_dir = create_proxy_auth_extension(&temp_dir, &entry).expect("create extension");
        assert!(ext_dir.exists());

        // Verify manifest.json
        let manifest_path = ext_dir.join("manifest.json");
        assert!(manifest_path.exists());
        let manifest_content = fs::read_to_string(&manifest_path).expect("read manifest");
        let manifest_json: serde_json::Value = serde_json::from_str(&manifest_content).expect("parse manifest");
        assert_eq!(manifest_json["manifest_version"], 3);
        assert_eq!(manifest_json["background"]["service_worker"], "background.js");
        let perms = manifest_json["permissions"].as_array().expect("permissions array");
        assert!(perms.iter().any(|p| p.as_str() == Some("webRequest")));
        assert!(perms.iter().any(|p| p.as_str() == Some("webRequestAuthProvider")));

        // Verify background.js
        let bg_path = ext_dir.join("background.js");
        assert!(bg_path.exists());
        let bg_content = fs::read_to_string(&bg_path).expect("read background.js");
        assert!(bg_content.contains("chrome.webRequest.onAuthRequired.addListener"));
        // Safely escaped in JS
        assert!(bg_content.contains("test_user_\\\"special\\\"\\\\chars"));
        assert!(bg_content.contains("test_pass_'secure'$123"));
        assert!(bg_content.contains("geo.floppydata.com"));

        // Clean up
        remove_proxy_auth_extension(&temp_dir).expect("remove extension");
        assert!(!ext_dir.exists());
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_credential_isolation_between_profiles() {
        let temp_dir_a = std::env::temp_dir().join(format!("test_udd_a_{}", uuid::Uuid::new_v4()));
        let temp_dir_b = std::env::temp_dir().join(format!("test_udd_b_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir_a);
        let _ = fs::create_dir_all(&temp_dir_b);

        let entry_a = ProxyEntry {
            id: "p-a".into(),
            name: "Proxy A".into(),
            kind: ProxyKind::Http,
            host: "proxy-a.example.com".into(),
            port: 8080,
            username: "user_a".into(),
            password: "secret_password_a".into(),
            country: "US".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
            notes: "".into(),
        };

        let entry_b = ProxyEntry {
            id: "p-b".into(),
            name: "Proxy B".into(),
            kind: ProxyKind::Http,
            host: "proxy-b.example.com".into(),
            port: 9090,
            username: "user_b".into(),
            password: "secret_password_b".into(),
            country: "DE".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
            notes: "".into(),
        };

        let ext_a = create_proxy_auth_extension(&temp_dir_a, &entry_a).expect("create ext a");
        let ext_b = create_proxy_auth_extension(&temp_dir_b, &entry_b).expect("create ext b");

        let bg_a = fs::read_to_string(ext_a.join("background.js")).unwrap();
        let bg_b = fs::read_to_string(ext_b.join("background.js")).unwrap();

        // Strict isolation: Profile A has only user_a, never user_b
        assert!(bg_a.contains("user_a"));
        assert!(bg_a.contains("secret_password_a"));
        assert!(!bg_a.contains("user_b"));
        assert!(!bg_a.contains("secret_password_b"));

        // Profile B has only user_b, never user_a
        assert!(bg_b.contains("user_b"));
        assert!(bg_b.contains("secret_password_b"));
        assert!(!bg_b.contains("user_a"));
        assert!(!bg_b.contains("secret_password_a"));

        let _ = fs::remove_dir_all(&temp_dir_a);
        let _ = fs::remove_dir_all(&temp_dir_b);
    }

    #[test]
    fn test_geolocation_proxy_with_hash_in_password_and_source_format() {
        let raw = "geolocation://testuser:p#ssw0rd!@geo.floppydata.com:10080:United States - 54";
        let parsed = parse_one(raw, &ProxyKind::Http).expect("should parse geolocation with # in password");
        assert_eq!(parsed.kind, ProxyKind::Geolocation);
        assert_eq!(parsed.username, "testuser");
        assert_eq!(parsed.password, "p#ssw0rd!");
        assert_eq!(parsed.host, "geo.floppydata.com");
        assert_eq!(parsed.port, 10080);
        assert_eq!(parsed.location_label.as_deref(), Some("United States - 54"));
        assert_eq!(parsed.source_format.as_deref(), Some("geolocation"));

        let cfg = parsed.to_config();
        assert_eq!(cfg.protocol, "http");
        assert_eq!(cfg.source_format.as_deref(), Some("geolocation"));
        assert_eq!(cfg.location_label.as_deref(), Some("United States - 54"));

        let restored_entry = cfg.to_entry();
        assert_eq!(restored_entry.kind, ProxyKind::Geolocation);
        assert_eq!(restored_entry.source_format.as_deref(), Some("geolocation"));
    }
}
